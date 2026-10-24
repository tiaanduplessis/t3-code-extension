import { GlobeIcon, LinkIcon, MessageSquareIcon, NetworkIcon, TerminalIcon, TextQuoteIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { Tooltip } from "@/ui/misc";

export type ContextKey = "page" | "selection" | "slack" | "console" | "network";

export interface ContextChip {
  key: ContextKey | "link";
  label: string;
  preview: string;
  icon: ReactNode;
  enabled: boolean;
  toggleable: boolean;
}

export const CONTEXT_ICONS: Record<ContextChip["key"], ReactNode> = {
  page: <GlobeIcon />,
  selection: <TextQuoteIcon />,
  slack: <MessageSquareIcon />,
  console: <TerminalIcon />,
  network: <NetworkIcon />,
  link: <LinkIcon />,
};

/** Context items in the style of T3 Code's composer context strip. Click to include or leave out. */
export function ContextChips({ chips, onToggle }: { chips: ContextChip[]; onToggle: (key: ContextKey) => void }) {
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Context to include">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Tooltip content={<span className="line-clamp-6 whitespace-pre-wrap">{chip.preview}</span>}>
            <button
              type="button"
              aria-pressed={chip.enabled}
              disabled={!chip.toggleable}
              onClick={() => chip.key !== "link" && onToggle(chip.key)}
              className={cn(
                "inline-flex h-6 max-w-56 items-center gap-1.5 rounded-md border px-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0",
                chip.enabled
                  ? "border-input bg-popover text-foreground shadow-xs/5 dark:bg-input/32"
                  : "border-dashed bg-transparent text-muted-foreground line-through decoration-muted-foreground/60",
                chip.toggleable ? "cursor-pointer hover:bg-accent" : "cursor-default",
              )}
            >
              <span className={cn(chip.enabled ? "opacity-80" : "opacity-50")}>{chip.icon}</span>
              <span className="truncate">{chip.label}</span>
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
