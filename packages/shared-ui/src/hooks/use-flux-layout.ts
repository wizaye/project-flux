import { useCallback, useEffect, useMemo, useState } from "react";

export type FluxSidebarSide = "left" | "right";

export interface FluxSidebarOptions {
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  collapsePressure?: number;
  defaultCollapsed?: boolean;
}

export interface FluxSidebarState {
  width: number;
  collapsed: boolean;
}

export interface FluxLayoutState {
  left: FluxSidebarState;
  right: FluxSidebarState;
}

interface ResolvedSidebarOptions {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  collapsePressure: number;
  defaultCollapsed: boolean;
}

interface UseFluxLayoutOptions {
  left?: FluxSidebarOptions;
  right?: FluxSidebarOptions;
  onStateChange?: (state: FluxLayoutState) => void;
  initialState?: FluxLayoutState;
}

const DEFAULT_SIDEBAR: ResolvedSidebarOptions = {
  defaultWidth: 280,
  minWidth: 220,
  maxWidth: 480,
  collapsePressure: 112,
  defaultCollapsed: false,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveOptions(options?: FluxSidebarOptions): ResolvedSidebarOptions {
  const minWidth = Math.max(120, options?.minWidth ?? DEFAULT_SIDEBAR.minWidth);
  const maxWidth = Math.max(minWidth, options?.maxWidth ?? DEFAULT_SIDEBAR.maxWidth);

  return {
    minWidth,
    maxWidth,
    collapsePressure: Math.max(0, options?.collapsePressure ?? DEFAULT_SIDEBAR.collapsePressure),
    defaultWidth: clamp(options?.defaultWidth ?? DEFAULT_SIDEBAR.defaultWidth, minWidth, maxWidth),
    defaultCollapsed: options?.defaultCollapsed ?? DEFAULT_SIDEBAR.defaultCollapsed,
  };
}

function createInitialState(
  left: ResolvedSidebarOptions,
  right: ResolvedSidebarOptions,
  initialState?: FluxLayoutState
): FluxLayoutState {
  const fallback: FluxLayoutState = {
    left: { width: left.defaultWidth, collapsed: left.defaultCollapsed },
    right: { width: right.defaultWidth, collapsed: right.defaultCollapsed },
  };

  if (initialState) {
    return {
      left: {
        width: clamp(initialState.left.width, left.minWidth, left.maxWidth),
        collapsed: initialState.left.collapsed,
      },
      right: {
        width: clamp(initialState.right.width, right.minWidth, right.maxWidth),
        collapsed: initialState.right.collapsed,
      },
    };
  }
  return fallback;
}

export function useFluxLayout({
  left: leftOptions,
  right: rightOptions,
  onStateChange,
  initialState,
}: UseFluxLayoutOptions = {}) {
  const left = useMemo(() => resolveOptions(leftOptions), [leftOptions]);
  const right = useMemo(() => resolveOptions(rightOptions), [rightOptions]);
  const [state, setState] = useState<FluxLayoutState>(() =>
    createInitialState(left, right, initialState)
  );

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  const toggle = useCallback((side: FluxSidebarSide) => {
    setState((current) => ({
      ...current,
      [side]: { ...current[side], collapsed: !current[side].collapsed },
    }));
  }, []);

  const resize = useCallback(
    (side: FluxSidebarSide, requestedWidth: number) => {
      const constraints = side === "left" ? left : right;
      setState((current) => {
        if (requestedWidth <= constraints.minWidth - constraints.collapsePressure) {
          return {
            ...current,
            [side]: { ...current[side], collapsed: true },
          };
        }

        return {
          ...current,
          [side]: {
            width: clamp(requestedWidth, constraints.minWidth, constraints.maxWidth),
            collapsed: false,
          },
        };
      });
    },
    [left, right]
  );

  return {
    state,
    constraints: { left, right },
    resize,
    toggle,
  };
}
