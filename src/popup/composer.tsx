import {
  ArrowUpIcon,
  BrainIcon,
  FolderGit2Icon,
  FolderIcon,
  GitBranchIcon,
  GitForkIcon,
  ListTodoIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  allowedRuntimeModes,
  effortOption,
  findModel,
  modelKey,
  modelLabel,
  parseModelKey,
  PROJECT_DEFAULT_MODEL,
  resolveRuntimeMode,
} from "@/lib/models";
import { buildMessage, failedRequests, suggestTitle } from "@/lib/prompt";
import { ACTIVE_THREAD_STATUSES, type InteractionMode, type ModelSelection, type RuntimeMode, type SendMode, type WorkspaceStrategy } from "@/lib/t3";
import { environmentLabels, exceedsCeiling, parseScopedKey, parseSiteTarget, scopedKey, siteTarget, type TargetMode } from "@/lib/targets";
import { siteKey } from "@/shared/capture";
import type { Capture, DispatchState, DispatchTarget } from "@/shared/messages";
import { sendToBackground } from "@/shared/messages";
import { DEFAULT_COMPOSER, readSession, updateLocal, updateSession, type Connection, type Preferences } from "@/shared/storage";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Spinner } from "@/ui/field";
import { Alert, Tooltip } from "@/ui/misc";
import { ProjectBadge } from "@/ui/project-badge";
import { ThreadStatus } from "@/ui/thread-status";
import { RUNTIME_MODE_DETAILS } from "@/ui/runtime-modes";
import { SearchPicker, type SearchGroup } from "@/ui/search-picker";
import { Picker, type SelectGroup } from "@/ui/select";
import { useSession } from "@/ui/use-storage";
import { ConsoleAccess } from "./console-access";
import { CONTEXT_ICONS, ContextChips, type ContextChip, type ContextKey } from "./context-chips";
import { renderAnnotated, ScreenshotCard, type Box } from "./screenshot";
import { useBranches, useCatalogs, useClients, useRecentThreads } from "./use-t3";

type WorkspaceValue = "root" | "worktree" | `existing:${string}`;

function preview(text: string, max = 400): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** The thin separator T3 Code puts between composer footer controls. */
function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />;
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6 rounded-md px-2.5 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            value === option.value ? "bg-background text-foreground shadow-xs/5 dark:bg-input/64" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Composer({
  connections,
  preferences,
  capture,
  captureLoading,
  onRecapture,
  onDispatched,
}: {
  /** Valid connections; the composer can target any of them. */
  connections: Connection[];
  preferences: Preferences;
  capture: Capture | null;
  captureLoading: boolean;
  onRecapture: () => void;
  onDispatched: (state: DispatchState) => void;
}) {
  const clients = useClients(connections);
  const catalogs = useCatalogs(connections, clients);
  const site = capture ? siteKey(capture.url) : null;
  const page = capture?.page ?? null;
  const remembered = parseSiteTarget(site ? preferences.siteTargets[site] : undefined);

  const [mode, setMode] = useState<TargetMode>(remembered?.mode ?? preferences.lastMode ?? "new");
  const [projectKey, setProjectKey] = useState<string>();
  const [threadKey, setThreadKey] = useState<string | undefined>(remembered?.mode === "existing" ? remembered.key : undefined);
  const threads = useRecentThreads(connections, clients, catalogs, mode === "existing");

  const [note, setNote] = useState("");
  const [includeScreenshot, setIncludeScreenshot] = useState(preferences.includeScreenshot);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [disabledContext, setDisabledContext] = useState<Set<ContextKey>>(new Set());
  const [model, setModel] = useState<string>();
  const [effort, setEffort] = useState<string>();
  const [interactionMode, setInteractionMode] = useState<InteractionMode>();
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>();
  const [workspace, setWorkspace] = useState<WorkspaceValue>();
  const [baseBranch, setBaseBranch] = useState<string>();
  const [sendMode, setSendMode] = useState<SendMode>("queue");
  const [sending, setSending] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const dispatches = useSession("dispatches");
  const sendingPhase = sending ? dispatches?.[sending]?.phase : undefined;

  // Restore the draft note for this page.
  useEffect(() => {
    if (!capture) return;
    void readSession("drafts").then((drafts) => {
      const draft = drafts[capture.url];
      if (draft) setNote((current) => current || draft.note);
    });
  }, [capture?.url]);

  useEffect(() => {
    if (!capture) return;
    const handle = setTimeout(() => {
      void updateSession("drafts", (drafts) => {
        const { [capture.url]: _previous, ...rest } = drafts;
        return note.trim() ? { ...rest, [capture.url]: { url: capture.url, note, updatedAt: Date.now() } } : rest;
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [note, capture?.url]);

  const connectionById = Object.fromEntries(connections.map((connection) => [connection.environmentId, connection]));
  const multipleEnvironments = connections.length > 1;
  const labels = environmentLabels(connections);

  // Pick the project last used on this site, then the last used per environment.
  const projectsLoaded = connections.map((connection) => catalogs[connection.environmentId]?.value?.fetchedAt ?? 0).join(",");
  useEffect(() => {
    if (projectKey) return;
    const exists = (key: string | undefined) => {
      const parsed = parseScopedKey(key);
      return Boolean(parsed && catalogs[parsed.environmentId]?.value?.projects.some((project) => project.id === parsed.id));
    };
    const legacyProject = site ? preferences.siteProjects?.[site] : undefined;
    const candidates = [
      remembered?.mode === "new" ? remembered.key : undefined,
      legacyProject && preferences.activeEnvironmentId ? scopedKey(preferences.activeEnvironmentId, legacyProject) : undefined,
      ...connections.map((connection) => {
        const projectId = preferences.composer[connection.environmentId]?.projectId;
        return projectId ? scopedKey(connection.environmentId, projectId) : undefined;
      }),
      ...connections.map((connection) => {
        const first = catalogs[connection.environmentId]?.value?.projects[0];
        return first ? scopedKey(connection.environmentId, first.id) : undefined;
      }),
    ];
    const found = candidates.find(exists);
    if (found) setProjectKey(found);
  }, [projectsLoaded, projectKey, site]);

  const projectTarget = parseScopedKey(projectKey);
  const threadTarget = parseScopedKey(threadKey);
  const environmentId = mode === "new" ? projectTarget?.environmentId : threadTarget?.environmentId;
  const connection = environmentId ? connectionById[environmentId] : undefined;
  const catalog = environmentId ? catalogs[environmentId]?.value : undefined;
  const defaults = (environmentId ? preferences.composer[environmentId] : undefined) ?? DEFAULT_COMPOSER;
  const project = projectTarget ? catalog?.projects.find((entry) => entry.id === projectTarget.id) : undefined;
  const thread =
    threadTarget && environmentId ? threads[environmentId]?.value?.threads.find((entry) => entry.threadId === threadTarget.id) : undefined;
  const providers = catalog?.capabilities.providers ?? [];

  // Settings fall back to the target environment's saved defaults.
  const activeModel = model ?? (defaults.model ? modelKey(defaults.model) : PROJECT_DEFAULT_MODEL);
  const selectedModel = findModel(providers, parseModelKey(activeModel));
  const modelEffort = effortOption(selectedModel?.model);
  const savedEffort = defaults.model?.options?.find((option) => typeof option.value === "string")?.value as string | undefined;
  const requestedEffort = effort ?? savedEffort;
  const effortValue =
    modelEffort && requestedEffort && modelEffort.values?.includes(requestedEffort) ? requestedEffort : (modelEffort?.default as string | undefined);
  const runtimeModes = connection ? allowedRuntimeModes(connection.access, selectedModel?.provider) : [];
  const activeRuntimeMode = resolveRuntimeMode(runtimeMode ?? defaults.runtimeMode, runtimeModes);
  const activeInteractionMode = interactionMode ?? defaults.interactionMode;
  const activeWorkspace = workspace ?? defaults.workspace;

  // Branches also reveal existing worktrees, so load them for every project.
  const { branches, loading: branchesLoading } = useBranches(
    mode === "new" && environmentId ? clients[environmentId] : undefined,
    mode === "new" ? project?.id : undefined,
  );
  const defaultBranch = branches?.find((branch) => branch.isDefault)?.name;
  const existingWorktrees = (branches ?? []).filter((branch) => branch.worktreePath);
  const wantedBranch = baseBranch ?? defaults.baseBranch;
  const activeBaseBranch = wantedBranch && (!branches || branches.some((branch) => branch.name === wantedBranch)) ? wantedBranch : defaultBranch;

  const failed = useMemo(() => failedRequests(page, capture?.diagnostics ?? null), [page, capture?.diagnostics]);

  const chips = useMemo<ContextChip[]>(() => {
    if (!capture) return [];
    const list: ContextChip[] = [];
    const enabled = (key: ContextKey) => !disabledContext.has(key);
    const pageTitle = page?.title || capture.title || capture.url;
    list.push({
      key: "page",
      label: pageTitle,
      preview: `${pageTitle}\n${capture.url}${capture.browser ? `\n${capture.browser.browser} ${capture.browser.version} on ${capture.browser.os}` : ""}`,
      icon: CONTEXT_ICONS.page,
      enabled: enabled("page"),
      toggleable: true,
    });
    if (page?.slack) {
      const who = page.slack.message.author ? ` from ${page.slack.message.author}` : "";
      list.push({
        key: "slack",
        label: `Slack message${who}`,
        preview: preview(page.slack.message.text),
        icon: CONTEXT_ICONS.slack,
        enabled: enabled("slack"),
        toggleable: true,
      });
    }
    if (page?.selection) {
      list.push({
        key: "selection",
        label: `Selection (${page.selection.length.toLocaleString()} chars)`,
        preview: preview(page.selection),
        icon: CONTEXT_ICONS.selection,
        enabled: enabled("selection"),
        toggleable: true,
      });
    }
    const consoleEntries = capture.diagnostics?.console ?? [];
    if (consoleEntries.length > 0) {
      list.push({
        key: "console",
        label: `Console (${consoleEntries.length})`,
        preview: consoleEntries
          .slice(-5)
          .map((entry) => `${entry.level}: ${entry.message}`)
          .join("\n"),
        icon: CONTEXT_ICONS.console,
        enabled: enabled("console"),
        toggleable: true,
      });
    }
    if (failed.length > 0) {
      list.push({
        key: "network",
        label: `Failed requests (${failed.length})`,
        preview: failed
          .slice(-5)
          .map((entry) => `${entry.url} -> ${entry.status ?? "failed"}`)
          .join("\n"),
        icon: CONTEXT_ICONS.network,
        enabled: enabled("network"),
        toggleable: true,
      });
    }
    if (capture.linkUrl) {
      list.push({ key: "link", label: "Link", preview: capture.linkUrl, icon: CONTEXT_ICONS.link, enabled: true, toggleable: false });
    }
    return list;
  }, [capture, page, failed, disabledContext]);

  const includes = (key: ContextKey) => !disabledContext.has(key);
  const suggestedTitle = page ? suggestTitle(note, page, includes("slack")) : suggestTitle(note, null, false);
  // T3 Code's composer has no title field; the title follows the note, Slack message or page.
  const effectiveTitle = suggestedTitle.trim() || "Task from Chrome";
  const screenshotIncluded = Boolean(capture?.screenshot) && includeScreenshot;
  const threadActive = Boolean(thread && ACTIVE_THREAD_STATUSES.has(thread.status));
  const targetReady = mode === "new" ? Boolean(project && connection) : Boolean(thread && connection);
  const hasContent = note.trim().length > 0 || chips.some((chip) => chip.enabled) || screenshotIncluded;
  const canSend = targetReady && !sending && hasContent;

  async function send() {
    if (!canSend || !capture || !connection || !environmentId) return;
    setSendError(undefined);
    const id = crypto.randomUUID();
    setSending(id);
    try {
      const screenshot = screenshotIncluded && capture.screenshot ? await renderAnnotated(capture.screenshot, boxes) : undefined;
      const message = buildMessage({
        note,
        page,
        browser: capture.browser,
        tab: { url: capture.url, title: capture.title },
        includePage: includes("page"),
        includeSelection: includes("selection"),
        includeSlack: includes("slack"),
        includeConsole: includes("console"),
        includeNetwork: includes("network"),
        diagnostics: capture.diagnostics,
        screenshot: { included: Boolean(screenshot), annotations: screenshot ? boxes.length : 0 },
        ...(capture.linkUrl ? { linkUrl: capture.linkUrl } : {}),
      });

      let target: DispatchTarget;
      let targetTitle: string;
      if (mode === "existing" && thread) {
        target = {
          kind: "existing",
          threadId: thread.threadId,
          projectTitle: thread.projectTitle,
          mode: threadActive ? effectiveSendMode : "auto",
        };
        targetTitle = thread.title;
      } else if (project) {
        const parsedModel = parseModelKey(activeModel);
        const modelSelection: ModelSelection | undefined =
          parsedModel && selectedModel
            ? { ...parsedModel, ...(modelEffort && effortValue ? { options: [{ id: modelEffort.id, value: effortValue }] } : {}) }
            : undefined;
        let workspaceStrategy: WorkspaceStrategy | undefined;
        if (activeWorkspace === "worktree") {
          if (!activeBaseBranch) throw new Error("Choose a base branch for the new worktree.");
          workspaceStrategy = { type: "worktree", baseRef: activeBaseBranch, startFromOrigin: defaults.startFromOrigin };
        } else if (activeWorkspace.startsWith("existing:")) {
          const path = activeWorkspace.slice("existing:".length);
          const ref = existingWorktrees.find((branch) => branch.worktreePath === path);
          workspaceStrategy = { type: "existing_worktree", worktreePath: path, ...(ref ? { branch: ref.name } : {}) };
        }
        target = {
          kind: "new",
          projectId: project.id,
          projectTitle: project.title,
          ...(modelSelection ? { modelSelection } : {}),
          ...(activeRuntimeMode ? { runtimeMode: activeRuntimeMode } : {}),
          interactionMode: activeInteractionMode,
          ...(workspaceStrategy ? { workspaceStrategy } : {}),
        };
        targetTitle = effectiveTitle;
        await updateLocal("preferences", (current) => ({
          ...current,
          composer: {
            ...current.composer,
            [environmentId]: {
              projectId: project.id,
              model: modelSelection ?? null,
              ...(activeRuntimeMode ? { runtimeMode: activeRuntimeMode } : {}),
              interactionMode: activeInteractionMode,
              workspace: activeWorkspace === "worktree" ? "worktree" : "root",
              ...(activeBaseBranch ? { baseBranch: activeBaseBranch } : {}),
              startFromOrigin: defaults.startFromOrigin,
            },
          },
        }));
      } else {
        return;
      }

      const rememberedKey = mode === "new" ? projectKey : threadKey;
      await updateLocal("preferences", (current) => ({
        ...current,
        activeEnvironmentId: environmentId,
        lastMode: mode,
        siteTargets: site && rememberedKey ? { ...current.siteTargets, [site]: siteTarget(mode, rememberedKey) } : current.siteTargets,
      }));

      // Tells the background the popup is still watching; if it closes, the
      // background notifies instead.
      const watcher = chrome.runtime.connect({ name: `dispatch:${id}` });
      const state = await sendToBackground({
        type: "dispatch",
        request: {
          id,
          environmentId,
          title: targetTitle,
          message,
          ...(screenshot ? { screenshot } : {}),
          sourceUrl: capture.url,
          target,
        },
      }).finally(() => watcher.disconnect());
      onDispatched(state);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(undefined);
    }
  }

  const projectGroups: SearchGroup[] = connections.map((entry) => {
    const data = catalogs[entry.environmentId];
    const projects = data?.value?.projects ?? [];
    return {
      ...(multipleEnvironments ? { label: labels[entry.environmentId] } : {}),
      ...(data?.error && projects.length === 0 ? { note: `Unavailable: ${data.error}` } : {}),
      items: projects.map((item) => ({
        id: scopedKey(entry.environmentId, item.id),
        label: item.title,
        // T3 Code shows the project name; add the repository only when it differs.
        ...(item.repositoryIdentity?.displayName && item.repositoryIdentity.displayName !== item.title
          ? { detail: item.repositoryIdentity.displayName }
          : {}),
        icon: <ProjectBadge name={item.title} />,
      })),
    };
  });

  const threadGroups: SearchGroup[] = connections.map((entry) => {
    const data = threads[entry.environmentId];
    const list = data?.value?.threads ?? [];
    return {
      ...(multipleEnvironments ? { label: labels[entry.environmentId] } : {}),
      ...(data?.error && list.length === 0
        ? { note: `Unavailable: ${data.error}` }
        : list.some((item) => exceedsCeiling(item.runtimeMode, entry.access))
          ? {
              note: `This connection allows up to ${RUNTIME_MODE_DETAILS[entry.access].label}. Threads with more access are greyed out; reconnect with a higher level in settings to send to them.`,
            }
          : {}),
      items: list.map((item) => ({
        id: scopedKey(entry.environmentId, item.threadId),
        label: item.title,
        detail: `${item.projectTitle} · ${relativeTime(item.updatedAt)}`,
        icon: <ProjectBadge name={item.projectTitle} />,
        trailing: <ThreadStatus status={item.status} />,
        ...(exceedsCeiling(item.runtimeMode, entry.access)
          ? { disabledReason: `${item.projectTitle} · Needs ${RUNTIME_MODE_DETAILS[item.runtimeMode].label}` }
          : {}),
      })),
    };
  });

  const projectsLoading = connections.some((entry) => catalogs[entry.environmentId]?.loading) && projectGroups.every((group) => group.items.length === 0);
  const threadsLoading = connections.some((entry) => threads[entry.environmentId]?.loading !== false) && threadGroups.every((group) => group.items.length === 0);
  const allFailed = connections.every((entry) => catalogs[entry.environmentId]?.error && !catalogs[entry.environmentId]?.value);

  const modelGroups: SelectGroup<string>[] = [
    { options: [{ value: PROJECT_DEFAULT_MODEL, label: "Project default", description: "Use the project's default model." }] },
    ...providers.map((provider) => ({
      label: provider.displayName,
      options: provider.models.map((entry) => ({
        value: modelKey({ instanceId: provider.providerInstanceId, model: entry.id }),
        label: modelLabel(entry),
      })),
    })),
  ];

  const workspaceGroups: SelectGroup<WorkspaceValue>[] = [
    {
      options: [
        { value: "root", label: "Current checkout", description: "Work in the project folder.", icon: <FolderIcon /> },
        { value: "worktree", label: "New worktree", description: "Create a separate checkout from a base branch.", icon: <GitForkIcon /> },
      ],
    },
    ...(existingWorktrees.length > 0
      ? [
          {
            label: "Existing worktrees",
            options: existingWorktrees.map((branch) => ({
              value: `existing:${branch.worktreePath}` as WorkspaceValue,
              label: branch.name,
              description: branch.worktreePath ?? undefined,
              icon: <FolderGit2Icon />,
            })),
          },
        ]
      : []),
  ];

  // T3 Code's attachment tool has no queue option: a message with a
  // screenshot always joins the turn in progress.
  const effectiveSendMode: SendMode = screenshotIncluded ? "steer" : sendMode;
  const sendLabel = mode === "new" ? "Start thread" : threadActive && effectiveSendMode === "steer" ? "Steer thread" : "Send to thread";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <SegmentedControl
          label="Send to"
          value={mode}
          onChange={setMode}
          options={[
            { value: "new", label: "New thread" },
            { value: "existing", label: "Existing thread" },
          ]}
        />
        {mode === "new" ? (
          <SearchPicker
            groups={projectGroups}
            value={projectKey ?? null}
            onValueChange={setProjectKey}
            label="Project"
            placeholder={projectsLoading ? "Loading projects..." : "Choose a project"}
            searchPlaceholder={multipleEnvironments ? "Search projects in all environments" : "Search projects"}
            emptyText="No matching projects."
            icon={<FolderIcon className="text-muted-foreground" />}
          />
        ) : (
          <SearchPicker
            groups={threadGroups}
            value={threadKey ?? null}
            onValueChange={setThreadKey}
            label="Thread"
            placeholder={threadsLoading ? "Loading threads..." : "Choose a thread"}
            searchPlaceholder={multipleEnvironments ? "Search threads in all environments" : "Search threads"}
            emptyText="No matching active threads."
            icon={<MessageSquareTextIcon className="text-muted-foreground" />}
          />
        )}
      </div>

      {allFailed ? (
        <Alert tone="error" title="Could not reach T3 Code">
          {connections.map((entry) => catalogs[entry.environmentId]?.error).find(Boolean)}
        </Alert>
      ) : null}

      {captureLoading ? (
        <div className="flex h-32 items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground text-sm">
          <Spinner /> Capturing the page
        </div>
      ) : capture?.screenshot ? (
        <ScreenshotCard
          src={capture.screenshot}
          included={includeScreenshot}
          onIncludedChange={setIncludeScreenshot}
          boxes={boxes}
          onBoxesChange={setBoxes}
        />
      ) : capture ? (
        <Alert tone="info" title="No screenshot for this page">
          Chrome does not allow extensions to capture this page. You can still send a note and the page address.
        </Alert>
      ) : null}

      {capture ? (
        <div className="flex flex-col gap-2">
          <ContextChips
            chips={chips}
            onToggle={(key) =>
              setDisabledContext((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          />
          {!preferences.readConsole && site ? <ConsoleAccess onEnabled={onRecapture} /> : null}
        </div>
      ) : null}

      <div className="rounded-2xl border bg-card shadow-[0_2px_12px_-4px_rgb(0_0_0/0.08)] not-dark:bg-clip-padding dark:bg-input/16">
        <textarea
          autoFocus
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder={
            mode === "new"
              ? "Ask anything... The screenshot and page context are attached."
              : "Add to the conversation... The screenshot and page context are attached."
          }
          className="field-sizing-content block max-h-48 min-h-20 w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          {mode === "new" ? (
            <div className="flex min-w-0 flex-wrap items-center gap-0.5">
              <Picker
                label="Model"
                value={selectedModel || activeModel === PROJECT_DEFAULT_MODEL ? activeModel : PROJECT_DEFAULT_MODEL}
                onValueChange={setModel}
                groups={modelGroups}
                triggerLabel={selectedModel ? modelLabel(selectedModel.model) : "Project default"}
                disabled={providers.length === 0}
              />
              {modelEffort?.values ? <Divider /> : null}
              {modelEffort?.values ? (
                <Picker
                  label="Reasoning effort"
                  value={effortValue ?? String(modelEffort.values[0])}
                  onValueChange={setEffort}
                  icon={<BrainIcon />}
                  groups={[{ options: modelEffort.values.map((value) => ({ value: String(value), label: String(value) })) }]}
                />
              ) : null}
              {activeRuntimeMode ? (
                <>
                  <Divider />
                  <Picker
                    label="Access"
                    value={activeRuntimeMode}
                    onValueChange={(value) => setRuntimeMode(value)}
                    groups={[
                      {
                        options: runtimeModes.map((entry) => ({
                          value: entry,
                          label: RUNTIME_MODE_DETAILS[entry].label,
                          description: RUNTIME_MODE_DETAILS[entry].description,
                          icon: RUNTIME_MODE_DETAILS[entry].icon,
                        })),
                      },
                    ]}
                  />
                </>
              ) : null}
              <Divider />
              <Tooltip content={activeInteractionMode === "plan" ? "Plan mode: the agent proposes a plan first" : "Turn on plan mode"}>
                <Button
                  variant="ghost-muted"
                  size="xs"
                  aria-pressed={activeInteractionMode === "plan"}
                  onClick={() => setInteractionMode(activeInteractionMode === "plan" ? "default" : "plan")}
                  className={cn("font-normal", activeInteractionMode === "plan" && "bg-accent text-foreground")}
                >
                  <ListTodoIcon />
                  Plan
                </Button>
              </Tooltip>
            </div>
          ) : thread ? (
            threadActive ? (
              <Picker
                label="While the thread is working"
                value={effectiveSendMode}
                disabled={screenshotIncluded}
                onValueChange={(value) => setSendMode(value as SendMode)}
                groups={[
                  {
                    options: [
                      { value: "queue", label: "Queue", description: "Send after the current turn finishes." },
                      { value: "steer", label: "Steer", description: "Add to the turn in progress and change its direction." },
                    ],
                  },
                ]}
              />
            ) : (
              <span className="px-2 text-muted-foreground text-xs">Starts a new turn in this thread</span>
            )
          ) : null}
          <div className="ms-auto flex shrink-0 items-center self-end">
            <Tooltip content={`${sendLabel} (Enter)`}>
              <Button
                size="icon-sm"
                aria-label={sendLabel}
                className="rounded-full before:rounded-full"
                disabled={!canSend}
                onClick={() => void send()}
              >
                {sending ? <Spinner className="size-3.5" /> : <ArrowUpIcon />}
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>

      {mode === "new" ? (
        <div className="-mt-1 flex flex-wrap items-center gap-1">
          <Picker
            label="Workspace"
            value={activeWorkspace}
            onValueChange={setWorkspace}
            groups={workspaceGroups}
            triggerLabel={
              activeWorkspace === "root" ? "Current checkout" : activeWorkspace === "worktree" ? "New worktree" : activeWorkspace.split("/").at(-1)
            }
          />
          {activeWorkspace === "worktree" ? (
            branches === null ? (
              <input
                aria-label="Base branch"
                value={baseBranch ?? ""}
                onChange={(event) => setBaseBranch(event.target.value)}
                placeholder="Base branch, e.g. main"
                className="h-6 w-36 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:border-ring"
              />
            ) : (
              <SearchPicker
                groups={[
                  {
                    items: (branches ?? []).map((branch) => ({
                      id: branch.name,
                      label: branch.name,
                      ...(branch.isDefault ? { detail: "Default branch" } : {}),
                      icon: <GitBranchIcon />,
                    })),
                  },
                ]}
                value={activeBaseBranch ?? null}
                onValueChange={setBaseBranch}
                label="Base branch"
                placeholder={branchesLoading ? "Loading branches" : "Base branch"}
                searchPlaceholder="Search branches"
                emptyText="No matching branches."
                icon={branchesLoading ? <RefreshCwIcon className="animate-spin" /> : <GitBranchIcon />}
                variant="ghost-muted"
                size="xs"
                className="max-w-44"
              />
            )
          ) : null}
          {multipleEnvironments && connection ? (
            <span className="ms-auto truncate text-2xs text-muted-foreground" title={connection.origin}>
              {labels[connection.environmentId]}
            </span>
          ) : null}
        </div>
      ) : thread && connection ? (
        <>
          {threadActive && screenshotIncluded ? (
            <p className="-mt-1 text-muted-foreground text-xs">
              The thread is working. A message with a screenshot joins the current turn; leave the screenshot out to queue it instead.
            </p>
          ) : null}
          <p className="-mt-1 truncate text-muted-foreground text-xs">
          {thread.projectTitle}
          {multipleEnvironments ? ` · ${labels[connection.environmentId]}` : ""} · {RUNTIME_MODE_DETAILS[thread.runtimeMode].label}
          </p>
        </>
      ) : null}

      {sending ? (
        <p className="flex items-center gap-2 text-muted-foreground text-xs" role="status">
          <Spinner className="size-3.5" />
          {sendingPhase === "uploading"
            ? "Uploading the screenshot"
            : sendingPhase === "launching"
              ? mode === "new"
                ? "Starting the thread"
                : "Sending to the thread"
              : "Preparing"}
        </p>
      ) : null}

      {sendError ? (
        <Alert tone="error" title={mode === "new" ? "Could not start the thread" : "Could not send to the thread"}>
          {sendError}
        </Alert>
      ) : null}
    </div>
  );
}
