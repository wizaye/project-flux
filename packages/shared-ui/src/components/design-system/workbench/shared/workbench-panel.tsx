import type { ComponentProps } from "react";

import { cn } from "../../../../lib/utils";

export function WorkbenchPanel({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[6px] border border-[var(--workbench-border)] bg-[var(--workbench-sidebar)] text-[var(--workbench-fg)]",
        className
      )}
      {...props}
    />
  );
}
