// Minimal MCP client for T3 Code's Streamable HTTP endpoint. The extension
// only calls tools, so this covers initialize, tools/call and session reuse.

const PROTOCOL_VERSION = "2025-06-18";

export type McpErrorKind = "auth" | "network" | "protocol" | "tool";

export class McpError extends Error {
  constructor(
    message: string,
    readonly kind: McpErrorKind,
    readonly code?: string,
  ) {
    super(message);
    this.name = "McpError";
  }
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolCallResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** Parses a JSON or SSE response body and returns the JSON-RPC message for `id`. */
export function parseRpcBody(contentType: string | null, body: string, id: number): JsonRpcResponse {
  const messages: JsonRpcResponse[] = [];
  if (contentType?.includes("text/event-stream")) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) messages.push(JSON.parse(data) as JsonRpcResponse);
    }
  } else if (body.trim()) {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[];
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const match = messages.find((message) => message.id === id);
  if (!match) throw new McpError("The T3 Code server sent no response to the request.", "protocol");
  return match;
}

/** Unwraps a tools/call result, mapping T3's returned failures to McpError. */
export function toolResultValue<T>(result: ToolCallResult): T {
  let value: unknown = result.structuredContent;
  if (value === undefined) {
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (text !== undefined) {
      try {
        value = JSON.parse(text);
      } catch {
        value = text;
      }
    }
  }
  const failure = value as { _tag?: string; code?: string; message?: string } | undefined;
  if (failure?._tag === "OrchestratorMcpFailure" || result.isError) {
    const message = failure?.message ?? (typeof value === "string" ? value : "The T3 Code tool call failed.");
    throw new McpError(message, "tool", failure?.code);
  }
  return value as T;
}

export class McpClient {
  private sessionId: string | undefined;
  private nextId = 1;
  private ready: Promise<void> | undefined;

  constructor(
    readonly origin: string,
    private readonly token: string,
  ) {}

  async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.initialize();
    try {
      return toolResultValue<T>(await this.request<ToolCallResult>("tools/call", { name, arguments: args }));
    } catch (error) {
      // The server forgets sessions on restart; start a new one and retry the
      // call once. Only session errors retry, so tool side effects never repeat.
      if (!(error instanceof McpError && error.code === "session")) throw error;
      this.reset();
      await this.initialize();
      return toolResultValue<T>(await this.request<ToolCallResult>("tools/call", { name, arguments: args }));
    }
  }

  private reset() {
    this.sessionId = undefined;
    this.ready = undefined;
  }

  private initialize(): Promise<void> {
    this.ready ??= (async () => {
      await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Send to T3 Code (unofficial)", version: chrome.runtime.getManifest().version },
      });
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })().catch((error: unknown) => {
      this.reset();
      throw error;
    });
    return this.ready;
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params });
    const message = parseRpcBody(response.headers.get("content-type"), await response.text(), id);
    if (message.error) throw new McpError(message.error.message, "protocol", String(message.error.code));
    return message.result as T;
  }

  private async post(body: object): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.origin}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": PROTOCOL_VERSION,
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new McpError(`Could not reach T3 Code at ${this.origin}. Check that the app is running.`, "network");
    }
    this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
    if (response.status === 401) {
      throw new McpError("T3 Code no longer accepts this connection. Reconnect it in the extension settings.", "auth");
    }
    if (response.status === 403) {
      throw new McpError(
        "T3 Code refused the request from Chrome. Reload the extension; if it keeps happening, T3 Code may have changed how it accepts browser requests.",
        "protocol",
        "forbidden",
      );
    }
    if (response.status === 404 && this.sessionId) {
      throw new McpError("The MCP session expired.", "protocol", "session");
    }
    if (!response.ok && response.status !== 202) {
      const detail = await response.text().catch(() => "");
      throw new McpError(`T3 Code returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`, "protocol");
    }
    return response;
  }
}
