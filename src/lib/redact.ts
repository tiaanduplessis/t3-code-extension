// Masks likely secrets in captured page context before it leaves the browser.
// Everything sent reaches the user's model provider, and URLs, console output
// and failed responses often carry tokens. Patterns favour known formats and
// clearly named fields over guessing, so ordinary text is left alone.

export interface Redaction {
  text: string;
  /** How many values were masked, per kind. */
  counts: Record<string, number>;
}

interface Rule {
  kind: string;
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

const MASK = "[redacted]";

const SENSITIVE_NAMES =
  "access_token|id_token|refresh_token|auth_token|token|api_key|apikey|api-key|key|secret|client_secret|password|passwd|pwd|auth|session|sessionid|session_id|sig|signature|code|credential|credentials";

const RULES: Rule[] = [
  {
    kind: "private key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => `-----BEGIN PRIVATE KEY----- ${MASK} -----END PRIVATE KEY-----`,
  },
  {
    kind: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: () => `${MASK} JWT`,
  },
  {
    kind: "authorization header",
    pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replace: (_match, scheme) => `${scheme} ${MASK}`,
  },
  {
    kind: "API key",
    pattern:
      /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{36}|SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g,
    replace: () => MASK,
  },
  {
    kind: "URL credentials",
    pattern: /\b(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g,
    replace: (_match, scheme) => `${scheme}${MASK}@`,
  },
  {
    kind: "URL parameter",
    pattern: new RegExp(`([?&#;](?:${SENSITIVE_NAMES})=)[^&#\\s"'<>()]+`, "gi"),
    replace: (_match, prefix) => `${prefix}${MASK}`,
  },
  {
    kind: "secret field",
    pattern: new RegExp(`(["']?(?:${SENSITIVE_NAMES}|authorization|apiKey|accessToken|refreshToken|clientSecret)["']?\\s*[:=]\\s*["'])[^"'\\n]{4,}(["'])`, "gi"),
    replace: (_match, prefix, quote) => `${prefix}${MASK}${quote}`,
  },
];

export function redact(text: string): Redaction {
  const counts: Record<string, number> = {};
  let result = text;
  for (const rule of RULES) {
    result = result.replace(rule.pattern, (match, ...groups: unknown[]) => {
      // Already masked by an earlier rule.
      if (match.includes(MASK)) return match;
      counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
      return rule.replace(match, ...(groups.filter((group) => typeof group === "string") as string[]));
    });
  }
  return { text: result, counts };
}

export function totalRedactions(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export function describeRedactions(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([kind, count]) => (count > 1 ? `${count} ${kind}s` : `1 ${kind}`))
    .join(", ");
}
