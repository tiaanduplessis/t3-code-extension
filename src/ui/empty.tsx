import type { ReactNode } from "react";
import { cn } from "./cn";

/** T3 Code's empty state: an icon in a bordered square, a title and a short description. */
export function Empty({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 px-6 py-8 text-center", className)}>
      <span className="relative flex size-9 items-center justify-center rounded-md border bg-card text-foreground shadow-sm/5 [&_svg]:size-4.5">
        {icon}
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-semibold text-base">{title}</p>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
