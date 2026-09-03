import type { CSSProperties } from "react";

import type { WorkbenchTheme } from "./types";

const baseTokens = {
  "--workbench-chrome": "var(--background)",
  "--workbench-sidebar": "var(--sidebar)",
  "--workbench-editor": "var(--background)",
  "--workbench-raised": "var(--popover)",
  "--workbench-border": "var(--border)",
  "--workbench-border-strong": "var(--border)",
  "--workbench-fg": "var(--foreground)",
  "--workbench-muted": "var(--muted-foreground)",
  "--workbench-disabled": "var(--muted-foreground)",
  "--workbench-hover": "var(--muted)",
  "--workbench-selected": "var(--accent)",
  "--workbench-tab-bar": "#ffffff",
  "--workbench-tab-active": "#e8e8e8",
  "--workbench-tab-unfocused": "#f3f3f3",
  "--workbench-scrollbar-thumb": "rgb(121 121 121 / 40%)",
  "--workbench-scrollbar-thumb-hover": "rgb(100 100 100 / 70%)",
  "--workbench-drop": "var(--accent)",
  "--workbench-focus": "var(--ring)",
  "--workbench-input": "var(--background)",
  "--workbench-shadow": "rgb(0 0 0 / 20%)",
  "--workbench-code": "var(--foreground)",
  "--workbench-comment": "var(--muted-foreground)",
  "--workbench-heading": "var(--foreground)",
  "--workbench-keyword": "var(--foreground)",
  "--workbench-string": "var(--foreground)",
  "--workbench-line-number": "var(--muted-foreground)",
  "--workbench-line-hover": "var(--accent)",
  "--layout-separator": "var(--workbench-border)",
} as CSSProperties;

export function getWorkbenchTheme(theme: WorkbenchTheme): CSSProperties {
  return {
    ...baseTokens,
    ...(theme === "dark" && {
      "--workbench-chrome": "#181818",
      "--workbench-sidebar": "#181818",
      "--workbench-editor": "#181818",
      "--workbench-tab-bar": "#181818",
      "--workbench-tab-active": "#2b2b2b",
      "--workbench-tab-unfocused": "#202020",
    }),
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };
}
