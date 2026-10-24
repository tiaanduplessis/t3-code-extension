// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PageContext, SlackContext } from "../shared/capture-types";
import { collectPageContext } from "./page-context";

const globals = globalThis as unknown as Record<string, unknown>;

function selectText(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("collectPageContext", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.title = "Example page";
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    delete globals["__t3SlackCollect"];
  });

  it("collects basic page details and omits empty optional fields", () => {
    const context = collectPageContext();
    expect(context.url).toBe(location.href);
    expect(context.title).toBe("Example page");
    expect(context.viewport).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    });
    expect(["light", "dark"]).toContain(context.colorScheme);
    expect(context.userAgent).toBe(navigator.userAgent);
    expect(context.language).toBe(navigator.language);
    expect(new Date(context.capturedAt).toISOString()).toBe(context.capturedAt);
    expect("description" in context).toBe(false);
    expect("selection" in context).toBe(false);
    expect("slack" in context).toBe(false);
  });

  it("reads the meta description and falls back to og:description", () => {
    document.head.innerHTML = '<meta property="og:description" content="  From OG  ">';
    expect(collectPageContext().description).toBe("From OG");
    document.head.innerHTML += '<meta name="description" content="From meta">';
    expect(collectPageContext().description).toBe("From meta");
  });

  it("trims the selection and caps it at 20,000 characters", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = `   ${"a".repeat(25_000)}   `;
    document.body.append(paragraph);
    selectText(paragraph);
    const selection = collectPageContext().selection;
    expect(selection).toHaveLength(20_000);
    expect(selection?.startsWith("a")).toBe(true);
  });

  it("omits a whitespace-only selection", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "    ";
    document.body.append(paragraph);
    selectText(paragraph);
    expect("selection" in collectPageContext()).toBe(false);
  });

  it("reads the selection inside a textarea", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "hello selected world";
    document.body.append(textarea);
    textarea.focus();
    textarea.setSelectionRange(6, 14);
    expect(collectPageContext().selection).toBe("selected");
  });

  it("never reads a selection inside a password field", () => {
    const input = document.createElement("input");
    input.type = "password";
    input.value = "secret-value";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, 12);
    expect("selection" in collectPageContext()).toBe(false);
  });

  it("includes Slack context when the collector returns a value", () => {
    const slack: SlackContext = { message: { text: "hi" }, threadReplies: [] };
    globals["__t3SlackCollect"] = () => slack;
    expect(collectPageContext().slack).toEqual(slack);
  });

  it("ignores a Slack collector that returns null or throws", () => {
    globals["__t3SlackCollect"] = () => null;
    expect("slack" in collectPageContext()).toBe(false);
    globals["__t3SlackCollect"] = () => {
      throw new Error("broken");
    };
    expect("slack" in collectPageContext()).toBe(false);
  });

  it("works when evaluated from its source alone", () => {
    document.title = "Isolated";
    const isolated = new Function(`return (${collectPageContext.toString()})`)() as () => PageContext;
    const context = isolated();
    expect(context.title).toBe("Isolated");
    expect(context.url).toBe(location.href);
  });
});
