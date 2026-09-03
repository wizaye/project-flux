"use client";

import type { ComponentProps } from "react";

import {
  Chat,
  type ChatMessage,
  type ChatSession,
} from "../../../ai/chat";

export type AIChatPanelProps = {
  sessions?: ChatSession[];
  activeSessionId?: string;
  messages?: ChatMessage[];
  onNewChat?: () => void;
  onSelectSession?: (id: string) => void;
  onSend?: (message: string) => void;
} & Omit<ComponentProps<typeof Chat>, "sessions" | "activeSessionId" | "messages" | "onNewChat" | "onSelectSession" | "onSend">;

export function AIChatPanel({
  sessions,
  activeSessionId,
  messages,
  onNewChat,
  onSelectSession,
  onSend,
  ...chatProps
}: AIChatPanelProps) {
  return (
    <Chat
      sessions={sessions}
      activeSessionId={activeSessionId}
      messages={messages}
      onNewChat={onNewChat}
      onSelectSession={onSelectSession}
      onSend={onSend}
      {...chatProps}
    />
  );
}
