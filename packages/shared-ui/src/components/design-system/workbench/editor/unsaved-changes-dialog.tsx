import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../ui/alert-dialog";

export type UnsavedChangesDialogProps = {
  open: boolean;
  fileName?: string;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
};

export function UnsavedChangesDialog({
  open,
  fileName,
  onOpenChange,
  onDiscard,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md rounded-md border-border bg-popover text-popover-foreground">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-sans text-base">
            Discard unsaved changes?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-muted-foreground">
            {fileName
              ? `Changes to ${fileName} will be lost.`
              : "Unsaved changes in this editor group will be lost."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="border-border bg-transparent">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDiscard}>
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
