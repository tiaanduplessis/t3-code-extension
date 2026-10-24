import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { McpError, parseRpcBody, toolResultValue } from "./mcp";
import { allowedRuntimeModes, effortOption, modelKey, parseModelKey, resolveRuntimeMode } from "./models";
import { createPkcePair, normalizeOrigin, PairingError, parsePairingInput } from "./oauth";
import type { Provider } from "./t3";

describe("parseRpcBody", () => {
  it("reads plain JSON responses", () => {
    expect(parseRpcBody("application/json", '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', 1).result).toEqual({ ok: true });
  });

  it("reads the matching message from an SSE stream", () => {
    const body = [
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"value":1}}',
      "",
    ].join("\n\n");
    expect(parseRpcBody("text/event-stream", body, 7).result).toEqual({ value: 1 });
  });

  it("fails when no response matches the request", () => {
    expect(() => parseRpcBody("application/json", '{"jsonrpc":"2.0","id":2,"result":{}}', 1)).toThrow(McpError);
  });
});

describe("toolResultValue", () => {
  it("prefers structured content", () => {
    expect(toolResultValue({ structuredContent: { threadId: "t1" }, content: [{ type: "text", text: "{}" }] })).toEqual({
      threadId: "t1",
    });
  });

  it("parses JSON text content", () => {
    expect(toolResultValue({ content: [{ type: "text", text: '{"projects":[]}' }] })).toEqual({ projects: [] });
  });

  it("maps T3 failures to tool errors with their code", () => {
    try {
      toolResultValue({
        structuredContent: { _tag: "OrchestratorMcpFailure", code: "target_required", message: "Pass threadId." },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).kind).toBe("tool");
      expect((error as McpError).code).toBe("target_required");
      expect((error as McpError).message).toBe("Pass threadId.");
    }
  });

  it("treats isError results as failures", () => {
    expect(() => toolResultValue({ isError: true, content: [{ type: "text", text: "boom" }] })).toThrow("boom");
  });
});

describe("pairing input", () => {
  it("accepts a bare code", () => {
    expect(parsePairingInput("  abc123 ")).toEqual({ code: "abc123" });
  });

  it("reads the token and server from a pairing link", () => {
    expect(parsePairingInput("https://mac.tailnet.ts.net/pair#token=tok_1")).toEqual({
      code: "tok_1",
      origin: "https://mac.tailnet.ts.net",
    });
  });

  it("prefers a host parameter over the link's own origin", () => {
    expect(parsePairingInput("https://app.example.com/pair?host=https%3A%2F%2Fmac.tailnet.ts.net#token=t2")).toEqual({
      code: "t2",
      origin: "https://mac.tailnet.ts.net",
    });
  });

  it("rejects empty input and links without a token", () => {
    expect(() => parsePairingInput(" ")).toThrow(PairingError);
    expect(() => parsePairingInput("http://127.0.0.1:3773/pair")).toThrow(PairingError);
  });

  it("normalizes server addresses", () => {
    expect(normalizeOrigin("")).toBe("http://127.0.0.1:3773");
    expect(normalizeOrigin("127.0.0.1:3773/")).toBe("http://127.0.0.1:3773");
    expect(normalizeOrigin("https://host.example/path")).toBe("https://host.example");
  });

  it("creates an S256 PKCE pair", async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("models", () => {
  const providers: Provider[] = [
    {
      providerInstanceId: "claudeAgent",
      driverKind: "claudeAgent",
      displayName: "Claude",
      constraints: [],
      models: [{ id: "claude-opus-5-5", options: [{ id: "effort", values: ["low", "high"], default: "low" }, { id: "fastMode", values: [false, true] }] }],
    },
    {
      providerInstanceId: "muse",
      driverKind: "muse",
      displayName: "Muse",
      constraints: [],
      runtimeModes: ["approval-required", "full-access"],
      models: [{ id: "muse-1" }],
    },
  ];

  it("round-trips model keys, including model ids with slashes", () => {
    const key = modelKey({ instanceId: "opencode", model: "openrouter/aion-labs/aion-3.5" });
    expect(parseModelKey(key)).toEqual({ instanceId: "opencode", model: "openrouter/aion-labs/aion-3.5" });
    expect(parseModelKey("project-default")).toBeNull();
  });

  it("finds the effort option and ignores boolean options", () => {
    expect(effortOption(providers[0]!.models[0])?.id).toBe("effort");
    expect(effortOption(providers[1]!.models[0])).toBeUndefined();
  });

  it("limits runtime modes to the approved ceiling and the provider", () => {
    expect(allowedRuntimeModes("auto-accept-edits", providers[0])).toEqual(["approval-required", "auto-accept-edits"]);
    expect(allowedRuntimeModes("full-access", providers[1])).toEqual(["approval-required", "full-access"]);
  });

  it("keeps an allowed preference, otherwise the narrowest allowed mode", () => {
    expect(resolveRuntimeMode("auto", ["approval-required", "auto"])).toBe("auto");
    expect(resolveRuntimeMode("full-access", ["approval-required", "auto"])).toBe("approval-required");
    expect(resolveRuntimeMode(undefined, ["approval-required", "auto"])).toBe("approval-required");
  });
});
