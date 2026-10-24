import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleHelpIcon, CircleIcon } from "lucide-react";
import { cn } from "./cn";

// Matches T3 Code's thread list: blue while working, green when done,
// violet when it needs input, red when it failed.
const STATUS: Record<string, { label: string; tone: string; icon: typeof CircleIcon }> = {
  preparing: { label: "Working", tone: "text-blue-600 dark:text-blue-400", icon: CircleDashedIcon },
  queued: { label: "Queued", tone: "text-blue-600 dark:text-blue-400", icon: CircleDashedIcon },
  starting: { label: "Working", tone: "text-blue-600 dark:text-blue-400", icon: CircleDashedIcon },
  running: { label: "Working", tone: "text-blue-600 dark:text-blue-400", icon: CircleDashedIcon },
  waiting: { label: "Input", tone: "text-violet-600 dark:text-violet-400", icon: CircleHelpIcon },
  completed: { label: "Done", tone: "text-emerald-600 dark:text-emerald-400", icon: CircleCheckIcon },
  failed: { label: "Failed", tone: "text-red-600 dark:text-red-400", icon: CircleAlertIcon },
};

export function ThreadStatus({ status, className }: { status: string; className?: string }) {
  const entry = STATUS[status];
  if (!entry) return null;
  const Icon = entry.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs", entry.tone, className)}>
      <Icon className="size-3.5" />
      {entry.label}
    </span>
  );
}
