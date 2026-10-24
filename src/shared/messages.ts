// Messages between extension pages (popup, options) and the background worker.

import type { InteractionMode, ModelSelection, RuntimeMode, SendMode, WorkspaceStrategy } from "@/lib/t3";
import type { BrowserInfo, Diagnostics, PageContext } from "./capture-types";

export interface Capture {
  id: string;
  tabId: number;
  createdAt: number;
  url: string;
  title: string;
  /** PNG data URL of the visible tab. */
  screenshot: string | null;
  screenshotError?: string;
  page: PageContext | null;
  /** Why page context could not be read, e.g. on chrome:// pages. */
  pageError?: string;
  /** Console history read through the debugger; null when that is off or unavailable. */
  diagnostics: Diagnostics | null;
  browser: BrowserInfo | null;
  linkUrl?: string;
}

export type DispatchTarget =
  | {
      kind: "new";
      projectId: string;
      projectTitle: string;
      modelSelection?: ModelSelection;
      runtimeMode?: RuntimeMode;
      interactionMode?: InteractionMode;
      workspaceStrategy?: WorkspaceStrategy;
    }
  | {
      kind: "existing";
      threadId: string;
      projectTitle: string;
      /** How a message joins a thread that is already working. */
      mode: SendMode;
    };

export interface DispatchRequest {
  id: string;
  environmentId: string;
  /** New thread title, or the existing thread's title for display. */
  title: string;
  message: string;
  /** Annotated screenshot as a data URL (PNG, JPEG or WebP). */
  screenshot?: string;
  sourceUrl: string;
  target: DispatchTarget;
}

export type DispatchPhase = "uploading" | "launching" | "done" | "failed" | "uncertain";

export interface DispatchState {
  id: string;
  kind: DispatchTarget["kind"];
  phase: DispatchPhase;
  startedAt: number;
  title: string;
  projectTitle: string;
  threadId?: string;
  threadUrl?: string;
  error?: string;
  /** True when T3 Code rejected the connection token. */
  authFailed?: boolean;
}

export type RuntimeRequest =
  | { type: "dispatch"; request: DispatchRequest }
  | { type: "capture:take"; tabId: number }
  | { type: "console:read"; tabId: number; url: string };

export type RuntimeResponse<T extends RuntimeRequest["type"]> = T extends "dispatch"
  ? DispatchState
  : T extends "capture:take"
    ? Capture | null
    : T extends "console:read"
      ? Diagnostics | null
      : never;

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: string };

export async function sendToBackground<R extends RuntimeRequest>(request: R): Promise<RuntimeResponse<R["type"]>> {
  const envelope = (await chrome.runtime.sendMessage(request)) as Envelope<RuntimeResponse<R["type"]>> | undefined;
  if (!envelope) throw new Error("The extension background did not respond. Reload the extension and try again.");
  if (!envelope.ok) throw new Error(envelope.error);
  return envelope.value;
}
