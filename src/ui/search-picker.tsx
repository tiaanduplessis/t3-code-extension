import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants } from "./button";
import { cn } from "./cn";

export interface SearchItem {
  id: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
  /** Shown at the end of the row, for example a thread's status. */
  trailing?: ReactNode;
  /** Shown instead of selecting when set. */
  disabledReason?: string;
}

export interface SearchGroup {
  label?: string;
  /** Shown under the group label, for example why the group is empty. */
  note?: string;
  items: SearchItem[];
}

/** A button that opens a searchable, optionally grouped list, like T3 Code's project switcher. */
export function SearchPicker({
  groups,
  value,
  onValueChange,
  label,
  placeholder,
  searchPlaceholder,
  emptyText,
  icon,
  className,
  size = "default",
  variant = "outline",
  disabled,
}: {
  groups: SearchGroup[];
  value: string | null;
  onValueChange: (id: string) => void;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  icon?: ReactNode;
  className?: string;
  size?: "default" | "xs";
  variant?: "outline" | "ghost-muted";
  disabled?: boolean;
}) {
  const all = groups.flatMap((group) => group.items);
  const selected = all.find((item) => item.id === value) ?? null;
  // Base UI filters groups by their items; keep groups that only carry a note.
  const listed = groups.map((group, index) => ({ value: group.label ?? `group-${index}`, ...group }));

  return (
    <Combobox.Root
      items={listed}
      value={selected}
      onValueChange={(next) => {
        const item = next as SearchItem | null;
        if (item && !item.disabledReason) onValueChange(item.id);
      }}
      itemToStringLabel={(item: SearchItem) => `${item.label} ${item.detail ?? ""}`}
      isItemEqualToValue={(item: SearchItem, current: SearchItem) => item.id === current.id}
      disabled={disabled}
    >
      <Combobox.Trigger
        aria-label={label}
        className={cn(
          buttonVariants({ variant, size }),
          "min-w-0 justify-between font-normal",
          variant === "outline" && "w-full",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon ?? icon}
          <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
          {selected?.detail && size === "default" ? (
            <span className="truncate text-muted-foreground text-xs">{selected.detail}</span>
          ) : null}
        </span>
        <ChevronsUpDownIcon className="size-3.5 opacity-60" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner className="z-50 outline-none" align="start" sideOffset={6}>
          <Combobox.Popup
            aria-label={label}
            className="dropdown-surface flex max-h-[min(24rem,var(--available-height))] w-[max(var(--anchor-width),16rem)] max-w-(--available-width) origin-(--transform-origin) flex-col overflow-hidden outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0"
          >
            <div className="flex items-center gap-2 border-b px-3">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <Combobox.Input
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty>
              <div className="px-3 py-6 text-center text-muted-foreground text-sm">{emptyText}</div>
            </Combobox.Empty>
            <Combobox.List className="overflow-y-auto overscroll-contain p-1 empty:p-0">
              {(group: SearchGroup & { value: string }) => (
                <Combobox.Group key={group.value} items={group.items} className="not-first:mt-1 not-first:border-t not-first:pt-1">
                  {group.label ? (
                    <Combobox.GroupLabel className="flex items-center justify-between gap-2 px-2 py-1.5 font-medium text-2xs text-muted-foreground uppercase tracking-wide">
                      {group.label}
                    </Combobox.GroupLabel>
                  ) : null}
                  {group.note ? <p className="px-2 pb-1.5 text-muted-foreground text-xs leading-snug">{group.note}</p> : null}
                  <Combobox.Collection>
                    {(item: SearchItem) => (
                      <Combobox.Item
                        key={item.id}
                        value={item}
                        disabled={Boolean(item.disabledReason)}
                        className="grid cursor-default grid-cols-[1rem_1fr_auto_1rem] items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-disabled:opacity-55 data-highlighted:bg-accent"
                      >
                        <span className="flex text-muted-foreground [&_svg]:size-4">{item.icon}</span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{item.label}</span>
                          {item.disabledReason || item.detail ? (
                            <span className="truncate text-muted-foreground text-xs">{item.disabledReason ?? item.detail}</span>
                          ) : null}
                        </span>
                        <span className="text-xs">{item.trailing}</span>
                        <Combobox.ItemIndicator className="flex">
                          <CheckIcon className="size-4" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
