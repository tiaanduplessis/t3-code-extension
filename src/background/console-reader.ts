// Reads a tab's console history through Chrome's debugger API. When the
// debugger attaches and enables the Runtime and Log domains, Chrome replays
// the console messages, uncaught exceptions and browser log entries (such as
// failed resource loads) that the page produced before, so nothing has to be
// set up ahead of time. The debugger stays attached for well under a second;
// Chrome shows its "started debugging this browser" bar meanwhile.

import type { ConsoleEntry, ConsoleLevel, Diagnostics, NetworkFailure } from "@/shared/capture-types";
import { readLocal } from "@/shared/storage";

const MAX_CONSOLE = 100;
const MAX_NETWORK = 50;
const MAX_TEXT = 2_000;
const SETTLE_MS = 150;
const TIMEOUT_MS = 1_500;

export interface DebuggerEvent {
  method: string;
  params: Record<string, unknown>;
}

interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  preview?: { properties?: { name: string; value?: string; type?: string }[]; overflow?: boolean };
}

interface CallFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

function cap(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}...` : text;
}

export function formatRemoteObject(object: RemoteObject): string {
  if (object.type === "string" && typeof object.value === "string") return object.value;
  if (object.unserializableValue) return object.unserializableValue;
  if (object.value !== undefined && object.type !== "object") return String(object.value);
  if (object.value === null) return "null";
  if (object.preview?.properties) {
    const body = object.preview.properties.map((property) => `${property.name}: ${property.value ?? property.type ?? ""}`).join(", ");
    const more = object.preview.overflow ? ", ..." : "";
    return object.subtype === "array" ? `[${body}${more}]` : `{${body}${more}}`;
  }
  return object.description ?? object.type ?? "";
}

function formatStack(frames: CallFrame[] | undefined): string | undefined {
  if (!frames?.length) return undefined;
  return frames
    .slice(0, 6)
    .map((frame) => `at ${frame.functionName || "(anonymous)"} (${frame.url ?? ""}:${(frame.lineNumber ?? 0) + 1}:${(frame.columnNumber ?? 0) + 1})`)
    .join("\n");
}

const FAILED_RESOURCE = /status of (\d{3})(?: \(([^)]*)\))?/;

/** Converts replayed debugger events into console entries and network failures. */
export function diagnosticsFromEvents(events: DebuggerEvent[]): Diagnostics {
  // Content scripts of other extensions run in isolated contexts; leave them out.
  const isolated = new Set<number>();
  for (const event of events) {
    if (event.method !== "Runtime.executionContextCreated") continue;
    const context = event.params.context as { id: number; auxData?: { type?: string } } | undefined;
    if (context && context.auxData?.type === "isolated") isolated.add(context.id);
  }

  const consoleEntries: ConsoleEntry[] = [];
  const network: NetworkFailure[] = [];
  const push = (entry: Omit<ConsoleEntry, "count">) => {
    const last = consoleEntries.at(-1);
    if (last && last.level === entry.level && last.message === entry.message && last.detail === entry.detail) {
      last.count += 1;
      last.timestamp = entry.timestamp;
      return;
    }
    consoleEntries.push({ ...entry, count: 1 });
  };

  for (const { method, params } of events) {
    if (method === "Runtime.consoleAPICalled") {
      if (isolated.has(params.executionContextId as number)) continue;
      const type = params.type as string;
      const level: ConsoleLevel | null = type === "error" || type === "assert" ? "error" : type === "warning" ? "warn" : null;
      if (!level) continue;
      const args = (params.args as RemoteObject[] | undefined) ?? [];
      const stack = formatStack((params.stackTrace as { callFrames?: CallFrame[] } | undefined)?.callFrames);
      push({
        level,
        message: cap(args.map(formatRemoteObject).join(" ")),
        ...(stack ? { detail: cap(stack) } : {}),
        timestamp: Math.round((params.timestamp as number) ?? Date.now()),
      });
    } else if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails as {
        text?: string;
        executionContextId?: number;
        exception?: RemoteObject;
        url?: string;
        lineNumber?: number;
        stackTrace?: { callFrames?: CallFrame[] };
      };
      if (details.executionContextId !== undefined && isolated.has(details.executionContextId)) continue;
      const description = details.exception ? formatRemoteObject(details.exception) : (details.text ?? "Uncaught error");
      const [first, ...rest] = description.split("\n");
      const stack = rest.join("\n").trim() || formatStack(details.stackTrace?.callFrames);
      push({
        level: details.text?.includes("(in promise)") ? "unhandledrejection" : "uncaught",
        message: cap(first ?? description),
        ...(stack ? { detail: cap(stack) } : {}),
        timestamp: Math.round((params.timestamp as number) ?? Date.now()),
      });
    } else if (method === "Log.entryAdded") {
      const entry = params.entry as { source: string; level: string; text: string; url?: string; timestamp?: number };
      if (entry.level !== "error" && entry.level !== "warning") continue;
      const timestamp = Math.round(entry.timestamp ?? Date.now());
      if (entry.source === "network" && entry.url) {
        const match = FAILED_RESOURCE.exec(entry.text);
        network.push({
          url: cap(entry.url),
          status: match ? Number(match[1]) : null,
          statusText: match ? (match[2] ?? "") : cap(entry.text.replace(/^Failed to load resource:\s*/, "")),
          timestamp,
        });
      } else {
        push({ level: entry.level === "error" ? "error" : "warn", message: cap(`[${entry.source}] ${entry.text}`), timestamp });
      }
    }
  }

  return { console: consoleEntries.slice(-MAX_CONSOLE), network: network.slice(-MAX_NETWORK) };
}

/** Console reading is a setting; Chrome only allows debugger as a required permission. */
export async function hasConsoleAccess(): Promise<boolean> {
  return (await readLocal("preferences")).readConsole;
}

function canAttach(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && hostname !== "chromewebstore.google.com";
  } catch {
    return false;
  }
}

/** Returns null when console access is off, the page cannot be debugged, or attaching failed. */
export async function readConsole(tabId: number, url: string): Promise<Diagnostics | null> {
  if (!canAttach(url) || !(await hasConsoleAccess())) return null;
  const target = { tabId };
  const events: DebuggerEvent[] = [];
  const listener = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    if (source.tabId === tabId) events.push({ method, params: (params ?? {}) as Record<string, unknown> });
  };
  chrome.debugger.onEvent.addListener(listener);
  let attached = false;
  let finished = false;
  try {
    const read = (async () => {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      // The timeout may already have ended the read; never stay attached.
      if (finished) {
        await chrome.debugger.detach(target).catch(() => undefined);
        return;
      }
      await chrome.debugger.sendCommand(target, "Runtime.enable");
      await chrome.debugger.sendCommand(target, "Log.enable");
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    })();
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS));
    await Promise.race([read, timeout]);
    return diagnosticsFromEvents(events);
  } catch {
    // Another debugger (DevTools on some pages) or a closed tab; report nothing.
    return events.length > 0 ? diagnosticsFromEvents(events) : null;
  } finally {
    finished = true;
    chrome.debugger.onEvent.removeListener(listener);
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}
