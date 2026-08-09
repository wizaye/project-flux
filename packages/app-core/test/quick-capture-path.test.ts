import { describe, expect, test } from "bun:test";

import { quickCaptureInboxPath } from "../src/quick-capture-path";

describe("quick capture inbox path", () => {
  test("joins a filename to the configured inbox folder", () => {
    expect(quickCaptureInboxPath("index", "Meeting notes")).toBe("index/Meeting notes.md");
    expect(quickCaptureInboxPath("Inbox.md", "Idea.md")).toBe("Idea.md");
    expect(quickCaptureInboxPath("index", "../escape")).toBeNull();
  });
});
