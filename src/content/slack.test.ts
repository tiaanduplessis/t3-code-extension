// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackContext } from "../shared/capture-types";
import { installSlackCollector } from "./slack";

// Synthetic markup mirroring the structure of Slack's web client. No real content.
function message(ts: string, body: string, options: { sender?: string; thread?: "root" | "reply" } = {}): string {
  const classes = ["c-message_kit__background", "c-message_kit__message"];
  if (options.thread) classes.push("c-message_kit__thread_message");
  if (options.thread === "root") classes.push("c-message_kit__thread_message--root");
  const sender = options.sender
    ? `<span class="c-message__sender" data-qa="message_sender" data-stringify-text="${options.sender}">
         <span><button data-qa="message_sender_name">${options.sender}</button></span>
       </span>`
    : "";
  return `
    <div role="listitem" data-qa="virtual-list-item" data-item-key="${ts}">
      <div role="presentation" class="${classes.join(" ")}" data-qa="message_container" data-msg-ts="${ts}" data-msg-channel-id="C100">
        <div role="document" class="c-message_kit__hover">
          <div class="c-message_kit__gutter">
            <div class="c-message_kit__gutter__left" data-stringify-ignore="true"><button aria-hidden="true">avatar</button></div>
            <div class="c-message_kit__gutter__right" data-qa="message_content">
              ${sender}
              <a class="c-link c-timestamp" data-ts="${ts}" aria-label="Today at 10:00 AM"
                 href="/archives/C100/p${ts.replace(".", "")}">
                <span class="c-timestamp__label" data-qa="timestamp_label">10:00 AM</span>
              </a>
              <div class="c-message_kit__blocks">
                <div class="c-message__message_blocks" data-qa="message-text">${body}</div>
              </div>
              <div class="c-reaction_bar" data-qa="reaction_bar" data-stringify-ignore="true">
                <button data-qa="reactji">3</button><button data-qa="add_reaction_button">Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderFixture({ thread = true } = {}): void {
  document.title = "general (Channel) - Example Team - Slack";
  document.body.innerHTML = `
    <div class="p-ia4_home_header_menu__team_name">Example Team</div>
    <div data-qa="channel_name" class="p-view_header__title">general</div>
    <div data-qa="message_pane">
      <div data-qa="slack_kit_list" role="presentation">
        ${message("1700000000.000100", "First message", { sender: "Alex Example" })}
        ${message("1700000060.000200", "Follow-up from same author")}
        ${message("1700000120.000300", "Thread parent", { sender: "Sam Example" })}
      </div>
    </div>
    ${
      thread
        ? `<div data-qa="threads_flexpane">
            <div data-qa="slack_kit_list" role="list">
              ${message("1700000120.000300", "Thread parent", { sender: "Sam Example", thread: "root" })}
              ${message("1700000180.000400", "Reply one", { sender: "Alex Example", thread: "reply" })}
              ${message("1700000240.000500", "Reply two", { sender: "Sam Example", thread: "reply" })}
            </div>
          </div>`
        : ""
    }`;
}

function byTs(ts: string, root: ParentNode = document): Element {
  const element = root.querySelector(`[data-qa="message_container"][data-msg-ts="${ts}"]`);
  if (!element) throw new Error(`missing fixture message ${ts}`);
  return element;
}

function textNodeIn(ts: string): Node {
  const body = byTs(ts).querySelector('[data-qa="message-text"]');
  if (!body?.firstChild) throw new Error("missing text node");
  return body.firstChild;
}

function rightClick(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
}

function hover(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

function selectIn(ts: string): void {
  const range = document.createRange();
  range.selectNodeContents(textNodeIn(ts));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function collect(): SlackContext | null {
  const collector = (globalThis as unknown as Record<string, unknown>)["__t3SlackCollect"] as () => SlackContext | null;
  return collector();
}

describe("Slack collector", () => {
  beforeEach(() => {
    window.getSelection()?.removeAllRanges();
    renderFixture();
    installSlackCollector();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no message was targeted", () => {
    expect(collect()).toBeNull();
  });

  it("extracts the right-clicked message with workspace and channel", () => {
    rightClick(textNodeIn("1700000000.000100"));
    const context = collect();
    expect(context).toEqual({
      workspace: "Example Team",
      channel: "general",
      message: {
        author: "Alex Example",
        timestamp: "Today at 10:00 AM (2023-11-14T22:13:20.000Z)",
        permalink: new URL("/archives/C100/p1700000000000100", location.href).href,
        text: "First message",
      },
      threadReplies: [],
    });
  });

  it("excludes reaction and button chrome from the message text", () => {
    rightClick(byTs("1700000000.000100"));
    const text = collect()?.message.text ?? "";
    expect(text).not.toContain("Add");
    expect(text).not.toContain("3");
  });

  it("finds the author of a continuation message from earlier messages", () => {
    rightClick(byTs("1700000060.000200"));
    expect(collect()?.message.author).toBe("Alex Example");
  });

  it("collects thread replies when the message is the open thread's parent in the channel", () => {
    const channelParent = byTs("1700000120.000300", document.querySelector('[data-qa="message_pane"]') ?? document);
    rightClick(channelParent);
    const replies = collect()?.threadReplies ?? [];
    expect(replies.map((reply) => reply.text)).toEqual(["Reply one", "Reply two"]);
    expect(replies[0]?.author).toBe("Alex Example");
  });

  it("collects thread replies when the message is inside the thread pane", () => {
    const pane = document.querySelector('[data-qa="threads_flexpane"]') ?? document;
    rightClick(byTs("1700000240.000500", pane));
    const context = collect();
    expect(context?.message.text).toBe("Reply two");
    expect(context?.threadReplies).toHaveLength(2);
  });

  it("omits replies for messages outside the open thread", () => {
    rightClick(byTs("1700000000.000100"));
    expect(collect()?.threadReplies).toEqual([]);
  });

  it("caps thread replies at 20", () => {
    const list = document.querySelector('[data-qa="threads_flexpane"] [data-qa="slack_kit_list"]');
    for (let i = 0; i < 25; i++) {
      list?.insertAdjacentHTML("beforeend", message(`1700001000.${String(i).padStart(6, "0")}`, `Extra ${i}`, { sender: "Alex Example", thread: "reply" }));
    }
    rightClick(byTs("1700000120.000300", list ?? document));
    expect(collect()?.threadReplies).toHaveLength(20);
  });

  it("prefers a recent right-click over the selection and hover", () => {
    hover(byTs("1700000060.000200"));
    selectIn("1700000120.000300");
    rightClick(byTs("1700000000.000100"));
    expect(collect()?.message.text).toBe("First message");
  });

  it("falls back to the selection when the right-click is older than 2 minutes", () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    rightClick(byTs("1700000000.000100"));
    hover(byTs("1700000060.000200"));
    selectIn("1700000120.000300");
    clock.mockReturnValue(now + 2 * 60_000 + 1);
    expect(collect()?.message.text).toBe("Thread parent");
  });

  it("falls back to the hovered message without a selection or right-click", () => {
    hover(textNodeIn("1700000060.000200"));
    expect(collect()?.message.text).toBe("Follow-up from same author");
  });

  it("re-finds a right-clicked message that Slack re-rendered", () => {
    rightClick(byTs("1700000000.000100"));
    renderFixture();
    expect(collect()?.message.text).toBe("First message");
  });

  it("falls back to the document title for workspace and channel", () => {
    renderFixture({ thread: false });
    document.querySelector(".p-ia4_home_header_menu__team_name")?.remove();
    document.querySelector('[data-qa="channel_name"]')?.remove();
    document.title = "* random (Channel) - Other Team - Slack";
    rightClick(byTs("1700000000.000100"));
    const context = collect();
    expect(context?.workspace).toBe("Other Team");
    expect(context?.channel).toBe("random");
  });

  it("degrades gracefully when Slack markup changes", () => {
    document.body.innerHTML = `
      <div data-qa="message_container" data-msg-ts="1700000000.000100">
        <div data-qa="message_content"><button>Reply</button>Plain body text</div>
      </div>`;
    document.title = "Slack";
    rightClick(document.querySelector('[data-qa="message_container"]') ?? document);
    expect(collect()).toEqual({
      message: { text: "Plain body text", timestamp: "2023-11-14T22:13:20.000Z" },
      threadReplies: [],
    });
  });
});
