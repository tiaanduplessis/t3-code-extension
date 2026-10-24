import { SettingsIcon, UnplugIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { captureTab } from "@/shared/capture";
import type { Diagnostics } from "@/shared/capture-types";
import type { Capture, DispatchState } from "@/shared/messages";
import { sendToBackground } from "@/shared/messages";
import { Button } from "@/ui/button";
import { Empty } from "@/ui/empty";
import { Spinner } from "@/ui/field";
import { Alert, Tooltip } from "@/ui/misc";
import { useLocal } from "@/ui/use-storage";
import { Composer } from "./composer";
import { DispatchResult } from "./result";

const params = new URLSearchParams(location.search);
const windowTabId = params.has("tabId") ? Number(params.get("tabId")) : undefined;

async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  if (windowTabId !== undefined) return chrome.tabs.get(windowTabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function useCapture() {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const tab = await targetTab();
        if (!tab?.id) throw new Error("There is no tab to capture.");
        const pending = attempt === 0 ? await sendToBackground({ type: "capture:take", tabId: tab.id }) : null;
        const next =
          pending ??
          (await captureTab(tab, {
            readConsole: (tabId, url) => sendToBackground({ type: "console:read", tabId, url }),
          }));
        const picked = await sendToBackground({ type: "picker:take", tabId: tab.id });
        if (active) setCapture(picked ? { ...next, picked } : next);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  return {
    capture,
    loading,
    error,
    recapture: () => setAttempt((value) => value + 1),
    attachDiagnostics: (diagnostics: Diagnostics) => setCapture((current) => (current ? { ...current, diagnostics } : current)),
  };
}

function Header() {
  return (
    <header className="flex items-center gap-2 border-b px-3 py-2">
      <img src="/icons/icon-32.png" alt="" className="size-5 rounded-[5px]" />
      <h1 className="font-semibold text-sm">Send to T3 Code</h1>
      <div className="ms-auto flex items-center gap-0.5">
        <Tooltip content="Settings">
          <Button variant="ghost-muted" size="icon-xs" aria-label="Settings" onClick={() => void chrome.runtime.openOptionsPage()}>
            <SettingsIcon />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}

function NotConnected() {
  return (
    <Empty
      icon={<UnplugIcon />}
      title="Connect T3 Code"
      description="Pair this browser with T3 Code to send pages, screenshots and Slack messages to agent threads."
      action={<Button onClick={() => void chrome.runtime.openOptionsPage()}>Open settings</Button>}
      className="py-10"
    />
  );
}

export function App() {
  const connections = useLocal("connections");
  const preferences = useLocal("preferences");
  const { capture, loading: captureLoading, error: captureError, recapture, attachDiagnostics } = useCapture();
  const [result, setResult] = useState<DispatchState>();
  const [composerKey, setComposerKey] = useState(0);

  if (!connections || !preferences) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  const list = Object.values(connections).sort((a, b) => a.label.localeCompare(b.label));
  const valid = list.filter((connection) => !connection.invalid);
  const invalid = list.filter((connection) => connection.invalid);
  const expiring = valid.filter((connection) => connection.expiresAt - Date.now() < 3 * 24 * 60 * 60_000);

  return (
    <div className="flex flex-col">
      <Header />
      <main className="flex flex-col gap-3 p-3">
        {invalid.map((connection) => (
          <Alert
            key={connection.environmentId}
            tone="error"
            title={`${connection.label} needs to be reconnected`}
            action={
              <Button size="sm" onClick={() => void chrome.runtime.openOptionsPage()}>
                Reconnect
              </Button>
            }
          >
            T3 Code no longer accepts this connection. Create a new pairing code in T3 Code and reconnect.
          </Alert>
        ))}
        {list.length === 0 ? (
          <NotConnected />
        ) : valid.length === 0 ? null : (
          <>
            {result && result.phase !== "uploading" && result.phase !== "launching" ? (
              <DispatchResult
                state={result}
                onBack={() => setResult(undefined)}
                onNew={() => {
                  setResult(undefined);
                  setComposerKey((value) => value + 1);
                  recapture();
                }}
              />
            ) : null}
            {/* Stays mounted under the result so "Try again" keeps marks, title and context choices. */}
            <div hidden={Boolean(result)}>
              {captureError ? (
                <Alert tone="error" title="Could not capture this tab" className="mb-3">
                  {captureError}
                </Alert>
              ) : null}
              <Composer
                key={composerKey}
                connections={valid}
                preferences={preferences}
                capture={capture}
                captureLoading={captureLoading}
                onRecapture={recapture}
                onDiagnostics={attachDiagnostics}
                onDispatched={setResult}
              />
            </div>
          </>
        )}
      </main>
      {expiring.length > 0 ? (
        <footer className="border-t px-3 py-2 text-muted-foreground text-xs">
          {expiring.map((connection) => `${connection.label} expires ${new Date(connection.expiresAt).toLocaleDateString()}.`).join(" ")}{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => void chrome.runtime.openOptionsPage()}>
            Reconnect
          </button>
        </footer>
      ) : null}
    </div>
  );
}
