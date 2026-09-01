"use client";

import { AIChatPanel, type AIChatPanelProps } from "./ai-chat-panel";
import { WorkbenchPanel } from "../shared/workbench-panel";
import { WorkbenchIconButton } from "../shared/workbench-control";
export type { ChatMessage, ChatSession } from "../../../ai/chat";

export type SecondarySidebarProps = Omit<AIChatPanelProps, "area"> & {
  maximized: boolean;
  onClose: () => void;
  onToggleMaximize: () => void;
};

export function SecondarySidebar({
  maximized,
  onClose,
  onToggleMaximize,
  ...chatProps
}: SecondarySidebarProps) {
  return (
    <WorkbenchPanel>
      <header className="flex h-[35px] shrink-0 items-center gap-2 px-2">
        <h2 className="min-w-0 flex-1 truncate px-1 text-[11px] font-normal uppercase tracking-[.04em]">
          Chat
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <WorkbenchIconButton
            icon={maximized ? "screen-normal" : "screen-full"}
            aria-label={maximized ? "Restore chat panel" : "Maximize chat panel"}
            aria-pressed={maximized}
            onClick={onToggleMaximize}
          />
          <WorkbenchIconButton icon="close" aria-label="Close chat panel" onClick={onClose} />
        </div>
      </header>
      <AIChatPanel {...chatProps} />
    </WorkbenchPanel>
  );
}
