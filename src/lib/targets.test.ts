import { describe, expect, it } from "vitest";
import { environmentLabels, exceedsCeiling, parseScopedKey, parseSiteTarget, scopedKey, siteTarget } from "./targets";

describe("targets", () => {
  it("round-trips scoped keys, including ids with colons", () => {
    const key = scopedKey("env-1", "mcp:abc");
    expect(parseScopedKey(key)).toEqual({ environmentId: "env-1", id: "mcp:abc" });
    expect(parseScopedKey("plain")).toBeNull();
    expect(parseScopedKey(undefined)).toBeNull();
  });

  it("round-trips site targets", () => {
    expect(parseSiteTarget(siteTarget("existing", scopedKey("e", "t")))).toEqual({ mode: "existing", key: "e::t" });
    expect(parseSiteTarget("bogus")).toBeNull();
  });

  it("compares runtime modes against the ceiling", () => {
    expect(exceedsCeiling("full-access", "approval-required")).toBe(true);
    expect(exceedsCeiling("auto", "auto")).toBe(false);
    expect(exceedsCeiling("approval-required", "full-access")).toBe(false);
  });

  it("adds the address to environment names that clash", () => {
    expect(
      environmentLabels([
        { environmentId: "a", label: "Mac", origin: "http://127.0.0.1:3773" },
        { environmentId: "b", label: "Mac", origin: "http://127.0.0.1:3774" },
        { environmentId: "c", label: "Server", origin: "https://box.ts.net" },
      ]),
    ).toEqual({ a: "Mac (127.0.0.1:3773)", b: "Mac (127.0.0.1:3774)", c: "Server" });
  });
});
