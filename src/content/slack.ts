import { SLACK_COLLECTOR_KEY, type SlackContext, type SlackMessage } from "../shared/capture-types";

// Slack web client markup, checked against app.slack.com in October 2026.
// Update here when Slack changes its DOM; every lookup degrades to null.
const SELECTORS = {
  message: '[data-qa="message_container"]',
  listItem: '[data-qa="virtual-list-item"], [role="listitem"]',
  senderName: '[data-qa="message_sender_name"]',
  sender: '[data-qa="message_sender"]',
  timestampLink: "a.c-timestamp, a[data-ts]",
  timestampLabel: '[data-qa="timestamp_label"]',
  messageText: '[data-qa="message-text"]',
  messageContent: '[data-qa="message_content"]',
  // Removed from the fallback text extraction when message-text is missing.
  chrome: '[data-stringify-ignore], [data-qa="message_sender"], a.c-timestamp, [data-qa="reaction_bar"], [data-qa="reply_bar"], button',
  workspaceName: '.p-ia4_home_header_menu__team_name, [data-qa="workspace_actions_button"]',
  channelName: '[data-qa="channel_name"], [data-qa="channel_name_button"]',
  threadPane: '[data-qa="threads_flexpane"]',
  threadRoot: ".c-message_kit__thread_message--root",
} as const;

const RIGHT_CLICK_TTL_MS = 2 * 60_000;
const MAX_THREAD_REPLIES = 20;
// Consecutive messages from one author omit the sender; look this far back for it.
const MAX_SENDER_LOOKBACK = 30;

interface MessageRef {
  element: Element;
  ts: string | null;
  at: number;
}

function toElement(node: EventTarget | Node | null): Element | null {
  if (node instanceof Element) return node;
  if (node instanceof Node) return node.parentElement;
  return null;
}

function findMessage(node: EventTarget | Node | null): Element | null {
  return toElement(node)?.closest(SELECTORS.message) ?? null;
}

function refFor(message: Element): MessageRef {
  return { element: message, ts: message.getAttribute("data-msg-ts"), at: Date.now() };
}

// Slack virtualizes its lists, so a remembered element may have been unmounted
// and re-rendered. Fall back to looking the message up by its timestamp.
function resolve(ref: MessageRef | null): Element | null {
  if (!ref) return null;
  if (ref.element.isConnected) return ref.element;
  if (ref.ts && /^[\d.]+$/.test(ref.ts)) {
    return document.querySelector(`${SELECTORS.message}[data-msg-ts="${ref.ts}"]`);
  }
  return null;
}

function text(element: Element | null | undefined): string {
  if (!element) return "";
  const html = element as HTMLElement;
  return (html.innerText || html.textContent || "").trim();
}

function titleSegments(): string[] {
  return document.title
    .replace(/^[!*]\s+/, "")
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function workspaceName(): string | undefined {
  const fromHeader = text(document.querySelector(SELECTORS.workspaceName));
  if (fromHeader) return fromHeader;
  // Title format: "<channel> (Channel) - <workspace> - Slack".
  const segments = titleSegments();
  return segments.length >= 3 ? segments[segments.length - 2] : undefined;
}

function channelName(): string | undefined {
  const fromHeader = text(document.querySelector(SELECTORS.channelName));
  if (fromHeader) return fromHeader;
  const segments = titleSegments();
  const first = segments.length >= 3 ? segments[0] : undefined;
  return first?.replace(/\s*\([^)]*\)$/, "") || undefined;
}

function ownSender(message: Element): string | undefined {
  const name = text(message.querySelector(SELECTORS.senderName));
  if (name) return name;
  return message.querySelector(SELECTORS.sender)?.getAttribute("data-stringify-text")?.trim() || undefined;
}

function sender(message: Element): string | undefined {
  const own = ownSender(message);
  if (own) return own;
  let item = message.closest(SELECTORS.listItem)?.previousElementSibling ?? null;
  for (let i = 0; item && i < MAX_SENDER_LOOKBACK; i++) {
    const previous = item.querySelector(SELECTORS.message);
    const name = previous ? ownSender(previous) : undefined;
    if (name) return name;
    item = item.previousElementSibling;
  }
  return undefined;
}

function isoFromTs(ts: string | null | undefined): string | undefined {
  const seconds = Number(ts);
  if (!ts || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function messageText(message: Element): string {
  const body = message.querySelector(SELECTORS.messageText);
  if (body) return text(body);
  const content = message.querySelector(SELECTORS.messageContent);
  if (!content) return "";
  // innerText is unreliable on detached clones, so use textContent here.
  const clone = content.cloneNode(true) as Element;
  for (const node of clone.querySelectorAll(SELECTORS.chrome)) node.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function readMessage(message: Element): SlackMessage {
  const result: SlackMessage = { text: messageText(message) };
  const author = sender(message);
  if (author) result.author = author;

  const link = message.querySelector<HTMLAnchorElement>(SELECTORS.timestampLink);
  const human =
    link?.getAttribute("aria-label")?.trim() ||
    text(message.querySelector(SELECTORS.timestampLabel)) ||
    text(link) ||
    undefined;
  const iso = isoFromTs(link?.getAttribute("data-ts") ?? message.getAttribute("data-msg-ts"));
  // SlackMessage has a single timestamp field, so carry both forms when available.
  const timestamp = human && iso ? `${human} (${iso})` : (human ?? iso);
  if (timestamp) result.timestamp = timestamp;

  if (link?.getAttribute("href")) {
    try {
      result.permalink = new URL(link.getAttribute("href") ?? "", location.href).href;
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return result;
}

function threadReplies(message: Element): SlackMessage[] {
  const pane = document.querySelector(SELECTORS.threadPane);
  if (!pane) return [];
  const messages = [...pane.querySelectorAll(SELECTORS.message)];
  const root = pane.querySelector(SELECTORS.threadRoot)?.closest(SELECTORS.message) ?? messages[0];
  if (!root) return [];
  const rootTs = root.getAttribute("data-msg-ts");
  const belongs = pane.contains(message) || (rootTs !== null && message.getAttribute("data-msg-ts") === rootTs);
  if (!belongs) return [];
  return messages
    .filter((candidate) => candidate !== root)
    .slice(0, MAX_THREAD_REPLIES)
    .map(readMessage);
}

function selectedMessage(): Element | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  return findMessage(selection.anchorNode) ?? findMessage(selection.focusNode);
}

export function installSlackCollector(): void {
  let rightClicked: MessageRef | null = null;
  let hovered: MessageRef | null = null;

  document.addEventListener(
    "contextmenu",
    (event) => {
      const message = findMessage(event.target);
      if (message) rightClicked = refFor(message);
    },
    true,
  );
  document.addEventListener(
    "mouseover",
    (event) => {
      const message = findMessage(event.target);
      if (message && message !== hovered?.element) hovered = refFor(message);
    },
    { capture: true, passive: true },
  );

  function collect(): SlackContext | null {
    try {
      const recentRightClick =
        rightClicked && Date.now() - rightClicked.at <= RIGHT_CLICK_TTL_MS ? resolve(rightClicked) : null;
      const message = recentRightClick ?? selectedMessage() ?? resolve(hovered);
      if (!message) return null;

      const context: SlackContext = { message: readMessage(message), threadReplies: threadReplies(message) };
      const workspace = workspaceName();
      if (workspace) context.workspace = workspace;
      const channel = channelName();
      if (channel) context.channel = channel;
      return context;
    } catch {
      return null;
    }
  }

  (globalThis as unknown as Record<string, unknown>)[SLACK_COLLECTOR_KEY] = collect;
}

installSlackCollector();
