import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const controlFrame =
  "relative inline-flex w-full rounded-lg border border-input bg-background text-sm text-foreground shadow-xs/5 ring-ring/24 transition-shadow not-dark:bg-clip-padding focus-within:border-ring focus-within:ring-[3px] focus-within:ring-inset has-aria-invalid:border-destructive/36 has-disabled:opacity-64 dark:bg-input/32";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <span className={cn(controlFrame, className)}>
      <input
        data-slot="input"
        className="h-8 w-full min-w-0 rounded-[inherit] bg-transparent px-[calc(--spacing(3)-1px)] leading-8 outline-none placeholder:text-muted-foreground"
        {...props}
      />
    </span>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <span className={cn(controlFrame, className)}>
      <textarea
        data-slot="textarea"
        className="field-sizing-content min-h-20 w-full resize-none rounded-[inherit] bg-transparent px-[calc(--spacing(3)-1px)] py-[calc(--spacing(2)-1px)] outline-none placeholder:text-muted-foreground"
        {...props}
      />
    </span>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("font-medium text-sm text-foreground", className)} {...props} />;
}

export function Field({
  label,
  description,
  error,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive-foreground text-xs">{error}</p>
      ) : description ? (
        <p className="text-muted-foreground text-xs">{description}</p>
      ) : null}
    </div>
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border bg-muted px-1 font-sans text-2xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
