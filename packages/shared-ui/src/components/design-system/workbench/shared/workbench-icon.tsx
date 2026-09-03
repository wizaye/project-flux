import type { ComponentProps } from "react";

import { cn } from "../../../../lib/utils";

export type WorkbenchIconProps = Omit<ComponentProps<"span">, "children"> & {
  name: string;
  size?: 12 | 14 | 16 | 20 | 24;
};

export function WorkbenchIcon({ name, size = 16, className, style, ...props }: WorkbenchIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("codicon shrink-0", `codicon-${name}`, className)}
      style={{ ...style, fontSize: size }}
      {...props}
    />
  );
}
