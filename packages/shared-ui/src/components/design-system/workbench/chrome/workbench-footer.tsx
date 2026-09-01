import type { ReactNode } from "react";

import { cn } from "../../../../lib/utils";

export interface WorkbenchFooterProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  words?: number;
  characters?: number;
  backlinks?: number;
  className?: string;
}

export function WorkbenchFooter({
  left,
  center,
  right,
  words,
  characters,
  backlinks,
  className,
}: WorkbenchFooterProps) {
  const hasDocumentStats = words !== undefined || characters !== undefined || backlinks !== undefined;

  return (
    <footer
      aria-label="Status bar"
      className={cn(
        "grid h-[22px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-[var(--workbench-chrome)] px-1 text-[var(--workbench-muted)]",
        className
      )}
    >
      <div className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
        {left}
      </div>
      <div className="max-w-[40vw] truncate px-2 text-center text-[12px]">{center}</div>
      <div className="flex min-w-0 items-center justify-end overflow-hidden whitespace-nowrap">
        {hasDocumentStats ? (
          <div
            aria-label="Document statistics"
            className="flex h-full shrink-0 items-center gap-2 px-2 text-[11px] tabular-nums"
          >
            {words !== undefined ? <span title="Word count">{words.toLocaleString()} words</span> : null}
            {characters !== undefined ? (
              <span title="Character count">{characters.toLocaleString()} characters</span>
            ) : null}
            {backlinks !== undefined ? (
              <span title="Backlink count">{backlinks.toLocaleString()} backlinks</span>
            ) : null}
          </div>
        ) : null}
        {right}
      </div>
    </footer>
  );
}
