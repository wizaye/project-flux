import { useState } from "react";

import { Button } from "../../../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog";
import { Input } from "../../../ui/input";

export type WorkbenchCommand = { label: string; run: () => void };

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly WorkbenchCommand[];
};

export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const filtered = commands.filter(({ label }) =>
    label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  function setOpen(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) setQuery("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[43px] max-w-[620px] -translate-y-0 gap-0 overflow-hidden rounded-md border-border bg-popover p-0 text-popover-foreground shadow-md sm:max-w-[620px]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search and run a workbench command
        </DialogDescription>
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search commands"
          placeholder="Type a command"
          className="m-1.5 h-7 w-[calc(100%-0.75rem)] rounded-sm border-input bg-background px-2 text-[13px] text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        />
        <nav aria-label="Commands" className="max-h-64 overflow-y-auto p-1 pt-0">
          {filtered.length ? (
            filtered.map((command) => (
              <Button
                key={command.label}
                type="button"
                variant="ghost"
                onClick={() => {
                  command.run();
                  setOpen(false);
                }}
                className="h-7 w-full justify-start rounded-sm px-2 text-[12px] font-normal text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {command.label}
              </Button>
            ))
          ) : (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">No matching commands</p>
          )}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
