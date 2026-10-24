// Records console and network activity while the user reproduces a problem.
// Unlike the console replay, network details (method, status, timing, the
// start of an error response) only exist if the debugger is attached when the
// request happens, so the debugger stays attached until the user stops.

import type { Diagnostics, NetworkFailure } from "@/shared/capture-types";
import type { RecordingStatus } from "@/shared/messages";
import { buildResolver, canAttach, diagnosticsFromEvents, scriptInfo, type DebuggerEvent } from "./console-reader";
import type { ScriptInfo } from "./source-maps";

const MAX_EVENTS = 3_000;
const MAX_REQUESTS = 2_000;
const MAX_DURATION_MS = 10 * 60_000;
const EXCERPT_LENGTH = 1_000;

interface RequestEntry {
  method: string;
  url: string;
  startedAt: number;
  status?: number;
  statusText?: string;
  durationMs?: number;
  errorText?: string;
  responseExcerpt?: string;
}

interface Recording {
  tabId: number;
  startedAt: number;
  stoppedAt?: number;
  events: DebuggerEvent[];
  scripts: ScriptInfo[];
  requests: Map<string, RequestEntry>;
  bodyReads: Promise<void>[];
  timer: ReturnType<typeof setTimeout>;
}

const recordings = new Map<number, Recording>();

function isFailure(entry: RequestEntry): boolean {
  return entry.errorText !== undefined || (entry.status ?? 0) >= 400;
}

function countProblems(events: DebuggerEvent[]): number {
  return diagnosticsFromEvents(events).console.length;
}

export function isRecording(tabId: number): boolean {
  const recording = recordings.get(tabId);
  return Boolean(recording && recording.stoppedAt === undefined);
}

export function recordingStatus(tabId: number): RecordingStatus {
  const recording = recordings.get(tabId);
  if (!recording) return { active: false, requests: 0, failures: 0, problems: 0 };
  const entries = [...recording.requests.values()];
  return {
    active: recording.stoppedAt === undefined,
    startedAt: recording.startedAt,
    requests: entries.length,
    failures: entries.filter(isFailure).length,
    problems: countProblems(recording.events),
  };
}

function onEvent(source: chrome.debugger.Debuggee, method: string, params?: object) {
  const recording = source.tabId === undefined ? undefined : recordings.get(source.tabId);
  if (!recording || recording.stoppedAt !== undefined) return;
  const data = (params ?? {}) as Record<string, any>;

  if (method === "Debugger.scriptParsed") {
    const script = scriptInfo(data);
    if (script) recording.scripts.push(script);
    return;
  }
  if (method.startsWith("Runtime.") || method === "Log.entryAdded") {
    if (recording.events.length < MAX_EVENTS) recording.events.push({ method, params: data });
    return;
  }

  const requestId = data.requestId as string | undefined;
  if (!requestId) return;
  if (method === "Network.requestWillBeSent") {
    if (recording.requests.size >= MAX_REQUESTS || data.request?.url?.startsWith("data:")) return;
    recording.requests.set(requestId, { method: data.request.method, url: data.request.url, startedAt: data.timestamp });
    return;
  }
  const entry = recording.requests.get(requestId);
  if (!entry) return;
  if (method === "Network.responseReceived") {
    entry.status = data.response.status;
    entry.statusText = data.response.statusText;
  } else if (method === "Network.loadingFinished") {
    entry.durationMs = Math.round((data.timestamp - entry.startedAt) * 1000);
    if (isFailure(entry)) {
      // Error responses usually explain themselves; keep the start of the body.
      const read = chrome.debugger
        .sendCommand({ tabId: recording.tabId }, "Network.getResponseBody", { requestId })
        .then((result) => {
          const body = result as { body: string; base64Encoded: boolean };
          if (!body.base64Encoded) entry.responseExcerpt = body.body.slice(0, EXCERPT_LENGTH);
        })
        .catch(() => undefined);
      recording.bodyReads.push(read);
    }
  } else if (method === "Network.loadingFailed") {
    entry.durationMs = Math.round((data.timestamp - entry.startedAt) * 1000);
    entry.errorText = data.canceled ? "canceled" : (data.blockedReason ?? data.errorText);
  }
}

function onDetach(source: chrome.debugger.Debuggee) {
  const recording = source.tabId === undefined ? undefined : recordings.get(source.tabId);
  // The user dismissed Chrome's debugging bar or closed the tab: keep what was recorded.
  if (recording && recording.stoppedAt === undefined) {
    recording.stoppedAt = Date.now();
    clearTimeout(recording.timer);
    void setBadge(recording.tabId, false);
  }
}

chrome.debugger.onEvent.addListener(onEvent);
chrome.debugger.onDetach.addListener(onDetach);

async function setBadge(tabId: number, recording: boolean) {
  await chrome.action.setBadgeText({ tabId, text: recording ? "REC" : "" }).catch(() => undefined);
  if (recording) await chrome.action.setBadgeBackgroundColor({ tabId, color: "#dc2626" }).catch(() => undefined);
}

export async function startRecording(tabId: number, url: string): Promise<RecordingStatus> {
  if (!canAttach(url)) throw new Error("Chrome does not allow recording on this page.");
  if (isRecording(tabId)) return recordingStatus(tabId);
  recordings.delete(tabId);
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch {
    throw new Error("Could not start recording. Another debugger, such as DevTools, may be attached to this tab.");
  }
  const recording: Recording = {
    tabId,
    startedAt: Date.now(),
    events: [],
    scripts: [],
    requests: new Map(),
    bodyReads: [],
    timer: setTimeout(() => void stopRecording(tabId), MAX_DURATION_MS),
  };
  recordings.set(tabId, recording);
  // Runtime and Log also replay what the page logged before recording started.
  await chrome.debugger.sendCommand(target, "Runtime.enable");
  await chrome.debugger.sendCommand(target, "Log.enable");
  await chrome.debugger.sendCommand(target, "Network.enable", { maxPostDataSize: 0 });
  await setBadge(tabId, true);
  return recordingStatus(tabId);
}

/** Stops the recording (if still running) and returns what it captured. */
export async function stopRecording(tabId: number): Promise<Diagnostics | null> {
  const recording = recordings.get(tabId);
  if (!recording) return null;
  recordings.delete(tabId);
  clearTimeout(recording.timer);
  let resolve: Awaited<ReturnType<typeof buildResolver>>;
  if (recording.stoppedAt === undefined) {
    recording.stoppedAt = Date.now();
    await Promise.race([Promise.all(recording.bodyReads), new Promise((settle) => setTimeout(settle, 1_500))]);
    // Map stack frames while still attached. Enabling the Debugger domain replays
    // scriptParsed for every loaded script; the recording no longer listens, so
    // collect those here.
    const collect = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
      if (source.tabId !== tabId || method !== "Debugger.scriptParsed") return;
      const script = scriptInfo((params ?? {}) as Record<string, unknown>);
      if (script) recording.scripts.push(script);
    };
    chrome.debugger.onEvent.addListener(collect);
    const send = (method: string, params?: object) => chrome.debugger.sendCommand({ tabId }, method, params);
    resolve = await buildResolver(send, recording.events, recording.scripts, Date.now() + 1_500);
    chrome.debugger.onEvent.removeListener(collect);
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }
  await setBadge(tabId, false);

  const diagnostics = diagnosticsFromEvents(recording.events, resolve);
  const failures: NetworkFailure[] = [...recording.requests.values()].filter(isFailure).map((entry) => ({
    method: entry.method,
    url: entry.url,
    status: entry.errorText !== undefined && entry.status === undefined ? null : (entry.status ?? null),
    ...(entry.errorText ?? entry.statusText ? { statusText: entry.errorText ?? entry.statusText } : {}),
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    timestamp: Math.round(entry.startedAt * 1000),
    ...(entry.responseExcerpt ? { responseExcerpt: entry.responseExcerpt } : {}),
  }));
  // Console replay also reports failed loads; prefer the recorded entries, which carry more detail.
  const recordedUrls = new Set(failures.map((entry) => entry.url));
  return {
    console: diagnostics.console,
    network: [...diagnostics.network.filter((entry) => !recordedUrls.has(entry.url)), ...failures].slice(-50),
    recording: { durationMs: recording.stoppedAt - recording.startedAt, requests: recording.requests.size },
  };
}

export function discardRecording(tabId: number): Promise<Diagnostics | null> {
  return stopRecording(tabId).then(() => null);
}
