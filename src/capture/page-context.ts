import type { PageContext, SlackContext } from "../shared/capture-types";

/**
 * Runs in the page through chrome.scripting.executeScript({ func }). Chrome
 * serializes only this function's source, so it must not reference anything
 * outside its own body.
 */
export function collectPageContext(): PageContext {
  const MAX_SELECTION = 20_000;

  function readMeta(selector: string): string | undefined {
    const content = document.querySelector<HTMLMetaElement>(selector)?.content.trim();
    return content || undefined;
  }

  function readSelection(): string | undefined {
    let text = "";
    const active = document.activeElement;
    const isTextField =
      active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type !== "password");
    if (isTextField) {
      // selectionStart throws on input types without a text selection (email, number).
      try {
        const start = active.selectionStart;
        const end = active.selectionEnd;
        if (start !== null && end !== null && end > start) text = active.value.slice(start, end);
      } catch {
        text = "";
      }
    }
    if (!text) text = window.getSelection()?.toString() ?? "";
    text = text.trim();
    return text ? text.slice(0, MAX_SELECTION) : undefined;
  }

  function readSlack(): SlackContext | undefined {
    const collect = (globalThis as unknown as Record<string, unknown>)["__t3SlackCollect"];
    if (typeof collect !== "function") return undefined;
    try {
      const result = (collect as () => SlackContext | null)();
      return result ?? undefined;
    } catch {
      return undefined;
    }
  }

  function readNavigation(): PageContext["navigation"] {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!entry) return undefined;
    return {
      type: entry.type,
      domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
      loadMs: Math.round(entry.loadEventEnd),
      ageMs: Math.round(performance.now()),
    };
  }

  function readFailedResources(): PageContext["failedResources"] {
    try {
      return (performance.getEntriesByType("resource") as (PerformanceResourceTiming & { responseStatus?: number })[])
        .filter((entry) => (entry.responseStatus ?? 0) >= 400)
        .slice(-30)
        .map((entry) => ({
          url: entry.name.slice(0, 2_000),
          status: entry.responseStatus ?? 0,
          initiatorType: entry.initiatorType,
        }));
    } catch {
      return [];
    }
  }

  const context: PageContext = {
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    userAgent: navigator.userAgent,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: { width: window.screen.width, height: window.screen.height },
    online: navigator.onLine,
    failedResources: readFailedResources(),
    capturedAt: new Date().toISOString(),
  };

  if (document.referrer) context.referrer = document.referrer.slice(0, 2_000);
  const navigation = readNavigation();
  if (navigation) context.navigation = navigation;
  const description = readMeta('meta[name="description"]') ?? readMeta('meta[property="og:description"]');
  if (description) context.description = description;
  const selection = readSelection();
  if (selection) context.selection = selection;
  const slack = readSlack();
  if (slack) context.slack = slack;
  return context;
}
