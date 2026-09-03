import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "../../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog";
import type { WorkbenchTheme, WorkbenchUpdate } from "../types";

export function WorkbenchSettingsDialog({
  open,
  theme,
  update,
  checking,
  canCheckForUpdates,
  onOpenChange,
  onThemeChange,
  onCheckForUpdates,
}: {
  open: boolean;
  theme: WorkbenchTheme;
  update?: WorkbenchUpdate;
  checking: boolean;
  canCheckForUpdates: boolean;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (theme: WorkbenchTheme) => void;
  onCheckForUpdates: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Appearance and desktop updates.</DialogDescription>
        </DialogHeader>

        <section className="space-y-2" aria-labelledby="appearance-settings">
          <h3 id="appearance-settings" className="text-sm font-medium">Appearance</h3>
          <div className="flex gap-2">
            <Button variant={theme === "light" ? "default" : "outline"} size="sm" onClick={() => onThemeChange("light")}>Light</Button>
            <Button variant={theme === "dark" ? "default" : "outline"} size="sm" onClick={() => onThemeChange("dark")}>Dark</Button>
          </div>
        </section>

        <section className="space-y-2" aria-labelledby="update-settings">
          <h3 id="update-settings" className="text-sm font-medium">Updates</h3>
          <p className="text-sm text-muted-foreground">
            {update?.currentVersion ? `Installed version ${update.currentVersion}.` : "Version information unavailable."}
          </p>
          <Button type="button" size="sm" disabled={!canCheckForUpdates || checking} onClick={onCheckForUpdates}>
            {checking ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
            {checking ? "Checking…" : "Check for updates"}
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
