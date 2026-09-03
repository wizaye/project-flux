import type { ReactNode } from "react";

import { cn } from "../../../../lib/utils";
import { Button } from "../../../ui/button";

export interface WorkbenchFooterProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  words?: number;
  characters?: number;
  backlinks?: number;
  onShowBacklinks?: () => void;
  cpuPercent?: number;
  memoryMB?: number;
  className?: string;
}

export function WorkbenchFooter({
  left,
  center,
  right,
  words,
  characters,
  backlinks,
  onShowBacklinks,
  cpuPercent,
  memoryMB,
  className,
}: WorkbenchFooterProps) {
  const hasDocumentStats = words !== undefined || characters !== undefined || backlinks !== undefined;
  const hasPerformanceStats = cpuPercent !== undefined && memoryMB !== undefined;

  return (
    <footer
      aria-label="Status bar"
      className={cn(
        "grid h-[22px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center bg-[var(--workbench-chrome)] px-1 text-[var(--workbench-muted)] leading-none [&_button]:h-[22px]",
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
              <Button variant="ghost" size="xs" title="Show backlinks" onClick={onShowBacklinks}>{backlinks.toLocaleString()} backlinks</Button>
            ) : null}
          </div>
        ) : null}
        {hasPerformanceStats ? (
          <div
            aria-label="Application performance"
            className="flex h-full shrink-0 items-center gap-2 px-2 text-[11px] tabular-nums"
          >
            <span title="CPU usage">CPU {cpuPercent.toFixed(1)}%</span>
            <span title="Memory usage">{Math.round(memoryMB).toLocaleString()} MB</span>
          </div>
        ) : null}
        {right}
      </div>
    </footer>
  );
}
