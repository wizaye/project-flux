import { useRef, useState, type PointerEvent, type ReactNode } from "react";

interface ResizableSplitProps {
  direction: "horizontal" | "vertical";
  children: [ReactNode, ReactNode];
  initialPrimarySize?: number;
  minSize?: number;
}

export function ResizableSplit({
  direction,
  children,
  initialPrimarySize = 50,
  minSize = 18,
}: ResizableSplitProps) {
  const [primarySize, setPrimarySize] = useState(initialPrimarySize);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const horizontal = direction === "horizontal";

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offset = horizontal ? event.clientX - rect.left : event.clientY - rect.top;
    const length = horizontal ? rect.width : rect.height;
    const next = (offset / length) * 100;
    setPrimarySize(Math.min(100 - minSize, Math.max(minSize, next)));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={rootRef}
      className={
        horizontal ? "flex h-full min-h-0 min-w-0" : "flex h-full min-h-0 min-w-0 flex-col"
      }
    >
      <div
        className="min-h-0 min-w-0 overflow-hidden"
        style={
          horizontal
            ? { width: `calc(${primarySize}% - 0.5px)`, flexGrow: 0, flexShrink: 0 }
            : { height: `calc(${primarySize}% - 0.5px)`, flexGrow: 0, flexShrink: 0 }
        }
      >
        {children[0]}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${horizontal ? "editor panes" : "editor rows"}`}
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={minSize}
        aria-valuemax={100 - minSize}
        aria-valuenow={Math.round(primarySize)}
        className={
          horizontal
            ? "group relative z-20 w-px shrink-0 cursor-col-resize touch-none outline-none"
            : "group relative z-20 h-px shrink-0 cursor-row-resize touch-none outline-none"
        }
        onPointerDown={(event) => {
          dragRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          resize(event);
        }}
        onPointerMove={(event) => {
          if (dragRef.current) resize(event);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => {
          const increase = horizontal ? event.key === "ArrowRight" : event.key === "ArrowDown";
          const decrease = horizontal ? event.key === "ArrowLeft" : event.key === "ArrowUp";
          if (!increase && !decrease) return;
          event.preventDefault();
          const step = event.shiftKey ? 8 : 2;
          setPrimarySize((size) =>
            Math.min(100 - minSize, Math.max(minSize, size + (increase ? step : -step)))
          );
        }}
      >
        <span
          aria-hidden="true"
          className={
            horizontal
              ? "absolute inset-y-0 -left-1.5 -right-1.5"
              : "absolute inset-x-0 -bottom-1.5 -top-1.5"
          }
        />
        {horizontal ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-11 bg-[var(--window-chrome-active)] group-hover:bg-foreground group-focus-visible:bg-foreground group-data-[window-active=false]/layout:bg-sidebar"
          />
        ) : null}
        <span
          aria-hidden="true"
          className={
            horizontal
              ? "pointer-events-none absolute bottom-0 left-0 top-11 w-px bg-[var(--layout-separator)] group-hover:bg-foreground group-focus-visible:bg-foreground"
              : "pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--layout-separator)] group-hover:bg-foreground group-focus-visible:bg-foreground"
          }
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children[1]}</div>
    </div>
  );
}
