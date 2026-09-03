import { Button } from "../../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog";
import { ScrollArea } from "../../../ui/scroll-area";
import { LightbulbIcon, XIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../reui/alert";
import { Frame, FramePanel } from "../../reui/frame";
import type { WorkbenchUpdate } from "../types";

export type UpdateDownloadStatus =
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "verifying"
  | "ready"
  | "installing"
  | "error";

export interface ReleaseNotesDialogProps {
  open: boolean;
  update?: WorkbenchUpdate;
  downloadStatus: UpdateDownloadStatus;
  downloadProgress?: number;
  onOpenChange: (open: boolean) => void;
  onDownload: () => void;
}

export function ReleaseNotesDialog({
  open,
  update,
  downloadStatus,
  downloadProgress,
  onOpenChange,
  onDownload,
}: ReleaseNotesDialogProps) {
  const version =
    update?.latestVersion ??
    update?.currentVersion ??
    "Unknown";

  const codename = update?.codename ?? "Atlas";

  const releaseNotes =
    update?.releaseNotes?.trim() ||
    "Detailed release notes are coming soon.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto bg-transparent p-0 ring-0 sm:max-w-lg"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Codename {codename}</DialogTitle>
          <DialogDescription>Build {version}</DialogDescription>
        </DialogHeader>

        <Frame variant="ghost">
          <FramePanel className="overflow-hidden p-0!">
            <Alert variant="info" className="border-0 shadow-none">
              <LightbulbIcon aria-hidden="true" />
              <AlertTitle>New: Codename {codename}</AlertTitle>
              <AlertAction>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label="Close changelog"
                  className="-mt-1 -mr-2 size-7 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </AlertAction>
              <AlertDescription>
                <p className="mb-2 text-foreground">Build {version}</p>
                <ScrollArea className="h-[min(24rem,45dvh)] min-h-0">
                  <div className="whitespace-pre-wrap break-words pe-4 leading-6">{releaseNotes}</div>
                </ScrollArea>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 underline"
                  disabled={!["available", "error"].includes(downloadStatus)}
                  aria-live="polite"
                  onClick={onDownload}
                >
                  {downloadStatus === "downloading"
                    ? typeof downloadProgress === "number"
                      ? `Downloading ${Math.round(downloadProgress)}%`
                      : "Downloading…"
                    : downloadStatus === "verifying"
                      ? "Verifying package…"
                    : downloadStatus === "installing"
                      ? "Installing…"
                    : downloadStatus === "checking"
                      ? "Checking for updates…"
                    : downloadStatus === "ready" || downloadStatus === "downloaded"
                      ? "Downloaded"
                      : downloadStatus === "error"
                        ? "Retry download"
                        : "Download update"}
                </Button>
              </AlertDescription>
            </Alert>
          </FramePanel>
        </Frame>
      </DialogContent>
    </Dialog>
  );
}
