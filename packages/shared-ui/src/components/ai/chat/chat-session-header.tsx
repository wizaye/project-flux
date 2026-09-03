"use client";

import * as React from "react";
import { Check, ChevronDown, History, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import type { ChatSession } from "../chat";

export function ChatSessionHeader({
  sessions,
  activeSessionId,
  canManage,
  onCreate,
  onDelete,
  onRename,
  onSelect,
}: {
  sessions: ChatSession[];
  activeSessionId?: string;
  canManage: boolean;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSelect: (id: string) => void;
}) {
  const active = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const [dialog, setDialog] = React.useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = React.useState(active?.title ?? "New chat");

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--workbench-border)] px-1.5" role="toolbar" aria-label="Chat sessions">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 min-w-0 flex-1 justify-start gap-1.5 rounded-sm px-1.5 text-[11px] font-medium"
              />
            }
          >
            <History className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{active?.title ?? "New chat"}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Sessions</DropdownMenuLabel>
              <DropdownMenuItem onClick={onCreate} className="gap-2">
                <Plus aria-hidden="true" />
                Create new session
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {sessions.map((session) => (
              <DropdownMenuItem key={session.id} onClick={() => onSelect(session.id)}>
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                {session.id === active?.id ? <Check aria-hidden="true" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button type="button" variant="ghost" size="icon-sm" onClick={onCreate} aria-label="New chat" title="New chat">
          <Plus aria-hidden="true" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Session actions" />}
          >
            <MoreHorizontal aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              disabled={!canManage}
              onClick={() => {
                setTitle(active?.title ?? "New chat");
                setDialog("rename");
              }}
            >
              <Pencil aria-hidden="true" />
              Rename session
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canManage}
              variant="destructive"
              onClick={() => setDialog("delete")}
            >
              <Trash2 aria-hidden="true" />
              Delete session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={dialog === "rename"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>Use a short name that makes this conversation easy to find.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="chat-session-title">Session name</Label>
            <Input
              id="chat-session-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              type="button"
              disabled={!title.trim()}
              onClick={() => {
                if (active) onRename(active.id, title.trim());
                setDialog(null);
              }}
            >
              Rename session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>This permanently removes “{active?.title ?? "New chat"}” and its history.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (active) onDelete(active.id);
                setDialog(null);
              }}
            >
              Delete session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
