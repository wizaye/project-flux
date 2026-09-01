import type { ComponentProps } from "react";

import { cn } from "#lib/utils";

export function Alert({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="status"
      data-slot="alert"
      className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-lg border p-4 [&>svg]:mt-0.5 [&>svg]:size-4", className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 data-slot="alert-title" className={cn("min-w-0 text-sm font-medium", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("col-start-2 text-sm text-muted-foreground", className)} {...props} />;
}

export function AlertAction({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-action" className={cn("col-start-3 row-span-2 row-start-1 flex items-start gap-2", className)} {...props} />;
}
