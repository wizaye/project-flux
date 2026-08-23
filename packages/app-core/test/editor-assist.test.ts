import { describe, expect, test } from "bun:test";
import { wikilinkCompletionEdit, wikilinkFragment, wikilinkTarget } from "../src/editor/editor-assist";

describe("wikilink completion", () => {
  test("detects the active query after the last opening brackets", () => {
    expect(wikilinkFragment("Text [[Tar", 10)).toEqual({ from: 7, query: "Tar" });
    expect(wikilinkFragment("Text [[Target]]", 15)).toBeNull();
  });

  test("uses the title unless duplicate note names require a path", () => {
    const documents = [
      { title: "Target", path: "one/Target.md" },
      { title: "Target", path: "two/Target.markdown" },
    ];
    expect(wikilinkTarget(documents[0], documents)).toBe("one/Target");
    expect(wikilinkTarget({ title: "Unique", path: "notes/Unique.md" }, documents)).toBe("Unique");
  });

  test("completes both auto-closed and manually opened links", () => {
    expect(wikilinkCompletionEdit("[[]]", "Target", 2, 2)).toEqual({
      insert: "Target",
      anchor: 10,
    });
    expect(wikilinkCompletionEdit("[[Tar", "Target", 2, 5)).toEqual({
      insert: "Target]]",
      anchor: 10,
    });
  });
});
