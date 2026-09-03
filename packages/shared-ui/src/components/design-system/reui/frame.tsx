import type { ComponentProps } from "react";

import { cn } from "#lib/utils";

export function Frame({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "ghost" }) {
  return <div data-slot="frame" className={cn("rounded-xl border bg-card p-1 shadow-sm", variant === "ghost" && "border-0 bg-transparent p-0 shadow-none", className)} {...props} />;
}

export function FramePanel({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="frame-panel" className={cn("rounded-lg border bg-background p-4", className)} {...props} />;
}
