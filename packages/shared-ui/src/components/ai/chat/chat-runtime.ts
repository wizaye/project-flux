import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  type AttachmentAdapter,
  type ChatModelAdapter,
  type CompleteAttachment,
  type PendingAttachment,
  type ThreadAssistantMessagePart,
  type ThreadMessage,
} from "@assistant-ui/react";

export type ChatMode = "ask" | "plan" | "agent";
export type ChatProvider = string;
export type ChatEffort = "low" | "medium" | "high" | "max";
export type ChatConfiguration = {
  mode: ChatMode;
  provider: ChatProvider;
  model: string;
  effort: ChatEffort;
};

export type ModelOption = { value: string; label: string; context: number };

export type ChatProviderOption = {
  id: string;
  label: string;
  available?: boolean;
  models: ModelOption[];
};

export const PREVIEW_PROVIDERS: ChatProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", context: 256_000 },
      { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", context: 256_000 },
      { value: "gpt-5.5", label: "GPT-5.5", context: 200_000 },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", context: 200_000 },
      { value: "claude-haiku-4.5", label: "Claude Haiku 4.5", context: 200_000 },
    ],
  },
  {
    id: "google",
    label: "Google",
    models: [{ value: "gemini-3-pro", label: "Gemini 3 Pro", context: 1_000_000 }],
  },
];

export function getModel(
  configuration: ChatConfiguration,
  providers: readonly ChatProviderOption[] = PREVIEW_PROVIDERS,
) {
  const provider =
    providers.find((item) => item.id === configuration.provider) ?? providers[0]!;
  return (
    provider.models.find((model) => model.value === configuration.model) ??
    provider.models[0] ?? { value: "default", label: "Default", context: 128_000 }
  );
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createPreviewResponse(prompt: string, configuration: ChatConfiguration) {
  const model = getModel(configuration).label;
  const task = prompt.replace(/\s+/g, " ").trim().slice(0, 120);
  return [
    `I’m ready to work on **${task || "this request"}** using ${model}.`,
    "",
    "This is the frontend runtime, so the response is being streamed locally without sending workspace data to a model provider. Connect the same Assistant UI adapter to the app backend when the model gateway is ready.",
  ].join("\n");
}

export function createDemoContent(
  prompt: string,
  approved?: boolean,
): ThreadAssistantMessagePart[] {
  const task = prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "the requested change";
  if (approved !== undefined) {
    return [{
      type: "text" as const,
      text: approved
        ? "Done — the patch was applied and the focused checks pass."
        : "No changes were made. I kept the proposed patch available for review.",
    }];
  }

  return [
    {
      type: "reasoning" as const,
      text: `I’ll verify the current implementation, check the relevant guidance, and prepare the smallest safe patch for ${task}.`,
    },
    {
      type: "tool-call" as const,
      toolCallId: "search-guidance",
      toolName: "web_search",
      args: { query: "Assistant UI production chat patterns" },
      argsText: JSON.stringify({ query: "Assistant UI production chat patterns" }),
      result: "Found official guidance for grouped reasoning, sources, and approval-gated tools.",
    },
    {
      type: "source" as const,
      sourceType: "url" as const,
      id: "assistant-ui-tools",
      url: "https://www.assistant-ui.com/docs/tools/tool-ui",
      title: "Assistant UI · Tool UI",
    },
    {
      type: "source" as const,
      sourceType: "url" as const,
      id: "assistant-ui-reasoning",
      url: "https://www.assistant-ui.com/docs/guides/chain-of-thought",
      title: "Assistant UI · Reasoning",
    },
    {
      type: "tool-call" as const,
      toolCallId: "inspect-chat",
      toolName: "read_file",
      args: { path: "packages/shared-ui/src/components/ai/chat.tsx" },
      argsText: JSON.stringify({ path: "packages/shared-ui/src/components/ai/chat.tsx" }),
      result: "Read the chat shell and traced the local runtime configuration.",
    },
    {
      type: "text" as const,
      text: [
        "I found one focused change. The patch keeps session state intact and moves the richer behavior into the runtime adapter.",
        "",
        "```tsx",
        "<Thread",
        "  composerControls={<ChatComposerControls />}",
        "  contextFooter={<ContextDisplay.Ring />}",
        "/>",
        "```",
      ].join("\n"),
    },
    {
      type: "tool-call" as const,
      toolCallId: "apply-chat-patch",
      toolName: "apply_patch",
      args: { files: 3, summary: "Add rich assistant workflow" },
      argsText: JSON.stringify({ files: 3, summary: "Add rich assistant workflow" }),
      approval: {
        id: "approve-chat-patch",
        options: [
          { id: "once", kind: "allow-once" as const, label: "Apply patch" },
          { id: "deny", kind: "reject-once" as const, label: "Keep read-only" },
        ],
      },
    },
  ];
}

export function createPreviewModelAdapter(
  getConfiguration: () => ChatConfiguration,
  onSend?: (message: string) => void,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal, unstable_getMessage }) {
      const configuration = getConfiguration();
      const last = messages[messages.length - 1];
      const prompt =
        last?.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n") ?? "";
      onSend?.(prompt);

      const approval = findApproval([...messages, unstable_getMessage()]);
      if (approval !== undefined) {
        yield {
          content: createDemoContent(prompt, approval),
          metadata: previewMetadata(configuration, performance.now(), 1),
        };
        return;
      }

      const startedAt = performance.now();
      const content = createDemoContent(prompt);
      for (let index = 1; index <= content.length; index += 1) {
        if (abortSignal.aborted) return;
        yield {
          content: content.slice(0, index),
          status:
            index === content.length
              ? { type: "requires-action", reason: "tool-calls" }
              : undefined,
          metadata: previewMetadata(configuration, startedAt, index),
        };
        await wait(index === 1 ? 420 : 180, abortSignal);
      }
    },
  };
}

function findApproval(messages: readonly ThreadMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (
        part.type === "tool-call" &&
        part.toolCallId === "apply-chat-patch" &&
        part.approval?.approved !== undefined
      ) {
        return part.approval.approved;
      }
    }
  }
  return undefined;
}

function previewMetadata(
  configuration: ChatConfiguration,
  startedAt: number,
  chunks: number,
) {
  const elapsed = Math.max(performance.now() - startedAt, 1);
  const tokenCount = 96 + chunks * 28;
  return {
    timing: {
      streamStartTime: startedAt,
      firstTokenTime: startedAt + 80,
      totalStreamTime: elapsed,
      tokenCount,
      tokensPerSecond: tokenCount / (elapsed / 1000),
      totalChunks: chunks,
      toolCallCount: 3,
    },
    custom: { ...configuration, modelLabel: getModel(configuration).label },
  };
}

async function wait(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

class GenericFileAttachmentAdapter implements AttachmentAdapter {
  accept = "*";

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    return {
      id: crypto.randomUUID(),
      type: "file",
      name: file.name,
      contentType: file.type || "application/octet-stream",
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          mimeType: attachment.contentType || "application/octet-stream",
          data: await fileDataUrl(attachment.file),
        },
      ],
    };
  }

  async remove() {}
}

async function fileDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const CHAT_ATTACHMENTS = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new SimpleTextAttachmentAdapter(),
  new GenericFileAttachmentAdapter(),
]);
