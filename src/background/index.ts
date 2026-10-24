import { captureTab } from "@/shared/capture";
import type { Capture, Envelope, RuntimeRequest } from "@/shared/messages";
import { subscribe } from "@/shared/storage";
import { readConsole } from "./console-reader";
import { DISPATCH_PORT_PREFIX, runDispatch, settleInterruptedDispatches, watchDispatch } from "./dispatch";
import { syncOriginRules } from "./origin-rules";

const MENU_ID = "send-to-t3";
const PENDING_CAPTURE_TTL_MS = 2 * 60_000;
// Registered by earlier builds for per-site console recording.
const LEGACY_RECORDER_ID = "t3-diagnostics";

const workerStartedAt = Date.now();
void settleInterruptedDispatches(workerStartedAt);

/** Runs a task one at a time, so concurrent triggers cannot interleave. */
function serialized(task: () => Promise<void>): () => Promise<void> {
  let queue = Promise.resolve();
  return () => {
    queue = queue.then(task, task);
    return queue;
  };
}

const syncRules = serialized(syncOriginRules);

// Captures taken from a context menu click, held until the popup opens.
// Screenshots are too large for storage.session, and the popup opens right
// after the click, so memory is enough. The popup captures again if the
// worker restarted in between.
const pendingCaptures = new Map<number, { createdAt: number; capture: Promise<Capture> }>();

async function removeLegacyRecorder(): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [LEGACY_RECORDER_ID] });
  if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [LEGACY_RECORDER_ID] });
  await chrome.storage.local.remove("diagnosticsSites");
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Send to T3 Code",
      contexts: ["page", "selection", "link", "image", "frame"],
    });
  });
  void removeLegacyRecorder();
  void syncRules();
});

chrome.runtime.onStartup.addListener(() => {
  void syncRules();
});

subscribe("local", "connections", () => {
  void syncRules();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const tabId = tab.id;
  // openPopup must run while the click still counts as a user gesture, so
  // start it before the capture finishes. The popup waits for the capture.
  const linkUrl = info.linkUrl ?? info.srcUrl;
  const capture = captureTab(tab, { ...(linkUrl ? { linkUrl } : {}), readConsole });
  pendingCaptures.set(tabId, { createdAt: Date.now(), capture });
  chrome.action.openPopup({ windowId: tab.windowId }).catch(async () => {
    await capture.catch(() => undefined);
    await chrome.windows.create({
      url: chrome.runtime.getURL(`popup.html?tabId=${tabId}`),
      type: "popup",
      width: 480,
      height: 720,
    });
  });
});

// The thread is already in T3 Code's thread list; opening the web app in an
// unpaired browser only shows a pairing screen, so a click just dismisses.
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});

async function takePendingCapture(tabId: number): Promise<Capture | null> {
  const pending = pendingCaptures.get(tabId);
  pendingCaptures.delete(tabId);
  if (!pending || Date.now() - pending.createdAt > PENDING_CAPTURE_TTL_MS) return null;
  return pending.capture.catch(() => null);
}

async function handle(request: RuntimeRequest): Promise<unknown> {
  switch (request.type) {
    case "dispatch":
      return runDispatch(request.request);
    case "capture:take":
      return takePendingCapture(request.tabId);
    case "console:read":
      // Runs here rather than in the popup, so closing the popup cannot leave
      // the debugger attached.
      return readConsole(request.tabId, request.url);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id === chrome.runtime.id && port.name.startsWith(DISPATCH_PORT_PREFIX)) watchDispatch(port);
});

chrome.runtime.onMessage.addListener((request: RuntimeRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(request).then(
    (value) => sendResponse({ ok: true, value } satisfies Envelope<unknown>),
    (error: unknown) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Envelope<unknown>),
  );
  return true;
});
