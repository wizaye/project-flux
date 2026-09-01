export type AgentMode = "ask" | "plan" | "agent" | "tutor";

export type AgentThreadStatus = "idle" | "running" | "waiting" | "error";

export type AgentTurnStatus = "running" | "waiting" | "completed" | "interrupted" | "error";

export interface AgentConfiguration {
  providerId: string;
  model?: string;
  mode: AgentMode;
  reasoningEffort?: "low" | "medium" | "high";
}

export interface AgentProviderCapabilities {
  streaming: boolean;
  reasoning: boolean;
  tools: boolean;
  files: boolean;
  images: boolean;
  plans: boolean;
}

export interface AgentProvider {
  id: string;
  name: string;
  available: boolean;
  status: "ready" | "not_installed" | "auth_required" | "unavailable";
  capabilities: AgentProviderCapabilities;
}

export interface AgentThread {
  id: string;
  vaultId: string;
  title?: string;
  configuration: AgentConfiguration;
  status: AgentThreadStatus;
  activeTurnId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTurn {
  id: string;
  threadId: string;
  status: AgentTurnStatus;
  createdAt: string;
  completedAt?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface AgentApprovalOption {
  id: string;
  label: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | "other";
}

export interface AgentEventPayloadMap {
  "turn.started": { prompt: string };
  "reasoning.delta": { itemId: string; delta: string };
  "reasoning.completed": { itemId: string };
  "source.added": { sourceId: string; title: string; url: string };
  "tool.started": { toolCallId: string; name: string; title: string };
  "tool.updated": {
    toolCallId: string;
    status: "running" | "completed" | "failed" | "declined";
    detail?: string;
  };
  "approval.requested": {
    requestId: string;
    title: string;
    detail?: string;
    toolCallId?: string;
    options: AgentApprovalOption[];
  };
  "approval.resolved": { requestId: string; optionId: string };
  "plan.updated": {
    entries: Array<{
      id: string;
      text: string;
      status: "pending" | "in_progress" | "completed";
    }>;
  };
  "usage.updated": { used: number; size: number; cost?: number; currency?: string };
  "message.delta": { messageId: string; delta: string };
  "message.completed": { messageId: string };
  "file.change.started": { changeId: string; path: string; oldText?: string };
  "file.change.delta": { changeId: string; offset: number; delta: string };
  "file.change.completed": { changeId: string; path: string };
  "files.changed": { paths: string[] };
  "turn.completed": { status: AgentTurnStatus; usage?: AgentUsage };
  "runtime.error": { message: string; code?: string };
}

export interface AgentEventBase {
  eventId: string;
  sequence: number;
  threadId: string;
  turnId?: string;
  createdAt: string;
}

export type AgentEvent = {
  [K in keyof AgentEventPayloadMap]: AgentEventBase & {
    type: K;
    payload: AgentEventPayloadMap[K];
  };
}[keyof AgentEventPayloadMap];

export interface CreateAgentThreadRequest {
  vaultId: string;
  title?: string;
  configuration: AgentConfiguration;
}

export interface StartAgentTurnRequest {
  prompt: string;
}
