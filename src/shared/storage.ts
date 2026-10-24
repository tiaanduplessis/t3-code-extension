// Typed access to chrome.storage. Long-lived data (connections, preferences,
// history) lives in storage.local; per-browser-session data (in-flight
// dispatches, drafts) lives in storage.session.

import type { Capabilities, InteractionMode, ModelSelection, Project, RuntimeMode, ThreadItem } from "@/lib/t3";
import type { DispatchState } from "./messages";

export interface Connection {
  environmentId: string;
  origin: string;
  label: string;
  serverVersion: string;
  accessToken: string;
  expiresAt: number;
  /** The highest runtime mode T3 Code approved for this connection. */
  access: RuntimeMode;
  connectedAt: number;
  /** Set when T3 Code rejected the token; cleared by reconnecting. */
  invalid?: boolean;
}

export type WorkspaceChoice = "root" | "worktree";

export interface ComposerDefaults {
  projectId?: string;
  /** null means the project's default model. */
  model: ModelSelection | null;
  runtimeMode?: RuntimeMode;
  interactionMode: InteractionMode;
  workspace: WorkspaceChoice;
  baseBranch?: string;
  startFromOrigin: boolean;
}

export interface Preferences {
  activeEnvironmentId?: string;
  includeScreenshot: boolean;
  /** Read the tab's console history through the debugger when the composer opens. */
  readConsole: boolean;
  /** Per-environment composer defaults, keyed by environmentId. */
  composer: Record<string, ComposerDefaults>;
  /** Last target per site (scheme and host), as a target key, so it is preselected next time. */
  siteTargets: Record<string, string>;
  /** Whether the composer last sent to a new or an existing thread. */
  lastMode?: "new" | "existing";
  /** Before 0.2: last project id per site, in the active environment. */
  siteProjects?: Record<string, string>;
}

export interface RecentThreads {
  threads: ThreadItem[];
  fetchedAt: number;
}

export interface Catalog {
  projects: Project[];
  capabilities: Capabilities;
  fetchedAt: number;
}

export interface DispatchRecord {
  id: string;
  environmentId: string;
  origin: string;
  threadId: string;
  title: string;
  projectId: string;
  projectTitle: string;
  sourceUrl: string;
  /** Added in 0.2; older records were all new threads. */
  kind?: "new" | "existing";
  createdAt: number;
}

export interface Draft {
  url: string;
  note: string;
  updatedAt: number;
}

export interface LocalSchema {
  connections: Record<string, Connection>;
  preferences: Preferences;
  history: DispatchRecord[];
  /** Origins where console and network recording is enabled. */
  diagnosticsSites: string[];
}

export interface SessionSchema {
  /** Projects and models per environment, shown instantly while refreshing. */
  catalogs: Record<string, Catalog>;
  /** Recent threads per environment, shown instantly while refreshing. */
  threads: Record<string, RecentThreads>;
  dispatches: Record<string, DispatchState>;
  drafts: Record<string, Draft>;
}

export const DEFAULT_COMPOSER: ComposerDefaults = {
  model: null,
  interactionMode: "default",
  workspace: "root",
  startFromOrigin: false,
};

const localDefaults: LocalSchema = {
  connections: {},
  preferences: { includeScreenshot: true, readConsole: true, composer: {}, siteTargets: {} },
  history: [],
  diagnosticsSites: [],
};

const sessionDefaults: SessionSchema = {
  catalogs: {},
  threads: {},
  dispatches: {},
  drafts: {},
};

export type LocalKey = keyof LocalSchema;
export type SessionKey = keyof SessionSchema;

export async function readLocal<K extends LocalKey>(key: K): Promise<LocalSchema[K]> {
  const result = await chrome.storage.local.get(key);
  const stored = result[key] as LocalSchema[K] | undefined;
  const fallback = structuredClone(localDefaults[key]);
  if (stored === undefined) return fallback;
  // Fill fields added after the value was first stored.
  if (!Array.isArray(fallback) && typeof stored === "object" && stored !== null) return { ...fallback, ...stored };
  return stored;
}

export async function writeLocal<K extends LocalKey>(key: K, value: LocalSchema[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function updateLocal<K extends LocalKey>(
  key: K,
  update: (value: LocalSchema[K]) => LocalSchema[K],
): Promise<LocalSchema[K]> {
  const next = update(await readLocal(key));
  await writeLocal(key, next);
  return next;
}

export async function readSession<K extends SessionKey>(key: K): Promise<SessionSchema[K]> {
  const result = await chrome.storage.session.get(key);
  return (result[key] as SessionSchema[K] | undefined) ?? structuredClone(sessionDefaults[key]);
}

export async function updateSession<K extends SessionKey>(
  key: K,
  update: (value: SessionSchema[K]) => SessionSchema[K],
): Promise<SessionSchema[K]> {
  const next = update(await readSession(key));
  await chrome.storage.session.set({ [key]: next });
  return next;
}

export function subscribe(area: "local" | "session", key: LocalKey | SessionKey, listener: (value: unknown) => void): () => void {
  const handle = (changes: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
    if (changedArea === area && key in changes) listener(changes[key]?.newValue);
  };
  chrome.storage.onChanged.addListener(handle);
  return () => chrome.storage.onChanged.removeListener(handle);
}

export async function getConnection(environmentId: string | undefined): Promise<Connection | undefined> {
  const connections = await readLocal("connections");
  if (environmentId && connections[environmentId]) return connections[environmentId];
  return Object.values(connections).sort((a, b) => b.connectedAt - a.connectedAt)[0];
}

/** Marks a connection invalid, unless it was reconnected with a new token since. */
export async function markConnectionInvalid(environmentId: string, accessToken: string): Promise<void> {
  await updateLocal("connections", (connections) => {
    const connection = connections[environmentId];
    if (!connection || connection.accessToken !== accessToken) return connections;
    return { ...connections, [environmentId]: { ...connection, invalid: true } };
  });
}
