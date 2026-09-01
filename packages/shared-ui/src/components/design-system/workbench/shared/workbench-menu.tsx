import type { ComponentProps } from "react";

import { cn } from "../../../../lib/utils";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../../../ui/dropdown-menu";

export function WorkbenchMenuContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      className={cn(
        "rounded-sm bg-popover text-[12px] text-popover-foreground shadow-md ring-1 ring-border",
        className
      )}
      {...props}
    />
  );
}

export function WorkbenchMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuItem>) {
  return <DropdownMenuItem className={cn("rounded-[3px] text-[12px]", className)} {...props} />;
}

export function WorkbenchMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuLabel>) {
  return (
    <DropdownMenuLabel
      className={cn("px-2 text-[11px] font-normal uppercase tracking-[0.04em]", className)}
      {...props}
    />
  );
}

export function WorkbenchMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuSeparator>) {
  return (
    <DropdownMenuSeparator className={cn("bg-[var(--workbench-border)]", className)} {...props} />
  );
}
