// Uploads the screenshot and launches the thread. Runs in the background
// worker so the work finishes even when the popup closes.

import { McpClient, McpError } from "@/lib/mcp";
import {
  discardAttachment,
  findLaunchedThread,
  launchThread,
  MAX_IMAGE_BYTES,
  sendAttachments,
  sendMessage,
  threadUrl,
  uploadImage,
  type ImageAttachment,
} from "@/lib/t3";
import type { DispatchRequest, DispatchState } from "@/shared/messages";
import { getConnection, markConnectionInvalid, updateLocal, updateSession, type Connection } from "@/shared/storage";

const HISTORY_LIMIT = 30;
const STATE_TTL_MS = 60 * 60_000;

async function saveState(state: DispatchState): Promise<DispatchState> {
  await updateSession("dispatches", (dispatches) => {
    const recent = Object.values(dispatches).filter((entry) => Date.now() - entry.startedAt < STATE_TTL_MS);
    return Object.fromEntries([...recent, state].map((entry) => [entry.id, entry]));
  });
  return state;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/** Re-encodes screenshots over T3 Code's 10 MB image limit. */
async function fitImage(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_IMAGE_BYTES) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    for (const scale of [1, 0.75, 0.5]) {
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encoded = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
      if (encoded.size <= MAX_IMAGE_BYTES) return encoded;
    }
  } finally {
    bitmap.close();
  }
  throw new McpError("The screenshot is too large to send, even after compressing it.", "tool");
}

function extensionFor(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : (mimeType.split("/")[1] ?? "png");
}

// Popups that sent a dispatch keep a port open named after it. When the port
// is gone, the user closed the popup and only a notification can reach them.
const watchers = new Map<string, chrome.runtime.Port>();

export function watchDispatch(port: chrome.runtime.Port) {
  const id = port.name.slice(DISPATCH_PORT_PREFIX.length);
  watchers.set(id, port);
  port.onDisconnect.addListener(() => watchers.delete(id));
}

export const DISPATCH_PORT_PREFIX = "dispatch:";

/**
 * Chrome stops an idle service worker after about 30 seconds. A launch into a
 * new worktree can take longer, so call a cheap extension API meanwhile.
 */
function keepAlive(): () => void {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return () => clearInterval(timer);
}

/**
 * Marks dispatches that a stopped worker left unfinished as uncertain. Only
 * entries started before this worker instance count: newer ones are live.
 */
export async function settleInterruptedDispatches(workerStartedAt: number): Promise<void> {
  const interrupted: DispatchState[] = [];
  await updateSession("dispatches", (dispatches) =>
    Object.fromEntries(
      Object.entries(dispatches).map(([id, entry]) => {
        const unfinished = entry.phase === "uploading" || entry.phase === "launching";
        if (!unfinished || entry.startedAt >= workerStartedAt) return [id, entry];
        const settled: DispatchState = {
          ...entry,
          phase: "uncertain",
          error: "The extension stopped while the thread was starting. Check T3 Code before sending again.",
        };
        interrupted.push(settled);
        return [id, settled];
      }),
    ),
  );
  for (const entry of interrupted) notify(`uncertain:${entry.id}`, "T3 Code may have received this", `${entry.title}\nCheck T3 Code before sending again.`);
}

async function recordHistory(request: DispatchRequest, connection: Connection, threadId: string) {
  await updateLocal("history", (history) =>
    [
      {
        id: request.id,
        environmentId: connection.environmentId,
        origin: connection.origin,
        threadId,
        title: request.title,
        projectId: request.target.kind === "new" ? request.target.projectId : "",
        projectTitle: request.target.projectTitle,
        sourceUrl: request.sourceUrl,
        kind: request.target.kind,
        createdAt: Date.now(),
      },
      ...history,
    ].slice(0, HISTORY_LIMIT),
  );
  // The note was sent, so a reopened popup must not offer it again.
  await updateSession("drafts", (drafts) => {
    const { [request.sourceUrl]: _sent, ...rest } = drafts;
    return rest;
  });
}

function notify(id: string, title: string, message: string) {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message,
  });
}

export async function runDispatch(request: DispatchRequest): Promise<DispatchState> {
  const stopKeepAlive = keepAlive();
  try {
    const state = await dispatch(request);
    if (!watchers.has(request.id)) {
      if (state.phase === "done" && state.threadUrl) {
        notify(
          `thread:${request.id}`,
          request.target.kind === "new" ? "Thread started" : "Message sent",
          `${request.title}\nIn ${request.target.projectTitle}. Find it in T3 Code's thread list.`,
        );
      } else if (state.phase === "uncertain") {
        notify(`uncertain:${request.id}`, request.target.kind === "new" ? "The thread may have started" : "The message may have been sent", `${request.title}\nCheck T3 Code before sending again.`);
      } else if (state.phase === "failed") {
        notify(`failed:${request.id}`, request.target.kind === "new" ? "Could not start the thread" : "Could not send the message", state.error ?? request.title);
      }
    }
    return state;
  } finally {
    stopKeepAlive();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof McpError && error.code === "runtime_mode_escalation_denied") {
    return "This thread runs with broader access than this connection allows. Reconnect T3 Code with a higher access level in the extension settings.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function dispatch(request: DispatchRequest): Promise<DispatchState> {
  const { target } = request;
  let state: DispatchState = {
    id: request.id,
    kind: target.kind,
    phase: request.screenshot ? "uploading" : "launching",
    startedAt: Date.now(),
    title: request.title,
    projectTitle: target.projectTitle,
  };
  await saveState(state);

  const connection = await getConnection(request.environmentId);
  if (!connection || connection.environmentId !== request.environmentId) {
    return saveState({ ...state, phase: "failed", error: "This T3 Code environment is no longer connected.", authFailed: true });
  }

  const client = new McpClient(connection.origin, connection.accessToken);
  let attachment: ImageAttachment | undefined;
  let sendStartedAt = 0;

  const done = async (threadId: string) => {
    await recordHistory(request, connection, threadId);
    const url = threadUrl(connection.origin, connection.environmentId, threadId);
    return saveState({ ...state, phase: "done", threadId, threadUrl: url });
  };

  try {
    if (request.screenshot) {
      const image = await fitImage(await dataUrlToBlob(request.screenshot));
      attachment = await uploadImage(client, image, `screenshot.${extensionFor(image.type)}`);
      state = await saveState({ ...state, phase: "launching" });
    }

    sendStartedAt = Date.now();
    if (target.kind === "existing") {
      if (attachment) {
        await sendAttachments(client, { threadId: target.threadId, message: request.message, attachments: [attachment] });
      } else {
        const input = { threadId: target.threadId, message: request.message, mode: target.mode, clientRequestId: request.id };
        // The client request id makes a repeat of this call safe.
        await sendMessage(client, input).catch((error: unknown) => {
          if (error instanceof McpError && error.kind !== "tool" && error.kind !== "auth") return sendMessage(client, input);
          throw error;
        });
      }
      return done(target.threadId);
    }

    const result = await launchThread(client, {
      projectId: target.projectId,
      title: request.title,
      message: request.message,
      ...(attachment ? { attachments: [attachment] } : {}),
      ...(target.modelSelection ? { modelSelection: target.modelSelection } : {}),
      ...(target.runtimeMode ? { runtimeMode: target.runtimeMode } : {}),
      ...(target.interactionMode ? { interactionMode: target.interactionMode } : {}),
      ...(target.workspaceStrategy ? { workspaceStrategy: target.workspaceStrategy } : {}),
    });
    return done(result.threadId);
  } catch (error) {
    const message = errorMessage(error);
    const kind = error instanceof McpError ? error.kind : "network";

    if (kind === "auth") {
      await markConnectionInvalid(connection.environmentId, connection.accessToken);
      return saveState({ ...state, phase: "failed", error: message, authFailed: true });
    }

    // Launches and attachment sends have no retry key. When the response is
    // lost, check what happened before telling the user anything.
    if (sendStartedAt > 0 && kind !== "tool") {
      if (target.kind === "new") {
        const found = await findLaunchedThread(client, target.projectId, request.title, sendStartedAt).catch(() => undefined);
        if (found) return done(found.threadId);
      }
      return saveState({
        ...state,
        phase: "uncertain",
        error: `${message} T3 Code may still have ${target.kind === "new" ? "started the thread" : "received the message"}. Check T3 Code before sending again.`,
      });
    }

    if (attachment) await discardAttachment(client, attachment.id).catch(() => undefined);
    return saveState({ ...state, phase: "failed", error: message });
  }
}
