import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpClient, McpError } from "./mcp";

function jsonResponse(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { "content-type": "application/json", ...init.headers } });
}

describe("McpClient", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.1.0" }) } });
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  function initialized() {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }, { headers: { "mcp-session-id": "s1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
  }

  it("initializes once and reuses the session", async () => {
    initialized();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 2, result: { structuredContent: { a: 1 } } }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 3, result: { structuredContent: { b: 2 } } }));
    const client = new McpClient("http://127.0.0.1:3773", "token");
    expect(await client.callTool("one")).toEqual({ a: 1 });
    expect(await client.callTool("two")).toEqual({ b: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const headers = fetchMock.mock.calls[3]?.[1]?.headers as Record<string, string>;
    expect(headers["mcp-session-id"]).toBe("s1");
    expect(headers.authorization).toBe("Bearer token");
  });

  it("treats 401 as an auth failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid_mcp_credential" }, { status: 401 }));
    await expect(new McpClient("http://x", "t").callTool("any")).rejects.toMatchObject({ kind: "auth" });
  });

  it("does not treat 403 as an auth failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
    const error = await new McpClient("http://x", "t").callTool("any").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).kind).toBe("protocol");
    expect((error as McpError).code).toBe("forbidden");
  });

  it("starts a new session once when the server forgot the old one", async () => {
    initialized();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 3, result: {} }, { headers: { "mcp-session-id": "s2" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 4, result: { structuredContent: { ok: true } } }));
    expect(await new McpClient("http://x", "t").callTool("tool")).toEqual({ ok: true });
  });

  it("reports an unreachable server as a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(new McpClient("http://x", "t").callTool("any")).rejects.toMatchObject({ kind: "network" });
  });
});
