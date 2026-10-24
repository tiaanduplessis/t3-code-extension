// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PickedElement } from "../shared/capture-types";

const sendMessage = vi.fn(() => Promise.resolve());
vi.stubGlobal("chrome", { runtime: { sendMessage } });

const { installPickerBridge, validatePickedElement } = await import("./picker-bridge");

const valid: PickedElement = {
  selector: "#buy",
  tag: "button",
  text: "Buy now",
  attributes: { id: "buy", class: "btn" },
  rect: { x: 1, y: 2, width: 30, height: 40 },
  viewport: { width: 800, height: 600 },
  html: '<button id="buy" class="btn">Buy now</button>',
  framework: { name: "react", components: ["BuyButton", "App"], source: { file: "/src/BuyButton.tsx", line: 4, column: 2 } },
  pageUrl: "https://example.com/",
};

function post(data: unknown, source: unknown = window): void {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

function cancelPending(): void {
  post({ source: "t3-code-picker", type: "cancel" });
}

beforeEach(() => {
  // Importing installed a bridge; consume it so each test installs its own.
  cancelPending();
  sendMessage.mockClear();
});

afterEach(cancelPending);

describe("validatePickedElement", () => {
  it("returns an equal but fresh copy of a valid element", () => {
    const result = validatePickedElement(valid);
    expect(result).toEqual(valid);
    expect(result).not.toBe(valid);
    expect(result!.attributes).not.toBe(valid.attributes);
  });

  it("rejects wrong types", () => {
    expect(validatePickedElement(null)).toBeNull();
    expect(validatePickedElement("x")).toBeNull();
    expect(validatePickedElement({ ...valid, selector: 1 })).toBeNull();
    expect(validatePickedElement({ ...valid, selector: "" })).toBeNull();
    expect(validatePickedElement({ ...valid, text: 5 })).toBeNull();
    expect(validatePickedElement({ ...valid, rect: { x: "1", y: 0, width: 0, height: 0 } })).toBeNull();
    expect(validatePickedElement({ ...valid, rect: { x: Number.NaN, y: 0, width: 0, height: 0 } })).toBeNull();
    expect(validatePickedElement({ ...valid, viewport: null })).toBeNull();
    expect(validatePickedElement({ ...valid, attributes: [] })).toBeNull();
  });

  it("caps strings and drops unknown or invalid parts", () => {
    const result = validatePickedElement({
      ...valid,
      text: "t".repeat(1000),
      html: "h".repeat(10_000),
      extra: "dropped",
      attributes: { id: "x", value: "secret", n: 5, long: "v".repeat(1000) },
      framework: { name: "angular", components: ["X"] },
    })!;
    expect(result.text).toHaveLength(300);
    expect(result.html).toHaveLength(2000);
    expect(result.html.endsWith("...")).toBe(true);
    expect(result).not.toHaveProperty("extra");
    expect(result.attributes).toEqual({ id: "x", long: `${"v".repeat(497)}...` });
    expect(result.framework).toBeUndefined();
  });

  it("limits framework components and validates the source", () => {
    const result = validatePickedElement({
      ...valid,
      framework: { name: "vue", components: ["A1", 2, "B2", "C3", "D4", "E5", "F6"], source: { file: "/x.vue", line: "3" } },
    })!;
    expect(result.framework).toEqual({ name: "vue", components: ["A1", "B2", "C3", "D4", "E5"], source: { file: "/x.vue" } });
  });
});

describe("installPickerBridge", () => {
  it("forwards a valid result once and then stops listening", () => {
    installPickerBridge();
    post({ source: "t3-code-picker", type: "result", element: valid });
    post({ source: "t3-code-picker", type: "result", element: valid });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: "picker:result", element: valid });
  });

  it("forwards a cancel", () => {
    installPickerBridge();
    post({ source: "t3-code-picker", type: "cancel" });
    expect(sendMessage).toHaveBeenCalledWith({ type: "picker:cancel" });
  });

  it("is idempotent", () => {
    installPickerBridge();
    installPickerBridge();
    post({ source: "t3-code-picker", type: "cancel" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("ignores foreign, other-window and malformed messages and keeps waiting", () => {
    installPickerBridge();
    post({ source: "someone-else", type: "cancel" });
    post({ source: "t3-code-picker", type: "cancel" }, null);
    post({ source: "t3-code-picker", type: "result", element: { selector: 1 } });
    post("t3-code-picker");
    expect(sendMessage).not.toHaveBeenCalled();
    post({ source: "t3-code-picker", type: "result", element: valid });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("survives sendMessage throwing", () => {
    sendMessage.mockImplementationOnce(() => {
      throw new Error("Extension context invalidated.");
    });
    installPickerBridge();
    expect(() => post({ source: "t3-code-picker", type: "cancel" })).not.toThrow();
  });
});
