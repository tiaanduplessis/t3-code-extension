import { describe, expect, it } from "vitest";
import { diagnosticsFromEvents, formatRemoteObject, type DebuggerEvent } from "./console-reader";

const events: DebuggerEvent[] = [
  { method: "Runtime.executionContextCreated", params: { context: { id: 1, auxData: { isDefault: true, type: "default" } } } },
  { method: "Runtime.executionContextCreated", params: { context: { id: 2, auxData: { isDefault: false, type: "isolated" } } } },
  { method: "Runtime.consoleAPICalled", params: { type: "log", executionContextId: 1, timestamp: 1, args: [{ type: "string", value: "noise" }] } },
  {
    method: "Runtime.consoleAPICalled",
    params: {
      type: "error",
      executionContextId: 1,
      timestamp: 2,
      args: [
        { type: "string", value: "Checkout failed" },
        { type: "object", preview: { properties: [{ name: "code", value: "42" }], overflow: true } },
      ],
      stackTrace: { callFrames: [{ functionName: "pay", url: "https://app/x.js", lineNumber: 9, columnNumber: 4 }] },
    },
  },
  { method: "Runtime.consoleAPICalled", params: { type: "error", executionContextId: 2, timestamp: 3, args: [{ type: "string", value: "other extension" }] } },
  { method: "Runtime.consoleAPICalled", params: { type: "warning", executionContextId: 1, timestamp: 4, args: [{ type: "string", value: "slow" }] } },
  { method: "Runtime.consoleAPICalled", params: { type: "warning", executionContextId: 1, timestamp: 5, args: [{ type: "string", value: "slow" }] } },
  {
    method: "Runtime.exceptionThrown",
    params: {
      timestamp: 6,
      exceptionDetails: {
        text: "Uncaught",
        executionContextId: 1,
        exception: { type: "object", subtype: "error", description: "TypeError: x is undefined\n    at render (app.js:1:1)" },
      },
    },
  },
  {
    method: "Runtime.exceptionThrown",
    params: { timestamp: 7, exceptionDetails: { text: "Uncaught (in promise)", executionContextId: 1, exception: { type: "string", value: "nope" } } },
  },
  {
    method: "Log.entryAdded",
    params: { entry: { source: "network", level: "error", url: "https://api/cart", text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)", timestamp: 8 } },
  },
  {
    method: "Log.entryAdded",
    params: { entry: { source: "network", level: "error", url: "https://cdn/x.js", text: "Failed to load resource: net::ERR_NAME_NOT_RESOLVED", timestamp: 9 } },
  },
  { method: "Log.entryAdded", params: { entry: { source: "intervention", level: "warning", text: "Blocked autoplay", timestamp: 10 } } },
  { method: "Log.entryAdded", params: { entry: { source: "other", level: "verbose", text: "ignored", timestamp: 11 } } },
];

describe("diagnosticsFromEvents", () => {
  const result = diagnosticsFromEvents(events);

  it("keeps errors and warnings from the page and drops logs and isolated worlds", () => {
    expect(result.console.map((entry) => [entry.level, entry.message, entry.count])).toEqual([
      ["error", "Checkout failed {code: 42, ...}", 1],
      ["warn", "slow", 2],
      ["uncaught", "TypeError: x is undefined", 1],
      ["unhandledrejection", "nope", 1],
      ["warn", "[intervention] Blocked autoplay", 1],
    ]);
  });

  it("keeps stacks as detail", () => {
    expect(result.console[0]?.detail).toBe("at pay (https://app/x.js:10:5)");
    expect(result.console[2]?.detail).toBe("at render (app.js:1:1)");
  });

  it("turns failed resource logs into network failures", () => {
    expect(result.network).toEqual([
      { url: "https://api/cart", status: 500, statusText: "Internal Server Error", timestamp: 8 },
      { url: "https://cdn/x.js", status: null, statusText: "net::ERR_NAME_NOT_RESOLVED", timestamp: 9 },
    ]);
  });
});

describe("formatRemoteObject", () => {
  it("formats primitives, arrays and plain descriptions", () => {
    expect(formatRemoteObject({ type: "number", value: 3 })).toBe("3");
    expect(formatRemoteObject({ type: "number", unserializableValue: "NaN" })).toBe("NaN");
    expect(formatRemoteObject({ type: "object", subtype: "array", preview: { properties: [{ name: "0", value: "1" }] } })).toBe("[0: 1]");
    expect(formatRemoteObject({ type: "object", subtype: "null", value: null })).toBe("null");
    expect(formatRemoteObject({ type: "function", description: "function f() {}" })).toBe("function f() {}");
  });
});
