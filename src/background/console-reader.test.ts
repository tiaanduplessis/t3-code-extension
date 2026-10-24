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

describe("diagnosticsFromEvents with a frame resolver", () => {
  const frame = { functionName: "a", url: "https://app/main.min.js", lineNumber: 0, columnNumber: 4821 };
  const mapped: DebuggerEvent[] = [
    {
      method: "Runtime.consoleAPICalled",
      params: { type: "error", timestamp: 1, args: [{ type: "string", value: "Checkout failed" }], stackTrace: { callFrames: [frame] } },
    },
    {
      method: "Runtime.exceptionThrown",
      params: {
        timestamp: 2,
        exceptionDetails: {
          text: "Uncaught",
          exception: { type: "object", description: "TypeError: x is undefined\n    at a (https://app/main.min.js:1:4822)" },
          stackTrace: { callFrames: [frame] },
        },
      },
    },
  ];
  const resolve = (input: { url: string; columnNumber: number }) =>
    input.url === "https://app/main.min.js" && input.columnNumber === 4821 ? { source: "src/checkout/total.ts", line: 42, column: 7, name: "applyDiscount" } : null;

  it("maps console and exception frames to original sources", () => {
    const result = diagnosticsFromEvents(mapped, resolve);
    expect(result.console[0]?.detail).toBe("at applyDiscount (src/checkout/total.ts:42:7)");
    expect(result.console[1]?.detail).toBe("at applyDiscount (src/checkout/total.ts:42:7)");
    expect(result.console[1]?.message).toBe("TypeError: x is undefined");
  });

  it("keeps the original frames when a frame has no mapping", () => {
    const result = diagnosticsFromEvents(mapped, () => null);
    expect(result.console[0]?.detail).toBe("at a (https://app/main.min.js:1:4822)");
  });
});

describe("logged Error objects", () => {
  it("keep only their first line when the call has its own stack", () => {
    const result = diagnosticsFromEvents([
      {
        method: "Runtime.consoleAPICalled",
        params: {
          type: "error",
          timestamp: 1,
          args: [{ type: "object", subtype: "error", description: "Error: Checkout boot failed\n    at n (https://app/main.min.js:1:71)" }],
          stackTrace: { callFrames: [{ functionName: "n", url: "https://app/main.min.js", lineNumber: 0, columnNumber: 64 }] },
        },
      },
    ]);
    expect(result.console[0]?.message).toBe("Error: Checkout boot failed");
    expect(result.console[0]?.detail).toBe("at n (https://app/main.min.js:1:65)");
  });
});

