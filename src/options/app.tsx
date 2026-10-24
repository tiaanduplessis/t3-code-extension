import { HistoryIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { threadUrl } from "@/lib/t3";
import { environmentLabels } from "@/lib/targets";
import { updateLocal, type Connection } from "@/shared/storage";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Empty } from "@/ui/empty";
import { Kbd } from "@/ui/field";
import { ActionsMenu } from "@/ui/menu";
import { Alert, Card, Switch } from "@/ui/misc";
import { RUNTIME_MODE_DETAILS } from "@/ui/runtime-modes";
import { useLocal } from "@/ui/use-storage";
import { ConnectForm } from "./connect-form";

const DAY_MS = 24 * 60 * 60_000;

// Layout follows T3 Code's settings pages: a breadcrumb bar, plain muted
// section headings, and cards of rows with a title, a description and a
// control on the right.

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex min-h-7 items-center justify-between gap-4 px-4">
        <h2 className="text-muted-foreground text-sm">{title}</h2>
        {action}
      </div>
      <Card className="divide-y">{children}</Card>
    </section>
  );
}

function Row({
  title,
  description,
  control,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4 px-4 py-3", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 font-medium text-sm">{title}</div>
        {description ? <div className="text-muted-foreground text-xs leading-relaxed">{description}</div> : null}
      </div>
      {control ? <div className="flex shrink-0 items-center gap-1">{control}</div> : null}
    </div>
  );
}

function ConnectionStatus({ connection }: { connection: Connection }) {
  const remaining = connection.expiresAt - Date.now();
  if (connection.invalid || remaining <= 0) {
    return <span className="font-normal text-destructive-foreground text-xs">Needs reconnect</span>;
  }
  if (remaining < 3 * DAY_MS) {
    return <span className="font-normal text-warning-foreground text-xs">Expires soon</span>;
  }
  return <span className="font-normal text-success-foreground text-xs">Connected</span>;
}

function useShortcut(): string | undefined {
  const [shortcut, setShortcut] = useState<string>();
  useEffect(() => {
    void chrome.commands.getAll().then((commands) => {
      setShortcut(commands.find((command) => command.name === "_execute_action")?.shortcut || "");
    });
  }, []);
  return shortcut;
}

export function App() {
  const connections = useLocal("connections");
  const preferences = useLocal("preferences");
  const history = useLocal("history");
  const shortcut = useShortcut();
  const [connecting, setConnecting] = useState<{ origin?: string; access?: Connection["access"] } | null>(null);

  const list = connections ? Object.values(connections).sort((a, b) => b.connectedAt - a.connectedAt) : [];
  const labels = environmentLabels(list);
  const showForm = connecting !== null || (connections !== undefined && list.length === 0);

  async function removeConnection(environmentId: string) {
    await updateLocal("connections", ({ [environmentId]: _removed, ...rest }) => rest);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b bg-background/90 px-6 backdrop-blur">
        <img src="/icons/icon-32.png" alt="" className="size-5 rounded-[5px]" />
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">T3 Code for Chrome</span>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-foreground">Settings</h1>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
        {list.some((connection) => connection.invalid) ? (
          <Alert tone="warning" title="A connection needs attention">
            T3 Code rejected a saved connection. Reconnect it with a new pairing code.
          </Alert>
        ) : null}

        <Section
          title="Environments"
          action={
            list.length > 0 && connecting === null ? (
              <Button variant="ghost-muted" size="xs" onClick={() => setConnecting({})}>
                <PlusIcon />
                Add environment
              </Button>
            ) : null
          }
        >
          {list.map((connection) => (
            <Row
              key={connection.environmentId}
              title={
                <>
                  <span className="truncate">{labels[connection.environmentId]}</span>
                  <ConnectionStatus connection={connection} />
                </>
              }
              description={`${connection.origin} · T3 Code ${connection.serverVersion} · Up to ${RUNTIME_MODE_DETAILS[connection.access].label} · Expires ${new Date(connection.expiresAt).toLocaleDateString()}`}
              control={
                <ActionsMenu
                  label={`Actions for ${labels[connection.environmentId]}`}
                  actions={[
                    {
                      label: "Reconnect",
                      icon: <RefreshCwIcon />,
                      onSelect: () => setConnecting({ origin: connection.origin, access: connection.access }),
                    },
                    {
                      label: "Remove from Chrome",
                      icon: <Trash2Icon />,
                      destructive: true,
                      onSelect: () => void removeConnection(connection.environmentId),
                    },
                  ]}
                />
              }
            />
          ))}
          {showForm ? (
            <div className="px-4 py-4">
              <ConnectForm
                key={connecting?.origin ?? "new"}
                {...(connecting?.origin ? { initialOrigin: connecting.origin } : {})}
                {...(connecting?.access ? { initialAccess: connecting.access } : {})}
                onDone={() => setConnecting(null)}
                {...(list.length > 0 ? { onCancel: () => setConnecting(null) } : {})}
              />
            </div>
          ) : null}
        </Section>

        <Section title="Context">
          <Row
            title="Attach a screenshot"
            description="Include a screenshot of the visible tab by default. You can leave it out for a single message."
            control={
              <Switch
                checked={preferences?.includeScreenshot ?? true}
                onCheckedChange={(checked) => void updateLocal("preferences", (current) => ({ ...current, includeScreenshot: checked }))}
                aria-label="Attach a screenshot"
              />
            }
          />
          <Row
            title="Include console errors"
            description="Reads errors, warnings, uncaught exceptions and failed requests the tab logged, including those from before you opened the composer. Chrome shows a debugging bar for a moment while it reads."
            control={
              <Switch
                checked={preferences?.readConsole ?? true}
                onCheckedChange={(checked) => void updateLocal("preferences", (current) => ({ ...current, readConsole: checked }))}
                aria-label="Include console errors"
              />
            }
          />
          <Row
            title="Browser details"
            description="Page address, browser and OS version, viewport, screen, locale, time zone, load timing and failed requests the page reported."
            control={<span className="text-muted-foreground text-xs">Always included</span>}
          />
        </Section>

        <Section title="Shortcuts">
          <Row
            title="Open the composer"
            description="Or right-click a page, selection or link and choose Send to T3 Code."
            control={
              <>
                {shortcut ? <Kbd>{shortcut}</Kbd> : <span className="text-muted-foreground text-xs">Not set</span>}
                <Button variant="outline" size="xs" className="ms-2" onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>
                  Change
                </Button>
              </>
            }
          />
        </Section>

        <Section title="Recent activity">
          {history && history.length > 0 ? (
            history.map((entry) => (
              <Row
                key={entry.id}
                title={<span className="truncate">{entry.title}</span>}
                description={
                  <span className="block truncate">
                    {entry.kind === "existing" ? "Sent to thread" : "New thread"} · {entry.projectTitle} ·{" "}
                    {new Date(entry.createdAt).toLocaleString()} · {entry.sourceUrl}
                  </span>
                }
                control={
                  <ActionsMenu
                    label={`Actions for ${entry.title}`}
                    actions={[
                      {
                        label: "Open in T3 Code's web app",
                        onSelect: () => void chrome.tabs.create({ url: threadUrl(entry.origin, entry.environmentId, entry.threadId) }),
                      },
                      { label: "Open the source page", onSelect: () => void chrome.tabs.create({ url: entry.sourceUrl }) },
                    ]}
                  />
                }
              />
            ))
          ) : (
            <Empty
              icon={<HistoryIcon />}
              title="Nothing sent yet"
              description="Threads you start and messages you send from Chrome appear here."
            />
          )}
        </Section>

        <p className="px-4 text-muted-foreground text-xs">
          Removing an environment here only forgets it in Chrome. To revoke its access, open Settings, then Connections, in T3 Code.
        </p>
      </main>
    </div>
  );
}
