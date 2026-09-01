import { expect, test } from "bun:test";

import {
  createDemoContent,
  createPreviewResponse,
  estimateTokens,
} from "../src/components/ai/chat/chat-runtime";

test("preview runtime reports stable token estimates and model context", () => {
  expect(estimateTokens("12345")).toBe(2);
  expect(
    createPreviewResponse("Fix the workbench", {
      mode: "agent",
      provider: "openai",
      model: "gpt-5.6-terra",
      effort: "medium",
    }),
  ).toContain("GPT-5.6 Terra");
});

test("demo response includes research, code, and an approval gate", () => {
  const content = createDemoContent("Improve chat");
  expect(content.some((part) => part.type === "reasoning")).toBe(true);
  expect(content.some((part) => part.type === "source")).toBe(true);
  expect(
    content.some((part) => part.type === "tool-call" && part.approval),
  ).toBe(true);
});
