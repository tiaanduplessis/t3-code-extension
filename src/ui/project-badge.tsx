import { cn } from "./cn";

// T3 Code labels projects with a two-letter badge in a tinted square
// ("AW" for acme-web, "BA" for billing-api). The tint comes from the name.
const TINTS = [
  "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300",
  "bg-violet-500/14 text-violet-700 dark:text-violet-300",
  "bg-orange-500/14 text-orange-700 dark:text-orange-300",
  "bg-sky-500/14 text-sky-700 dark:text-sky-300",
  "bg-rose-500/14 text-rose-700 dark:text-rose-300",
  "bg-amber-500/16 text-amber-700 dark:text-amber-300",
  "bg-teal-500/14 text-teal-700 dark:text-teal-300",
  "bg-indigo-500/14 text-indigo-700 dark:text-indigo-300",
];

export function projectInitials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .split(/[\s\-_./]+/)
    .filter(Boolean);
  const initials = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0] ?? "?").slice(0, 2);
  return initials.toUpperCase();
}

function tint(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length] as string;
}

export function ProjectBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] font-semibold text-[0.5rem] leading-none tracking-tight",
        tint(name),
        className,
      )}
    >
      {projectInitials(name)}
    </span>
  );
}
