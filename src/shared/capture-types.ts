// Shapes produced by the page-side capture code and consumed by the
// background worker and the composer. Page-side code runs through
// chrome.scripting.executeScript, so it must return plain JSON values.

export interface PageViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface SlackMessage {
  author?: string;
  timestamp?: string;
  permalink?: string;
  text: string;
}

export interface SlackContext {
  workspace?: string;
  channel?: string;
  /** The message the user right-clicked or most recently hovered. */
  message: SlackMessage;
  /** Replies when the message is open in a thread pane. Capped at 20. */
  threadReplies: SlackMessage[];
}

export interface PageNavigation {
  /** navigate, reload, back_forward or prerender. */
  type: string;
  domContentLoadedMs: number;
  /** 0 while the page is still loading. */
  loadMs: number;
  /** Milliseconds between navigation start and the capture. */
  ageMs: number;
}

/** A resource the page loaded with an HTTP error, from Resource Timing. */
export interface FailedResource {
  url: string;
  status: number;
  /** fetch, xmlhttprequest, script, img, css and so on. */
  initiatorType: string;
}

export interface PageContext {
  url: string;
  title: string;
  description?: string;
  /** Text selected on the page, trimmed and capped at 20,000 characters. */
  selection?: string;
  viewport: PageViewport;
  colorScheme: "light" | "dark";
  userAgent: string;
  language: string;
  timeZone: string;
  screen: { width: number; height: number };
  online: boolean;
  referrer?: string;
  navigation?: PageNavigation;
  /** Up to 30 resources that loaded with status 400 or higher. Cross-origin
   * resources without Timing-Allow-Origin report no status and are left out. */
  failedResources: FailedResource[];
  /** ISO timestamp taken in the page. */
  capturedAt: string;
  slack?: SlackContext;
}

/** The browser the extension runs in, read from the extension itself. */
export interface BrowserInfo {
  browser: string;
  version: string;
  os: string;
  osVersion?: string;
  arch?: string;
}

export type ConsoleLevel = "error" | "warn" | "uncaught" | "unhandledrejection";

export interface ConsoleEntry {
  level: ConsoleLevel;
  message: string;
  /** Source location or stack, capped at 2,000 characters. */
  detail?: string;
  /** Epoch milliseconds of the most recent occurrence. */
  timestamp: number;
  /** Consecutive duplicates are folded into one entry. */
  count: number;
}

export interface NetworkFailure {
  /** Unknown for failures read from the console. */
  method?: string;
  url: string;
  /** null when the request failed before a response (network error, CORS, abort). */
  status: number | null;
  statusText?: string;
  durationMs?: number;
  timestamp: number;
  /** Start of the response body, for failures captured while recording. Capped at 1,000 characters. */
  responseExcerpt?: string;
}

export interface Diagnostics {
  console: ConsoleEntry[];
  network: NetworkFailure[];
  /** Present when the diagnostics come from a recording rather than the console history. */
  recording?: { durationMs: number; requests: number };
}

/** An element the user picked on the page with the element picker. */
export interface PickedElement {
  /** A CSS selector that matches only this element at pick time. */
  selector: string;
  tag: string;
  /** Visible text, trimmed and capped at 300 characters. */
  text?: string;
  /** Useful attributes only: id, class, role, aria-*, name, type, href, src, alt, title, placeholder, data-testid and similar. */
  attributes: Record<string, string>;
  /** CSS pixels relative to the viewport at pick time. */
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  /** outerHTML capped at 2,000 characters. */
  html: string;
  /** Present when a development build of a framework exposes component details. */
  framework?: {
    name: "react" | "vue" | "svelte";
    /** Nearest component first, up to 5 owners. */
    components: string[];
    source?: { file: string; line?: number; column?: number };
  };
  pageUrl: string;
}

/** Global name shared between the Slack content script and the injected capture function. */
export const SLACK_COLLECTOR_KEY = "__t3SlackCollect";
