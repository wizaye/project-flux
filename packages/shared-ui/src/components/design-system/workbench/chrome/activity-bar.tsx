"use client";

import { cn } from "../../../../lib/utils";
import { ToggleGroup, ToggleGroupItem } from "../../../ui/toggle-group";
import { ThemeMenu } from "./theme-menu";
import type { WorkbenchTheme } from "../types";
import { WorkbenchIconButton, workbenchControlVariants } from "../shared/workbench-control";
import { WorkbenchIcon } from "../shared/workbench-icon";

export interface ActivityBarItem {
  id: string;
  label: string;
  icon: string;
}

export interface ActivityBarProps {
  items: readonly ActivityBarItem[];
  activeId: string;
  theme: WorkbenchTheme;
  onActiveChange: (id: string) => void;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onAccount?: () => void;
  className?: string;
}

export function ActivityBar({
  items,
  activeId,
  theme,
  onActiveChange,
  onThemeChange,
  onAccount,
  className,
}: ActivityBarProps) {
  return (
    <aside
      aria-label="Activity bar"
      className={cn(
        "flex w-11 shrink-0 flex-col items-center bg-[var(--workbench-chrome)] py-1 text-[var(--workbench-muted)]",
        className
      )}
    >
      <nav aria-label="Workbench" className="min-h-0 flex-1">
        <ToggleGroup
          aria-label="Workbench views"
          orientation="vertical"
          value={[activeId]}
          onValueChange={(value) => value[0] && onActiveChange(value[0])}
          className="flex flex-col items-center gap-1"
        >
          {items.map(({ id, label, icon }) => (
            <ToggleGroupItem
              key={id}
              value={id}
              aria-label={label}
              title={label}
              className={workbenchControlVariants({ density: "activity" })}
            >
              <WorkbenchIcon name={icon} size={20} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </nav>

      <footer aria-label="Account controls" className="flex flex-col items-center gap-1">
        {onAccount ? (
          <WorkbenchIconButton
            icon="account"
            iconSize={24}
            density="activity"
            aria-label="Account"
            title="Account"
            onClick={onAccount}
          />
        ) : null}
        <ThemeMenu theme={theme} onThemeChange={onThemeChange} />
      </footer>
    </aside>
  );
}
