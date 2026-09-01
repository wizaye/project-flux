import { DropdownMenu, DropdownMenuGroup, DropdownMenuTrigger } from "../../../ui/dropdown-menu";
import type { WorkbenchTheme } from "../types";
import { WorkbenchIconButton } from "../shared/workbench-control";
import { WorkbenchIcon } from "../shared/workbench-icon";
import {
  WorkbenchMenuContent,
  WorkbenchMenuItem,
  WorkbenchMenuLabel,
  WorkbenchMenuSeparator,
} from "../shared/workbench-menu";

export type ThemeMenuProps = {
  theme: WorkbenchTheme;
  onThemeChange: (theme: WorkbenchTheme) => void;
};

export function ThemeMenu({ theme, onThemeChange }: ThemeMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <WorkbenchIconButton
            icon="settings-gear"
            iconSize={20}
            density="activity"
            aria-label="Manage"
            title="Manage"
          />
        }
      />
      <WorkbenchMenuContent side="right" align="end" sideOffset={6} className="w-60">
        <DropdownMenuGroup>
          <WorkbenchMenuLabel>Color theme</WorkbenchMenuLabel>
          <ThemeMenuItem
            label="Light 2026 · Default Light"
            icon="color-mode"
            selected={theme === "light"}
            onSelect={() => onThemeChange("light")}
          />
          <ThemeMenuItem
            label="Dark 2026 · Default Dark"
            icon="symbol-color"
            selected={theme === "dark"}
            onSelect={() => onThemeChange("dark")}
          />
        </DropdownMenuGroup>
        <WorkbenchMenuSeparator />
        <WorkbenchMenuItem>
          <WorkbenchIcon name="settings" />
          Settings
        </WorkbenchMenuItem>
      </WorkbenchMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenuItem({
  label,
  icon,
  selected,
  onSelect,
}: {
  label: string;
  icon: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <WorkbenchMenuItem onClick={onSelect}>
      <WorkbenchIcon name={icon} />
      <span className="flex-1">{label}</span>
      {selected ? <WorkbenchIcon name="check" /> : null}
    </WorkbenchMenuItem>
  );
}
