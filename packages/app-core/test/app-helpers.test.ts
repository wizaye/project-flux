import { expect, test } from "bun:test";
import { movedDocumentPath, singleTextEdit } from "../src/app/helpers";
import { calendarGrid, noteFileName } from "../src/daily-notes/config";

test("extracted app helpers preserve path, UTF-8 edit, and calendar behavior", () => {
  expect(movedDocumentPath("Notes/Child/file.md", "Notes", "Archive")).toBe(
    "Archive/Child/file.md"
  );
  expect(singleTextEdit("a😀c", "a🙂c")).toEqual({
    startByte: 1,
    endByte: 5,
    text: "🙂",
  });
  expect(noteFileName("2026-08-23", "YYYY-MM-DD")).toBe("2026-08-23.md");
  expect(calendarGrid("2026-08-23")).toHaveLength(42);
});
