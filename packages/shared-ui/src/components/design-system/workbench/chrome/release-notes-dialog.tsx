import { Button } from "../../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog";
import { ScrollArea } from "../../../ui/scroll-area";
import { Sparkles } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../reui/alert";
import { Frame, FramePanel } from "../../reui/frame";
import type { WorkbenchUpdate } from "../types";

const releaseBannerUrl =
  "https://images.unsplash.com/photo-1602422701241-7ba4f6fc1712?q=80&w=776&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

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
  onOpenChange: (open: boolean) => void;
  onDownload: () => void;
}

export function ReleaseNotesDialog({
  open,
  update,
  downloadStatus,
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
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-hidden sm:max-w-[680px]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Codename {codename}</DialogTitle>
          <DialogDescription>Build {version}</DialogDescription>
        </DialogHeader>

        <Frame className="min-h-0 overflow-hidden">
          <FramePanel className="overflow-hidden p-0">
            <div className="overflow-hidden border-b bg-muted">
              <img
                src={update?.bannerUrl ?? releaseBannerUrl}
                alt={`${codename} release artwork`}
                className="aspect-[20/7] w-full object-cover"
              />
            </div>
            <Alert className="rounded-none border-0 shadow-none">
              <Sparkles className="text-muted-foreground" aria-hidden="true" />
              <AlertTitle>Codename {codename} · Build {version}</AlertTitle>
              <AlertAction>
                <Button type="button" variant="outline" size="xs" onClick={() => onOpenChange(false)}>
                  Dismiss
                </Button>
                <Button type="button" size="xs" disabled={downloadStatus === "downloading" || downloadStatus === "ready"} onClick={onDownload}>
                  {downloadStatus === "downloading" ? "Downloading…" : downloadStatus === "ready" ? "Downloaded" : downloadStatus === "error" ? "Retry" : "Update"}
                </Button>
              </AlertAction>
              <AlertDescription>
                <p className="mb-2 font-medium text-foreground">What&apos;s new</p>
                <ScrollArea className="max-h-48">
                  <div className="pr-4 leading-6">{releaseNotes}</div>
                </ScrollArea>
              </AlertDescription>
            </Alert>
          </FramePanel>
        </Frame>
      </DialogContent>
    </Dialog>
  );
}
