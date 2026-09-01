import type { ComponentProps } from "react";

import { cn } from "#lib/utils";

export function Frame({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="frame" className={cn("rounded-xl border bg-card p-1 shadow-sm", className)} {...props} />;
}

export function FramePanel({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="frame-panel" className={cn("rounded-lg border bg-background p-4", className)} {...props} />;
}
