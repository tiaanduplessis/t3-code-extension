import { TerminalIcon } from "lucide-react";
import { updateLocal } from "@/shared/storage";
import { Button } from "@/ui/button";

/** Offers to turn console reading back on when it is off in settings. */
export function ConsoleAccess({ onEnabled }: { onEnabled: () => void }) {
  async function enable() {
    await updateLocal("preferences", (current) => ({ ...current, readConsole: true }));
    onEnabled();
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="ghost-muted" size="xs" className="-ms-2 self-start font-normal" onClick={() => void enable()}>
        <TerminalIcon />
        Include console errors and failed requests
      </Button>
      <p className="text-muted-foreground text-xs">While reading the console, Chrome shows a debugging bar for a moment.</p>
    </div>
  );
}
