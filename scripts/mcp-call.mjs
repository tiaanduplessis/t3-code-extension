#!/usr/bin/env node
// Calls T3 Code MCP tools as an outside client, the way the extension does.
// Pairs with a short-lived code from the `t3` CLI, runs the calls, prints the
// results and revokes the session.
//
// Usage: node scripts/mcp-call.mjs '<tool>' '<json args>' ['<tool>' '<json args>' ...]
//   e.g. node scripts/mcp-call.mjs t3_thread_search '{"query":"auth","limit":3}'
// Environment: T3_ORIGIN (default http://127.0.0.1:3773), T3_BASE_DIR for a
// server started with --base-dir, T3_ACCESS for the approved access level,
// T3_PAIRING_SCOPES=limited to mint a read/operate-only pairing code.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const origin = process.env.T3_ORIGIN ?? "http://127.0.0.1:3773";
const t3 = join(homedir(), ".t3", "bin", "t3");
const baseDirArgs = process.env.T3_BASE_DIR ? ["--base-dir", process.env.T3_BASE_DIR] : [];
// Full access also needs the settings scopes, which the default scope set includes.
const limitedScopes = ["--scope", "orchestration:read", "--scope", "orchestration:operate"];
const scopeArgs =
  process.env.T3_PAIRING_SCOPES === "limited" ? limitedScopes : process.env.T3_ACCESS === "full-access" ? [] : limitedScopes;
const redirectUri = "https://mcpcallmcpcallmcpcallmcpcallmc.chromiumapp.org/oauth";
const calls = process.argv.slice(2);
if (calls.length === 0 || calls.length % 2 !== 0) {
  console.error("Pass pairs of tool name and JSON arguments.");
  process.exit(1);
}

const json = async (response) => JSON.parse(await response.text());
const client = await json(
  await fetch(`${origin}/oauth/mcp/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Send to T3 Code (unofficial) (mcp-call)",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }),
);
const verifier = randomBytes(32).toString("base64url");
const authorization = {
  response_type: "code",
  client_id: client.client_id,
  redirect_uri: redirectUri,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
  state: "state",
  resource: `${origin}/mcp`,
};
const code = JSON.parse(
  execFileSync(t3, ["auth", "pairing", "create", ...baseDirArgs, "--json", "--ttl", "2m", ...scopeArgs], {
    encoding: "utf8",
  }),
).credential;
const decision = await json(
  await fetch(`${origin}/oauth/mcp/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authorization, decision: { _tag: "pairing-code", access: process.env.T3_ACCESS ?? "approval-required", code } }),
  }),
);
if (!decision.redirectTo) throw new Error(`Approval failed: ${JSON.stringify(decision)}`);
const token = await json(
  await fetch(`${origin}/oauth/mcp/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: new URL(decision.redirectTo).searchParams.get("code"),
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    }),
  }),
);

let sessionId;
let nextId = 1;
async function rpc(method, params, notification = false) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: nextId++, method, params }),
  });
  sessionId = response.headers.get("mcp-session-id") ?? sessionId;
  const text = await response.text();
  if (!text) return null;
  const data = text.includes("data:") ? text.split("\n").filter((line) => line.startsWith("data:")).at(-1).slice(5) : text;
  return JSON.parse(data);
}

try {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-call", version: "0" } });
  await rpc("notifications/initialized", {}, true);
  for (let index = 0; index < calls.length; index += 2) {
    const response = await rpc("tools/call", { name: calls[index], arguments: JSON.parse(calls[index + 1]) });
    const result = response.result?.structuredContent ?? response.result?.content?.[0]?.text ?? response.error;
    const max = Number(process.env.MAX ?? 2000);
    console.log(`\n== ${calls[index]}\n${(typeof result === "string" ? result : JSON.stringify(result)).slice(0, max)}`);
  }
} finally {
  const claims = JSON.parse(Buffer.from(token.access_token.split(".")[0], "base64url").toString("utf8"));
  execFileSync(t3, ["auth", "session", "revoke", ...baseDirArgs, claims.sid]);
}
