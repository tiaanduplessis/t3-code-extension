import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("chrome", {
    declarativeNetRequest: {
      RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
      HeaderOperation: { REMOVE: "remove" },
    },
  });
});

describe("originRules", () => {
  it("removes Origin only on the extension's own requests to each /mcp endpoint", async () => {
    const { originRules } = await import("./origin-rules");
    const rules = originRules(["http://127.0.0.1:3773", "https://mac.tailnet.ts.net", "http://127.0.0.1:3773"], "extid");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({
      id: 1,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
      condition: { urlFilter: "|http://127.0.0.1:3773/mcp", initiatorDomains: ["extid"] },
    });
    expect(rules[1]?.condition.urlFilter).toBe("|https://mac.tailnet.ts.net/mcp");
  });
});
