"use client";

import * as React from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";

import { Thread } from "../assistant-ui/thread";
import { ChatComposerControls, ChatContextUsage } from "./chat/chat-controls";
import { ChatSessionHeader } from "./chat/chat-session-header";
import {
  CHAT_ATTACHMENTS,
  createPreviewModelAdapter,
  type ChatConfiguration,
  type ChatProviderOption,
} from "./chat/chat-runtime";

export type { ChatConfiguration, ChatProviderOption } from "./chat/chat-runtime";
export type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
  ToolApprovalOptionKind,
  ToolCallMessagePart,
} from "@assistant-ui/react";

export type ChatSession = { id: string; title: string };
export type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text?: string;
  content?: ThreadMessageLike["content"];
  createdAt?: Date;
};

export type ChatModelAdapterFactory = (
  sessionId: string,
  getConfiguration: () => ChatConfiguration,
) => ChatModelAdapter;

export type ChatProps = {
  sessions?: ChatSession[];
  activeSessionId?: string;
  messages?: ChatMessage[];
  providers?: readonly ChatProviderOption[];
  configuration?: ChatConfiguration;
  modelAdapterFactory?: ChatModelAdapterFactory;
  onNewChat?: () => void;
  onSelectSession?: (id: string) => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onSend?: (message: string) => void;
  onConfigurationChange?: (configuration: ChatConfiguration) => void;
};

const DEFAULT_SESSIONS: ChatSession[] = [
  { id: "welcome", title: "New chat" },
  { id: "workbench", title: "Workbench layout" },
];

const DEFAULT_CONFIGURATION: ChatConfiguration = {
  mode: "agent",
  provider: "openai",
  model: "gpt-5.6-terra",
  effort: "medium",
};

export function Chat({
  sessions,
  activeSessionId,
  messages = [],
  providers,
  configuration: controlledConfiguration,
  modelAdapterFactory,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onSend,
  onConfigurationChange,
}: ChatProps) {
  const controlled = sessions !== undefined;
  const [localSessions, setLocalSessions] = React.useState<ChatSession[]>(
    sessions ?? DEFAULT_SESSIONS,
  );
  const [localActiveId, setLocalActiveId] = React.useState(
    activeSessionId ?? localSessions[0]?.id ?? "welcome",
  );
  const [localConfiguration, setLocalConfiguration] =
    React.useState<ChatConfiguration>(DEFAULT_CONFIGURATION);
  const configuration = controlledConfiguration ?? localConfiguration;

  const visibleSessions = controlled ? sessions : localSessions;
  const selectedId =
    activeSessionId ??
    (visibleSessions.some((session) => session.id === localActiveId)
      ? localActiveId
      : visibleSessions[0]?.id);

  function selectSession(id: string) {
    setLocalActiveId(id);
    onSelectSession?.(id);
  }

  function createSession() {
    const session = { id: crypto.randomUUID(), title: "New chat" };
    if (!controlled) setLocalSessions((current) => [session, ...current]);
    setLocalActiveId(session.id);
    onNewChat?.();
  }

  function renameSession(id: string, title: string) {
    if (controlled) return onRenameSession?.(id, title);
    setLocalSessions((current) =>
      current.map((session) => (session.id === id ? { ...session, title } : session)),
    );
  }

  function deleteSession(id: string) {
    if (controlled) return onDeleteSession?.(id);
    setLocalSessions((current) => {
      const next = current.filter((session) => session.id !== id);
      if (next.length) {
        setLocalActiveId((active) => (active === id ? next[0]!.id : active));
        return next;
      }
      const replacement = { id: crypto.randomUUID(), title: "New chat" };
      setLocalActiveId(replacement.id);
      return [replacement];
    });
  }

  function updateConfiguration(next: ChatConfiguration) {
    setLocalConfiguration(next);
    onConfigurationChange?.(next);
  }

  return (
    <section
      aria-label="AI chat"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-[var(--workbench-fg)]"
    >
      <ChatSessionHeader
        sessions={visibleSessions}
        activeSessionId={selectedId}
        canManage={!controlled || Boolean(onRenameSession && onDeleteSession)}
        onCreate={createSession}
        onDelete={deleteSession}
        onRename={renameSession}
        onSelect={selectSession}
      />

      <div className="relative min-h-0 flex-1">
        {selectedId ? (
          <ChatRuntime
            key={selectedId}
            sessionId={selectedId}
            configuration={configuration}
            initialMessages={messages}
            providers={providers}
            modelAdapterFactory={modelAdapterFactory}
            onConfigurationChange={updateConfiguration}
            onSend={onSend}
          />
        ) : null}
      </div>
    </section>
  );
}

function ChatRuntime({
  sessionId,
  configuration,
  initialMessages,
  providers,
  modelAdapterFactory,
  onConfigurationChange,
  onSend,
}: {
  sessionId: string;
  configuration: ChatConfiguration;
  initialMessages: ChatMessage[];
  providers?: readonly ChatProviderOption[];
  modelAdapterFactory?: ChatModelAdapterFactory;
  onConfigurationChange: (configuration: ChatConfiguration) => void;
  onSend?: (message: string) => void;
}) {
  const adapter = React.useMemo(
    () =>
      modelAdapterFactory?.(sessionId, () => configuration) ??
      createPreviewModelAdapter(() => configuration, onSend),
    [configuration, modelAdapterFactory, onSend, sessionId],
  );
  const runtime = useLocalRuntime(adapter, {
    initialMessages: initialMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content ?? message.text ?? "",
      createdAt: message.createdAt ?? new Date(),
      status:
        message.role === "assistant"
          ? ({ type: "complete", reason: "stop" } as const)
          : undefined,
    })),
    adapters: { attachments: CHAT_ATTACHMENTS },
  });

  return (
    <div className="h-full">
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread
          composerControls={
            <ChatComposerControls
              configuration={configuration}
              providers={providers}
              onConfigurationChange={onConfigurationChange}
            />
          }
          composerContext={
            <ChatContextUsage configuration={configuration} providers={providers} />
          }
        />
      </AssistantRuntimeProvider>
    </div>
  );
}
