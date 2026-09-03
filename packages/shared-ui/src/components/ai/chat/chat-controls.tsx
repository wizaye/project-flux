"use client";

import type { ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { ThreadTokenUsage } from "@assistant-ui/ai-sdk";
import { Bot, Check, ChevronDown, Sparkles } from "lucide-react";

import { ContextDisplay } from "../../assistant-ui/context-display";
import {
  ModelSelector,
  type ModelOption as SelectorModelOption,
} from "../../assistant-ui/model-selector";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import {
  estimateTokens,
  getModel,
  PREVIEW_PROVIDERS,
  type ChatConfiguration,
  type ChatEffort,
  type ChatMode,
  type ChatProviderOption,
} from "./chat-runtime";

const MODES: Array<{ value: ChatMode; label: string; description: string }> = [
  { value: "ask", label: "Ask", description: "Answer from available context" },
  { value: "plan", label: "Plan", description: "Inspect and propose steps" },
  { value: "agent", label: "Agent", description: "Use tools and make changes" },
];

const EFFORTS: Array<{ value: ChatEffort; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

const providerModels = (provider: ChatProviderOption): SelectorModelOption[] => {
  return provider.models.map((model) => ({
    id: model.value,
    name: model.label,
    description: `${provider.label} · ${model.context.toLocaleString()} context`,
    efforts: EFFORTS.map((effort) => ({ id: effort.value, name: effort.label })),
  }));
};

export function ChatComposerControls({
  configuration,
  providers = PREVIEW_PROVIDERS,
  onConfigurationChange,
}: {
  configuration: ChatConfiguration;
  providers?: readonly ChatProviderOption[];
  onConfigurationChange: (configuration: ChatConfiguration) => void;
}) {
  const provider = providers.find((item) => item.id === configuration.provider) ?? providers[0]!;
  const model = getModel(configuration, providers);

  return (
    <div className="grid min-w-0 flex-1 grid-cols-2 items-center gap-0.5" role="toolbar" aria-label="Model configuration">
      <ControlMenu
        label="Mode"
        value={MODES.find((item) => item.value === configuration.mode)?.label ?? "Agent"}
        icon={<Bot aria-hidden="true" />}
      >
        {MODES.map((item) => (
          <DropdownMenuItem
            key={item.value}
            onClick={() => onConfigurationChange({ ...configuration, mode: item.value })}
            className="items-start py-1.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">{item.label}</span>
              <span className="block text-[10px] leading-4 text-muted-foreground">{item.description}</span>
            </span>
            {item.value === configuration.mode ? <Check aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </ControlMenu>

      <ControlMenu
        label="Provider"
        value={provider.label}
        icon={<Sparkles aria-hidden="true" />}
      >
        {providers.map((item) => (
          <DropdownMenuItem
            key={item.id}
            disabled={item.available === false}
            onClick={() =>
              onConfigurationChange({
                ...configuration,
                provider: item.id,
                model: item.models[0]?.value ?? "default",
              })
            }
          >
            <span className="flex-1">{item.label}</span>
            {item.id === configuration.provider ? <Check aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </ControlMenu>

      <ModelSelector
        models={providerModels(provider)}
        value={model.value}
        effort={configuration.effort}
        onValueChange={(modelId) => onConfigurationChange({ ...configuration, model: modelId })}
        onEffortChange={(effort) =>
          onConfigurationChange({ ...configuration, effort: effort as ChatEffort })
        }
        searchable
        variant="ghost"
        size="sm"
        className="col-span-2 h-7 w-full max-w-none justify-between rounded-sm px-1.5 text-[10px] font-normal text-muted-foreground"
        contentClassName="rounded-lg"
      />
    </div>
  );
}

function ControlMenu({
  label,
  value,
  icon,
  children,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-w-0 gap-1 rounded-sm px-1.5 text-[10px] font-normal text-muted-foreground"
            aria-label={`${label}: ${value}`}
          />
        }
      >
        <span className="[&_svg]:size-3.5">{icon}</span>
        <span className="max-w-24 truncate">{value}</span>
        <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatContextUsage({
  configuration,
  providers = PREVIEW_PROVIDERS,
}: {
  configuration: ChatConfiguration;
  providers?: readonly ChatProviderOption[];
}) {
  const messages = useAuiState((state) => state.thread.messages);
  let inputCharacters = 0;
  let outputCharacters = 0;
  let reasoningCharacters = 0;
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "reasoning") reasoningCharacters += part.text.length;
      if (part.type !== "text") continue;
      if (message.role === "user") inputCharacters += part.text.length;
      else outputCharacters += part.text.length;
    }
  }
  const inputTokens = estimateTokens("x".repeat(inputCharacters));
  const outputTokens = estimateTokens("x".repeat(outputCharacters));
  const reasoningTokens = estimateTokens("x".repeat(reasoningCharacters));
  const usage: ThreadTokenUsage = {
    inputTokens,
    cachedInputTokens: Math.floor(inputTokens * 0.25),
    outputTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + reasoningTokens,
  };
  const limit = getModel(configuration, providers).context;

  return (
    <div className="flex items-center">
      <ContextDisplay.Ring
        modelContextWindow={limit}
        usage={usage}
        side="top"
        showPercent={false}
        className="size-7 justify-center rounded-full p-0"
      />
    </div>
  );
}
