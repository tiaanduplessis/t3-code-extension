// Captures the visible tab and its page context. Runs in the popup (after a
// toolbar click or shortcut) or the background worker (after a context menu
// click); both grant activeTab for the target tab.

import { collectPageContext } from "@/capture/page-context";
import type { BrowserInfo, Diagnostics } from "./capture-types";
import type { Capture } from "./messages";

/** Scheme and host, any port: used to remember the last target per site. */
export function siteKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? `${parsed.protocol}//${parsed.hostname}` : null;
  } catch {
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface UserAgentData {
  brands: { brand: string; version: string }[];
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<{
    fullVersionList?: { brand: string; version: string }[];
    platformVersion?: string;
    architecture?: string;
    bitness?: string;
  }>;
}

/** Browser name, version and OS, read in the extension (the page cannot change these). */
export async function readBrowserInfo(): Promise<BrowserInfo | null> {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  if (!data) return null;
  try {
    const high = await data.getHighEntropyValues(["fullVersionList", "platformVersion", "architecture", "bitness"]);
    const brands = high.fullVersionList ?? data.brands;
    const brand =
      brands.find((entry) => !/Not.?A.?Brand|Chromium/i.test(entry.brand)) ?? brands.find((entry) => entry.brand === "Chromium");
    return {
      browser: brand?.brand ?? "Chromium",
      version: brand?.version ?? "",
      os: data.platform,
      ...(high.platformVersion ? { osVersion: high.platformVersion } : {}),
      ...(high.architecture ? { arch: `${high.architecture}${high.bitness ? `-${high.bitness}` : ""}` } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Screenshot and page context first, then the console: attaching the debugger
 * shows Chrome's debugging bar, which resizes the page.
 */
export async function captureTab(
  tab: chrome.tabs.Tab,
  options: { linkUrl?: string; readConsole: (tabId: number, url: string) => Promise<Diagnostics | null> },
): Promise<Capture> {
  if (tab.id === undefined) throw new Error("This tab cannot be captured.");
  const tabId = tab.id;
  const url = tab.url ?? tab.pendingUrl ?? "";

  const [screenshot, page, browser] = await Promise.allSettled([
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
    chrome.scripting.executeScript({ target: { tabId }, func: collectPageContext }),
    readBrowserInfo(),
  ]);
  const diagnostics = await options.readConsole(tabId, url).catch(() => null);

  return {
    id: crypto.randomUUID(),
    tabId,
    createdAt: Date.now(),
    url,
    title: tab.title ?? url,
    screenshot: screenshot.status === "fulfilled" ? screenshot.value : null,
    ...(screenshot.status === "rejected" ? { screenshotError: describeError(screenshot.reason) } : {}),
    page: page.status === "fulfilled" ? (page.value[0]?.result ?? null) : null,
    ...(page.status === "rejected" ? { pageError: describeError(page.reason) } : {}),
    diagnostics,
    browser: browser.status === "fulfilled" ? browser.value : null,
    ...(options.linkUrl ? { linkUrl: options.linkUrl } : {}),
  };
}
