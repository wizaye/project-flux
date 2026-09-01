import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../../../lib/utils";
import { Button } from "../../../ui/button";
import { WorkbenchIcon } from "./workbench-icon";

export const workbenchControlVariants = cva(
  "border-0 bg-transparent text-[var(--workbench-muted)] hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-fg)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workbench-focus)]",
  {
    variants: {
      density: {
        activity: "size-9 rounded-[5px] p-0",
        chrome: "size-7 rounded-[5px] p-0",
        toolbar: "size-[22px] rounded-sm p-0",
        row: "size-5 rounded-sm p-0 hover:bg-[var(--workbench-selected)]",
      },
      selected: {
        true: "bg-[var(--workbench-hover)] text-[var(--workbench-fg)]",
        false: "",
      },
    },
    defaultVariants: {
      density: "toolbar",
      selected: false,
    },
  }
);

export type WorkbenchIconButtonProps = ComponentProps<typeof Button> &
  VariantProps<typeof workbenchControlVariants> & {
    icon: string;
    iconSize?: 12 | 14 | 16 | 20 | 24;
  };

export function WorkbenchIconButton({
  icon,
  iconSize = 16,
  density,
  selected,
  className,
  ...props
}: WorkbenchIconButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(workbenchControlVariants({ density, selected }), className)}
      {...props}
    >
      <WorkbenchIcon name={icon} size={iconSize} />
    </Button>
  );
}
