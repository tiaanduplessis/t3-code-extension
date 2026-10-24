import { Menu as BaseMenu } from "@base-ui/react/menu";
import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants } from "./button";
import { cn } from "./cn";

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}

/** The "..." actions menu T3 Code uses on settings rows. */
export function ActionsMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger aria-label={label} className={cn(buttonVariants({ variant: "ghost-muted", size: "icon-sm" }))}>
        <EllipsisIcon />
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="z-50 outline-none" sideOffset={6} align="end">
          <BaseMenu.Popup className="dropdown-surface min-w-44 origin-(--transform-origin) p-1 outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0">
            {actions.map((action) => (
              <BaseMenu.Item
                key={action.label}
                onClick={action.onSelect}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:opacity-80",
                  action.destructive && "text-destructive-foreground",
                )}
              >
                {action.icon}
                {action.label}
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
