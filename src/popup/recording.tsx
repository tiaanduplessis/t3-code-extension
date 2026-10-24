import { CircleDotIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Diagnostics } from "@/shared/capture-types";
import { sendToBackground, type RecordingStatus } from "@/shared/messages";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/field";
import { Tooltip } from "@/ui/misc";

function elapsed(since: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Starts and stops a recording of console and network activity in the tab.
 * The recording lives in the background worker, so the user can close the
 * popup, reproduce the problem and come back.
 */
export function RecordingControl({
  tabId,
  url,
  onAttach,
}: {
  tabId: number;
  url: string;
  onAttach: (diagnostics: Diagnostics) => void;
}) {
  const [status, setStatus] = useState<RecordingStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void sendToBackground({ type: "recording:status", tabId }).then((next) => {
        if (active) setStatus(next);
      });
    refresh();
    const timer = setInterval(() => {
      refresh();
      setTick((value) => value + 1);
    }, 1_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [tabId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => setStatus(await sendToBackground({ type: "recording:start", tabId, url })));
  const stop = () =>
    run(async () => {
      const diagnostics = await sendToBackground({ type: "recording:stop", tabId });
      setStatus({ active: false, requests: 0, failures: 0, problems: 0 });
      if (diagnostics) onAttach(diagnostics);
    });
  const discard = () =>
    run(async () => {
      await sendToBackground({ type: "recording:discard", tabId });
      setStatus({ active: false, requests: 0, failures: 0, problems: 0 });
    });

  if (!status) return null;

  if (status.startedAt !== undefined) {
    const summary = `${status.requests} ${status.requests === 1 ? "request" : "requests"} · ${status.failures} failed · ${status.problems} console ${status.problems === 1 ? "problem" : "problems"}`;
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-destructive/24 bg-destructive/4 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          {status.active ? (
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
            </span>
          ) : (
            <SquareIcon className="size-3 text-muted-foreground" />
          )}
          <span className="font-medium">{status.active ? `Recording ${elapsed(status.startedAt)}` : "Recording ended"}</span>
          <span className="truncate text-muted-foreground">{summary}</span>
        </div>
        {status.active ? (
          <p className="text-muted-foreground text-xs">
            Reproduce the problem in the tab. You can close this popup; recording continues until you stop it.
          </p>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Button size="xs" onClick={() => void stop()} disabled={busy}>
            {busy ? <Spinner className="size-3" /> : null}
            {status.active ? "Stop and attach" : "Attach recording"}
          </Button>
          <Button variant="ghost-muted" size="xs" onClick={() => void discard()} disabled={busy}>
            Discard
          </Button>
        </div>
        {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Tooltip content="Keeps Chrome's debugger attached while you reproduce the problem, then attaches the console and every failed request with its response.">
        <Button variant="ghost-muted" size="xs" className="-ms-2 self-start font-normal" onClick={() => void start()} disabled={busy}>
          <CircleDotIcon />
          Record while you reproduce
        </Button>
      </Tooltip>
      {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
    </div>
  );
}
