// Connects the extension to a T3 Code environment as an MCP client. T3 Code
// approves outside MCP clients through OAuth (dynamic registration + PKCE).
// The user proves ownership with a pairing code from T3 Code, which the
// extension submits to the approval endpoint directly. The redirect URI is
// only used as an identifier: the extension reads the code from the returned
// redirect instead of visiting it.

import type { RuntimeMode } from "./t3";

export interface PairingInput {
  code: string;
  /** Origin taken from a pasted pairing link, when one was pasted. */
  origin?: string;
}

export interface ConnectResult {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

export class PairingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingError";
  }
}

const CLIENT_NAME = "T3 Code for Chrome";

/** Accepts a bare pairing code or a full pairing link (…/pair#token=CODE). */
export function parsePairingInput(input: string): PairingInput {
  const value = input.trim();
  if (!value) throw new PairingError("Enter a pairing code or pairing link.");
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const hash = new URLSearchParams(url.hash.slice(1));
    const code = hash.get("token") ?? url.searchParams.get("token");
    if (!code) throw new PairingError("This pairing link has no token. Create a new pairing link in T3 Code.");
    // Links opened through a hosted page name the backend in a host parameter;
    // otherwise the link is served by the backend itself.
    const host = hash.get("host") ?? url.searchParams.get("host");
    return { code, origin: host ? normalizeOrigin(host) : url.origin };
  }
  return { code: value };
}

export function normalizeOrigin(input: string): string {
  const value = input.trim() || "http://127.0.0.1:3773";
  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  return url.origin;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function readJson<T>(response: Response, action: string): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new PairingError(`${action} failed: T3 Code returned an unexpected response (${response.status}).`);
  }
  if (!response.ok) {
    const error = body as { message?: string; error_description?: string; error?: string };
    throw new PairingError(error.message ?? error.error_description ?? error.error ?? `${action} failed (${response.status}).`);
  }
  return body as T;
}

async function request<T>(url: string, init: RequestInit, action: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new PairingError(`Could not reach T3 Code at ${new URL(url).origin}. Check that the app is running.`);
  }
  return readJson<T>(response, action);
}

export async function connectWithPairingCode(input: {
  origin: string;
  code: string;
  access: RuntimeMode;
}): Promise<ConnectResult> {
  const { origin, code, access } = input;
  const metadata = await request<{ registration_endpoint: string; token_endpoint: string }>(
    `${origin}/.well-known/oauth-authorization-server`,
    {},
    "Discovery",
  );

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/oauth`;
  const client = await request<{ client_id: string }>(
    metadata.registration_endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    },
    "Client registration",
  );

  const { verifier, challenge } = await createPkcePair();
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const resource = `${origin}/mcp`;
  const authorization = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource,
  };

  const decision = await request<{ redirectTo: string }>(
    `${origin}/oauth/mcp/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authorization, decision: { _tag: "pairing-code", access, code } }),
    },
    "Approval",
  );

  const redirect = new URL(decision.redirectTo);
  const redirectError = redirect.searchParams.get("error_description") ?? redirect.searchParams.get("error");
  if (redirectError) throw new PairingError(redirectError);
  if (redirect.searchParams.get("state") !== state) throw new PairingError("T3 Code returned a mismatched approval. Try again.");
  const authorizationCode = redirect.searchParams.get("code");
  if (!authorizationCode) throw new PairingError("T3 Code did not return an authorization code.");

  const token = await request<{ access_token: string; expires_in: number; scope: string }>(
    metadata.token_endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: verifier,
        resource,
      }),
    },
    "Token exchange",
  );

  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope,
  };
}
