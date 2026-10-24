import { Select } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants } from "./button";
import { cn } from "./cn";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectGroup<T extends string> {
  label?: string;
  options: SelectOption<T>[];
}

/**
 * A compact picker in the style of T3 Code's composer footer: a ghost button
 * trigger that opens a menu-like list, with optional groups and descriptions.
 */
export function Picker<T extends string>({
  value,
  onValueChange,
  groups,
  label,
  icon,
  triggerLabel,
  variant = "ghost-muted",
  className,
  disabled,
}: {
  value: T;
  onValueChange: (value: T) => void;
  groups: SelectGroup<T>[];
  /** Accessible name for the trigger. */
  label: string;
  icon?: ReactNode;
  /** Text shown in the trigger; defaults to the selected option's label. */
  triggerLabel?: ReactNode;
  variant?: "ghost-muted" | "outline";
  className?: string;
  disabled?: boolean;
}) {
  const options = groups.flatMap((group) => group.options);
  const selected = options.find((option) => option.value === value);
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as T);
      }}
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={label}
        className={cn(
          buttonVariants({ variant, size: variant === "outline" ? "default" : "xs" }),
          variant === "outline" ? "w-full justify-between font-normal" : "max-w-48 font-normal",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {icon ?? selected?.icon}
          <span className="truncate">{triggerLabel ?? selected?.label ?? "Select"}</span>
        </span>
        <ChevronDownIcon className="size-3 opacity-60" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="z-50 outline-none" sideOffset={6} align="start" alignItemWithTrigger={false}>
          <Select.Popup className="dropdown-surface max-h-[min(22rem,var(--available-height))] min-w-[max(var(--anchor-width),13rem)] max-w-[min(20rem,var(--available-width))] origin-(--transform-origin) overflow-y-auto p-1 outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0">
            {groups.map((group, index) => (
              <Select.Group key={group.label ?? index} className="not-first:mt-1 not-first:border-t not-first:pt-1">
                {group.label ? (
                  <Select.GroupLabel className="px-2 py-1.5 font-medium text-2xs text-muted-foreground uppercase tracking-wide">
                    {group.label}
                  </Select.GroupLabel>
                ) : null}
                {group.options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="grid cursor-default grid-cols-[1rem_1fr_1rem] items-start gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent [&_svg:not([class*='size-'])]:size-4"
                  >
                    <span className="mt-0.5 flex text-muted-foreground">{option.icon}</span>
                    <span className="flex min-w-0 flex-col">
                      <Select.ItemText className="truncate">{option.label}</Select.ItemText>
                      {option.description ? (
                        <span className="text-muted-foreground text-xs leading-snug">{option.description}</span>
                      ) : null}
                    </span>
                    <Select.ItemIndicator className="mt-0.5 flex text-foreground">
                      <CheckIcon className="size-4" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
