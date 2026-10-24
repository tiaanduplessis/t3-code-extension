import { CircleAlertIcon, CircleCheckIcon, CircleHelpIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import type { DispatchState } from "@/shared/messages";
import { Button } from "@/ui/button";
import { Empty } from "@/ui/empty";

export function DispatchResult({
  state,
  onBack,
  onNew,
}: {
  state: DispatchState;
  onBack: () => void;
  onNew: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const existing = state.kind === "existing";

  if (state.phase === "done" && state.threadUrl) {
    const threadUrl = state.threadUrl;
    return (
      <Empty
        icon={<CircleCheckIcon className="text-success-foreground" />}
        title={existing ? "Sent to the thread" : "Thread started"}
        description={
          <>
            <span className="line-clamp-2 text-foreground">{state.title}</span>
            {existing ? "In" : "Running in"} {state.projectTitle}. Find it in T3 Code's thread list.
          </>
        }
        action={
          <div className="flex w-full flex-col gap-2">
            <Button onClick={() => window.close()}>Done</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={onNew}>
                Send another
              </Button>
              <Button variant="outline" onClick={() => void navigator.clipboard.writeText(threadUrl).then(() => setCopied(true))}>
                <CopyIcon />
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <Button
              variant="ghost-muted"
              size="sm"
              title="The web app asks you to pair this browser the first time."
              onClick={() => void chrome.tabs.create({ url: threadUrl })}
            >
              <ExternalLinkIcon />
              Open in T3 Code's web app
            </Button>
          </div>
        }
      />
    );
  }

  const uncertain = state.phase === "uncertain";
  const title = existing
    ? uncertain
      ? "The message may have been sent"
      : "Could not send to the thread"
    : uncertain
      ? "The thread may have started"
      : "Could not start the thread";
  return (
    <Empty
      icon={uncertain ? <CircleHelpIcon className="text-warning-foreground" /> : <CircleAlertIcon className="text-destructive-foreground" />}
      title={title}
      description={state.error}
      action={
        <div className="flex w-full flex-col gap-2">
          {state.authFailed ? (
            <Button onClick={() => void chrome.runtime.openOptionsPage()}>Reconnect T3 Code</Button>
          ) : (
            <Button onClick={onBack}>{uncertain ? "Back to the composer" : "Try again"}</Button>
          )}
        </div>
      }
    />
  );
}
