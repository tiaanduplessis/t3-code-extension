#!/usr/bin/env node
// Checks the T3 Code server contract the extension depends on: discovery,
// OAuth client registration, pairing-code approval, token exchange and the
// MCP tool list. Mints a short-lived pairing code with the local `t3` CLI.
//
// Usage: node scripts/contract-check.mjs [origin] [--schemas] [--launch]
//   --schemas  print every tool schema
//   --launch   launch a scratch thread with a 1x1 screenshot (starts an agent run)
// The MCP session created here is revoked before the script exits.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const origin = (process.argv.find((arg) => arg.startsWith("http")) ?? "http://127.0.0.1:3773").replace(/\/$/, "");
const redirectUri = "https://contractcheckcontractcheckcontract.chromiumapp.org/oauth";

const base64Url = (buffer) => buffer.toString("base64url");

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${response.status} ${response.url}: ${text.slice(0, 300)}`);
  }
}

function parseMcpBody(contentType, text) {
  if (!contentType?.includes("text/event-stream")) return JSON.parse(text);
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return JSON.parse(data.at(-1));
}

function step(label, value) {
  console.log(`\n== ${label}`);
  if (value !== undefined) console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

const environment = await json(await fetch(`${origin}/.well-known/t3/environment`));
step("environment", { environmentId: environment.environmentId, label: environment.label, serverVersion: environment.serverVersion });

const metadata = await json(await fetch(`${origin}/.well-known/oauth-authorization-server`));
const client = await json(
  await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "T3 Code for Chrome (contract check)",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }),
);
step("registered client", { client_id: `${client.client_id.slice(0, 24)}...` });

const verifier = base64Url(randomBytes(32));
const challenge = base64Url(createHash("sha256").update(verifier).digest());
const state = base64Url(randomBytes(16));
const authorization = {
  response_type: "code",
  client_id: client.client_id,
  redirect_uri: redirectUri,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
  resource: `${origin}/mcp`,
};

const approvalResponse = await fetch(`${origin}/oauth/mcp/approval`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(authorization),
});
step("approval details", await json(approvalResponse));

const t3 = join(homedir(), ".t3", "bin", "t3");
const pairing = JSON.parse(
  execFileSync(
    t3,
    ["auth", "pairing", "create", "--json", "--ttl", "5m", "--label", "Chrome extension contract check", "--scope", "orchestration:read", "--scope", "orchestration:operate"],
    { encoding: "utf8" },
  ),
);
const code = pairing.credential ?? pairing.token ?? pairing.code;
step("pairing token minted", Object.keys(pairing));

const decision = await json(
  await fetch(`${origin}/oauth/mcp/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authorization, decision: { _tag: "pairing-code", access: "approval-required", code } }),
  }),
);
const redirect = new URL(decision.redirectTo);
step("decision redirect", { host: redirect.host, params: [...redirect.searchParams.keys()] });
if (redirect.searchParams.get("state") !== state) throw new Error("state mismatch");

const token = await json(
  await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code"),
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    }),
  }),
);
step("token", { token_type: token.token_type, expires_in: token.expires_in, scope: token.scope });

let sessionId;
let nextId = 1;
async function rpc(method, params, notification = false) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify(notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: nextId++, method, params }),
  });
  sessionId = response.headers.get("mcp-session-id") ?? sessionId;
  const text = await response.text();
  if (notification || !text) return { status: response.status };
  return parseMcpBody(response.headers.get("content-type"), text);
}

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contract-check", version: "0.0.0" } });
step("initialize", { serverInfo: init.result?.serverInfo, protocolVersion: init.result?.protocolVersion, sessionId: Boolean(sessionId), instructions: init.result?.instructions?.slice(0, 200) });
await rpc("notifications/initialized", {}, true);

const tools = await rpc("tools/list", {});
step("tools", tools.result.tools.map((tool) => tool.name));
if (process.argv.includes("--schemas")) step("schemas", tools.result.tools);

const projects = await rpc("tools/call", { name: "t3_project_list", arguments: { limit: 2 } });
step("t3_project_list", JSON.stringify(projects.result).slice(0, 600));

function toolResult(response) {
  const result = response.result;
  if (!result) throw new Error(JSON.stringify(response.error));
  const value = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "null");
  if (result.isError || value?._tag === "OrchestratorMcpFailure") throw new Error(value?.message ?? "Tool failed");
  return value;
}

try {
  if (process.argv.includes("--launch")) {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const upload = toolResult(
      await rpc("tools/call", {
        name: "t3_attachment_prepare_upload",
        arguments: { upload: { type: "image", name: "contract-check.png", mimeType: "image/png", sizeBytes: png.length } },
      }),
    );
    const uploaded = await fetch(`${origin}${upload.relativeUrl}`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
    step("upload", uploaded.status);
    const launch = toolResult(
      await rpc("tools/call", {
        name: "t3_thread_launch",
        arguments: {
          scratch: true,
          title: "Chrome extension contract check",
          message: "Connectivity test from the T3 Code Chrome extension. Reply with OK and stop.",
          attachments: [{ type: "image", id: upload.attachmentId, name: "contract-check.png", mimeType: "image/png", sizeBytes: png.length }],
        },
      }),
    );
    step("t3_thread_launch", launch);
  }
} finally {
  const sessionClaims = JSON.parse(Buffer.from(token.access_token.split(".")[0], "base64url").toString("utf8"));
  execFileSync(t3, ["auth", "session", "revoke", sessionClaims.sid]);
  step("revoked contract-check session", sessionClaims.sid);
}
