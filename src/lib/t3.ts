// Typed wrappers for the T3 Code MCP tools and HTTP endpoints the extension uses.

import { McpError, type McpClient } from "./mcp";

export type RuntimeMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";
export type InteractionMode = "default" | "plan";

export const RUNTIME_MODES: RuntimeMode[] = ["approval-required", "auto-accept-edits", "auto", "full-access"];

export function runtimeModesWithin(ceiling: RuntimeMode): RuntimeMode[] {
  return RUNTIME_MODES.slice(0, RUNTIME_MODES.indexOf(ceiling) + 1);
}

export interface EnvironmentDescriptor {
  environmentId: string;
  label: string;
  serverVersion: string;
  platform?: { os?: string; arch?: string };
  capabilities?: { fileAttachments?: { maxUploadBytes?: number } };
}

export interface Project {
  id: string;
  title: string;
  workspaceRoot: string;
  repositoryIdentity?: { displayName?: string } | null;
}

export interface ModelOption {
  id: string;
  values?: (string | boolean)[];
  default?: string | boolean;
}

export interface ProviderModel {
  id: string;
  label?: string;
  options?: ModelOption[];
}

export interface Provider {
  providerInstanceId: string;
  driverKind: string;
  displayName: string;
  models: ProviderModel[];
  runtimeModes?: RuntimeMode[];
  constraints: string[];
}

export interface Capabilities {
  runtimeMode: RuntimeMode;
  providers: Provider[];
}

export interface ModelSelection {
  instanceId: string;
  model: string;
  options?: { id: string; value: string | boolean }[];
}

export interface BranchRef {
  name: string;
  isDefault: boolean;
  current: boolean;
  worktreePath: string | null;
}

export type WorkspaceStrategy =
  | { type: "root" }
  | { type: "worktree"; baseRef: string; branch?: string; startFromOrigin: boolean }
  | { type: "existing_worktree"; worktreePath: string; branch?: string };

export interface ImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface LaunchInput {
  projectId: string;
  title: string;
  message: string;
  attachments?: ImageAttachment[];
  modelSelection?: ModelSelection;
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode;
  workspaceStrategy?: WorkspaceStrategy;
}

export interface LaunchResult {
  threadId: string;
  projectId: string;
  modelSelection: ModelSelection;
  runId: string | null;
  status: string | null;
}

interface ThreadSummary {
  threadId: string;
  title: string;
  projectId?: string;
  status?: string;
  runtimeMode?: RuntimeMode;
  parentThreadId?: string | null;
  creationSource?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ThreadItem {
  threadId: string;
  title: string;
  projectId: string;
  projectTitle: string;
  status: string;
  runtimeMode: RuntimeMode;
  updatedAt: string;
}

/** Thread statuses where a new message would join or follow a turn in progress. */
export const ACTIVE_THREAD_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

export type SendMode = "auto" | "queue" | "steer";

export interface SendResult {
  threadId: string;
  messageId: string;
  runId?: string | null;
  status?: string | null;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function fetchEnvironment(origin: string): Promise<EnvironmentDescriptor> {
  let response: Response;
  try {
    response = await fetch(`${origin}/.well-known/t3/environment`);
  } catch {
    throw new McpError(`Could not reach T3 Code at ${origin}. Check that the app is running.`, "network");
  }
  if (!response.ok) throw new McpError(`${origin} does not look like a T3 Code server (${response.status}).`, "protocol");
  return (await response.json()) as EnvironmentDescriptor;
}

export async function listProjects(client: McpClient): Promise<Project[]> {
  const projects: Project[] = [];
  let cursor: number | null = 0;
  while (cursor !== null && projects.length < 500) {
    const page: { projects: Project[]; nextCursor: number | null } = await client.callTool("t3_project_list", {
      limit: 100,
      cursor,
    });
    projects.push(...page.projects);
    cursor = page.nextCursor ?? null;
  }
  return projects;
}

export async function getCapabilities(client: McpClient): Promise<Capabilities> {
  const capabilities = await client.callTool<Capabilities>("orchestrator_capabilities");
  return {
    runtimeMode: capabilities.runtimeMode,
    providers: capabilities.providers.filter((provider) => provider.models.length > 0),
  };
}

/**
 * Branch refs for a project. T3 resolves refs through a thread's workspace,
 * so this borrows the project's most recent thread. Returns null when the
 * project has no threads yet.
 */
export async function listBranches(client: McpClient, projectId: string, query?: string): Promise<BranchRef[] | null> {
  const threads = await client.callTool<{ threads: ThreadSummary[] }>("t3_thread_list", { projectId, limit: 1 });
  const thread = threads.threads[0];
  if (!thread) return null;
  const result = await client.callTool<{ refs: BranchRef[] }>("t3_worktree_list", {
    threadId: thread.threadId,
    refKind: "local",
    limit: 50,
    ...(query ? { query } : {}),
  });
  return result.refs;
}

export async function uploadImage(client: McpClient, image: Blob, name: string): Promise<ImageAttachment> {
  if (image.size > MAX_IMAGE_BYTES) throw new McpError("The screenshot is larger than the 10 MB limit.", "tool");
  const upload = await client.callTool<{ attachmentId: string; relativeUrl: string }>("t3_attachment_prepare_upload", {
    upload: { type: "image", name, mimeType: image.type, sizeBytes: image.size },
  });
  let response: Response;
  try {
    response = await fetch(`${client.origin}${upload.relativeUrl}`, {
      method: "POST",
      headers: { "content-type": image.type },
      body: image,
    });
  } catch {
    throw new McpError("The screenshot upload could not reach T3 Code.", "network");
  }
  if (!response.ok) throw new McpError(`The screenshot upload failed (${response.status}).`, "protocol");
  return { type: "image", id: upload.attachmentId, name, mimeType: image.type, sizeBytes: image.size };
}

export async function discardAttachment(client: McpClient, attachmentId: string): Promise<void> {
  await client.callTool("t3_attachment_discard", { attachmentId });
}

export async function launchThread(client: McpClient, input: LaunchInput): Promise<LaunchResult> {
  return client.callTool<LaunchResult>("t3_thread_launch", { ...input });
}

/**
 * Looks for the thread a launch created when its response was lost. Prefers
 * an exact title match; T3 may regenerate titles, so a single MCP-created
 * thread in the time window also counts. Anything ambiguous returns undefined.
 */
export async function findLaunchedThread(
  client: McpClient,
  projectId: string,
  title: string,
  since: number,
): Promise<ThreadSummary | undefined> {
  const result = await client.callTool<{ threads: ThreadSummary[] }>("t3_thread_list", { projectId, limit: 10 });
  const candidates = result.threads.filter(
    (thread) => thread.creationSource === "mcp" && Date.parse(thread.createdAt) >= since - 5_000,
  );
  const titled = candidates.filter((thread) => thread.title === title);
  if (titled.length === 1) return titled[0];
  return titled.length === 0 && candidates.length === 1 ? candidates[0] : undefined;
}

/** Runs async work over items with at most `limit` running at once. */
async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Recent active threads across all projects. T3 lists threads per project for
 * outside clients, so this asks each project for its latest few threads.
 */
export async function listRecentThreads(client: McpClient, projects: Project[], perProject = 8): Promise<ThreadItem[]> {
  const lists = await mapLimited(projects, 6, async (project) => {
    const result = await client
      .callTool<{ threads: ThreadSummary[] }>("t3_thread_list", { projectId: project.id, limit: perProject, settled: false })
      .catch(() => ({ threads: [] as ThreadSummary[] }));
    return result.threads
      .filter((thread) => !thread.parentThreadId)
      .map(
        (thread): ThreadItem => ({
          threadId: thread.threadId,
          title: thread.title,
          projectId: project.id,
          projectTitle: project.title,
          status: thread.status ?? "idle",
          runtimeMode: thread.runtimeMode ?? "approval-required",
          updatedAt: thread.updatedAt ?? thread.createdAt,
        }),
      );
  });
  return lists
    .flat()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 150);
}

/** Sends a text message. The client request id makes retries safe. */
export async function sendMessage(
  client: McpClient,
  input: { threadId: string; message: string; mode: SendMode; clientRequestId: string },
): Promise<SendResult> {
  return client.callTool<SendResult>("t3_thread_send", { ...input });
}

/** Sends a message with attachments. This tool has no retry key. */
export async function sendAttachments(
  client: McpClient,
  input: { threadId: string; message: string; attachments: ImageAttachment[] },
): Promise<SendResult> {
  return client.callTool<SendResult>("t3_thread_send_attachments", { ...input });
}

export function threadUrl(origin: string, environmentId: string, threadId: string): string {
  return `${origin}/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}
