import { describe, expect, it } from "vitest";
import { describeRedactions, redact, totalRedactions } from "./redact";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("redact", () => {
  it("masks JWTs and authorization headers", () => {
    const { text, counts } = redact(`token ${jwt} and Authorization: Bearer abcdefghijklmnop123`);
    expect(text).not.toContain(jwt);
    expect(text).toContain("Bearer [redacted]");
    expect(counts).toEqual({ JWT: 1, "authorization header": 1 });
  });

  it("masks well-known API key formats", () => {
    const keys = [
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "AKIAIOSFODNN7EXAMPLE",
      "sk_live_abcdefghijklmnop1234",
      "xoxb-123456789012-abcdefghij",
    ];
    const { text, counts } = redact(keys.join(" "));
    for (const key of keys) expect(text).not.toContain(key);
    expect(counts["API key"]).toBe(5);
  });

  it("masks sensitive URL parameters and credentials but keeps the rest of the URL", () => {
    const { text } = redact("GET https://user:hunter2@api.example.com/cart?id=42&access_token=abc123&page=2 -> 500");
    expect(text).toBe("GET https://[redacted]@api.example.com/cart?id=42&access_token=[redacted]&page=2 -> 500");
  });

  it("stops a URL parameter at a closing parenthesis, as in markdown links", () => {
    expect(redact("[Orders](https://a.example/o?token=abc)").text).toBe("[Orders](https://a.example/o?token=[redacted])");
  });

  it("masks secret fields in JSON and assignments", () => {
    const { text, counts } = redact(`{"password": "hunter2", "user": "sam", "apiKey": "abcd1234"} client_secret='zzzz9999'`);
    expect(text).toBe(`{"password": "[redacted]", "user": "sam", "apiKey": "[redacted]"} client_secret='[redacted]'`);
    expect(totalRedactions(counts)).toBe(3);
  });

  it("masks private keys", () => {
    const { text } = redact("-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----");
    expect(text).toBe("-----BEGIN PRIVATE KEY----- [redacted] -----END PRIVATE KEY-----");
  });

  it("leaves ordinary text alone", () => {
    const input = "TypeError: Cannot read properties of undefined (reading 'discount') at https://shop.example.com/checkout?step=2";
    expect(redact(input)).toEqual({ text: input, counts: {} });
  });

  it("describes what was masked", () => {
    expect(describeRedactions({ JWT: 2, "API key": 1 })).toBe("2 JWTs, 1 API key");
  });
});
