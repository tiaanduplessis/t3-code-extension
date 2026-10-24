import { describe, expect, it } from "vitest";
import type { Diagnostics, PageContext } from "@/shared/capture-types";
import { buildMessage, composeMessage, MAX_MESSAGE_LENGTH, suggestTitle, UNTRUSTED_NOTICE, type PromptParts } from "./prompt";

const page: PageContext = {
  url: "https://app.example.com/orders/42",
  title: "Order 42 [draft]",
  viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
  colorScheme: "dark",
  userAgent: "Mozilla/5.0 Test",
  language: "en-ZA",
  timeZone: "Africa/Johannesburg",
  screen: { width: 1512, height: 982 },
  online: true,
  navigation: { type: "navigate", domContentLoadedMs: 320, loadMs: 1_240, ageMs: 125_000 },
  failedResources: [
    { url: "https://api.example.com/orders", status: 500, initiatorType: "fetch" },
    { url: "https://cdn.example.com/logo.png", status: 404, initiatorType: "img" },
  ],
  capturedAt: "2026-10-24T09:00:00.000Z",
};

const diagnostics: Diagnostics = {
  console: [{ level: "error", message: "TypeError: x is undefined", detail: "at render (app.js:10:5)", timestamp: Date.UTC(2026, 9, 24, 9), count: 3 }],
  network: [{ method: "POST", url: "https://api.example.com/orders", status: 500, statusText: "Internal Server Error", durationMs: 123.4, timestamp: 0 }],
};

function parts(overrides: Partial<PromptParts> = {}): PromptParts {
  return {
    note: "Fix the total on this page.",
    page,
    browser: { browser: "Google Chrome", version: "141.0.7390.55", os: "macOS", osVersion: "15.6.0", arch: "arm-64" },
    includePage: true,
    includeSelection: true,
    includeSlack: true,
    includeConsole: true,
    includeNetwork: true,
    diagnostics: null,
    screenshot: { included: false, annotations: 0 },
    ...overrides,
  };
}

describe("buildMessage", () => {
  it("puts the note first and the page context after a separator", () => {
    const message = buildMessage(parts());
    expect(message.startsWith(`Fix the total on this page.\n\n---\n\n## Context from Chrome\n\n${UNTRUSTED_NOTICE}\n\n`)).toBe(true);
    expect(message).toContain("Page: [Order 42 draft](https://app.example.com/orders/42)");
    expect(message).toContain("### Browser\n\nBrowser: Google Chrome 141.0.7390.55 on macOS 15.6.0 (arm-64)");
    expect(message).toContain("Viewport: 1440x900 at 2x on a 1512x982 screen, dark color scheme");
    expect(message).toContain("Locale: en-ZA, time zone Africa/Johannesburg");
    expect(message).toContain("Page load: navigate 2 min before capture; DOMContentLoaded 320 ms, load 1.2 s");
  });

  it("leaves out context the user turned off", () => {
    const message = buildMessage(
      parts({ page: { ...page, selection: "secret" }, includePage: false, includeSelection: false, diagnostics, includeConsole: false }),
    );
    expect(message).not.toContain("Page:");
    expect(message).not.toContain("### Browser");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("Console");
    expect(message).toContain("POST https://api.example.com/orders -> 500 Internal Server Error (123 ms)");
    // Resource Timing adds the 404 the console did not report, without repeating the 500.
    expect(message).toContain("https://cdn.example.com/logo.png -> 404 img");
    expect(message.match(/api\.example\.com\/orders -> 500/g)).toHaveLength(1);
  });

  it("quotes Slack messages with their replies and permalink", () => {
    const message = buildMessage(
      parts({
        note: "",
        page: {
          ...page,
          slack: {
            workspace: "Acme",
            channel: "eng",
            message: { author: "Sam", timestamp: "10:02", permalink: "https://acme.slack.com/archives/C1/p1", text: "Checkout is broken\non mobile" },
            threadReplies: [{ author: "Lee", text: "Same here" }],
          },
        },
      }),
    );
    expect(message.startsWith("## Context from Chrome")).toBe(true);
    expect(message).toContain("### Slack message in Acme / #eng");
    expect(message).toContain("From Sam (10:02):\n\n> Checkout is broken\n> on mobile");
    expect(message).toContain("Permalink: https://acme.slack.com/archives/C1/p1");
    expect(message).toContain("Lee:\n> Same here");
  });

  it("fences console output with a fence longer than any backticks inside", () => {
    const message = buildMessage(
      parts({ diagnostics: { ...diagnostics, console: [{ ...diagnostics.console[0]!, message: "bad ``` fence" }] } }),
    );
    expect(message).toContain("````\n[09:00:00.000] error (x3): bad ``` fence");
  });

  it("drops a stack's first line when it repeats the message", () => {
    const message = buildMessage(
      parts({
        diagnostics: {
          ...diagnostics,
          console: [{ ...diagnostics.console[0]!, message: "Error: boom", detail: "Error: boom\n    at a (x.js:1:1)" }],
        },
      }),
    );
    expect(message).toContain("error (x3): Error: boom\n    at a (x.js:1:1)\n");
  });

  it("describes the screenshot and its marked areas", () => {
    expect(buildMessage(parts({ screenshot: { included: true, annotations: 0 } }))).toContain("A screenshot of the visible tab is attached.");
    expect(buildMessage(parts({ screenshot: { included: true, annotations: 1 } }))).toContain("The area outlined in red marks");
    expect(buildMessage(parts({ screenshot: { included: true, annotations: 2 } }))).toContain("The 2 areas outlined in red mark");
  });

  it("falls back to the user agent when browser details are unavailable", () => {
    expect(buildMessage(parts({ browser: null }))).toContain("User agent: Mozilla/5.0 Test");
  });

  it("falls back to the tab address when the page could not be read", () => {
    const message = buildMessage(parts({ page: null, tab: { url: "chrome://settings", title: "Settings" } }));
    expect(message).toContain("Page: [Settings](chrome://settings)");
  });

  it("redacts captured context but not the user's note", () => {
    const { message, redactions } = composeMessage(
      parts({
        note: "My token is ghp_abcdefghijklmnopqrstuvwxyz0123456789 and that is fine",
        page: { ...page, url: "https://app.example.com/orders?access_token=abc123", selection: "Bearer abcdefghijklmnopq" },
      }),
    );
    expect(message).toContain("My token is ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(message).toContain("(https://app.example.com/orders?access_token=[redacted])");
    expect(message).toContain("> Bearer [redacted]");
    expect(message).toContain("Masked before sending: 1 authorization header, 1 URL parameter.");
    expect(redactions).toEqual({ "URL parameter": 1, "authorization header": 1 });
  });

  it("describes a recording and includes response excerpts", () => {
    const message = buildMessage(
      parts({
        page: { ...page, failedResources: [] },
        diagnostics: {
          console: [],
          network: [{ method: "POST", url: "https://api.example.com/cart", status: 422, statusText: "Unprocessable", durationMs: 80, timestamp: 0, responseExcerpt: '{\n  "error": "discount expired"\n}' }],
          recording: { durationMs: 42_000, requests: 37 },
        },
      }),
    );
    expect(message).toContain("The user recorded 42.0 s of activity while reproducing the problem (37 requests).");
    expect(message).toContain('POST https://api.example.com/cart -> 422 Unprocessable (80 ms)\n    response: { "error": "discount expired" }');
  });

  it("describes a picked element with its component and source", () => {
    const message = buildMessage(
      parts({
        picked: {
          selector: "#pay",
          tag: "button",
          text: "Pay now",
          attributes: { id: "pay", type: "submit" },
          rect: { x: 10.4, y: 20, width: 100, height: 32 },
          viewport: { width: 1280, height: 800 },
          html: '<button id="pay" type="submit">Pay now</button>',
          framework: { name: "react", components: ["PayButton", "Checkout"], source: { file: "src/checkout/PayButton.tsx", line: 12, column: 5 } },
          pageUrl: page.url,
        },
      }),
    );
    expect(message).toContain("### Element the user picked\n\nSelector: `#pay`\nComponent (react): PayButton < Checkout\nSource: src/checkout/PayButton.tsx:12:5\nText: Pay now");
    expect(message).toContain('Attributes: id="pay" type="submit"');
    expect(message).toContain("Position: 100x32 at (10, 20) in a 1280x800 viewport");
    expect(buildMessage(parts({ includeElement: false, picked: { selector: "#x", tag: "a", attributes: {}, rect: { x: 0, y: 0, width: 1, height: 1 }, viewport: { width: 1, height: 1 }, html: "", pageUrl: "" } }))).not.toContain("Element the user picked");
  });

  it("stays within T3 Code's message limit", () => {
    const message = buildMessage(parts({ note: "x".repeat(MAX_MESSAGE_LENGTH + 5_000) }));
    expect(message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  });
});

describe("suggestTitle", () => {
  it("prefers the first line of the note", () => {
    expect(suggestTitle("Fix the  total\nmore detail", page, true)).toBe("Fix the total");
  });

  it("uses the Slack message, then the page title", () => {
    const slackPage = { ...page, slack: { message: { text: "Checkout is broken\nmore" }, threadReplies: [] } };
    expect(suggestTitle("", slackPage, true)).toBe("Slack: Checkout is broken");
    expect(suggestTitle("", slackPage, false)).toBe("Order 42 [draft]");
    expect(suggestTitle("", null, false)).toBe("Task from Chrome");
  });

  it("caps long titles", () => {
    expect(suggestTitle("a".repeat(200), page, false)).toHaveLength(80);
  });
});
