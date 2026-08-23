import { expect, test } from "bun:test";
import { listIndentWidth, nestedOrderedMarkerEdit } from "../src/editor/markdown-list";

test("indents nested lists to the parent content column", () => {
  expect(listIndentWidth("- child", ["1. parent"], 2, false)).toBe(3);
  expect(listIndentWidth("- child", ["10. parent"], 2, false)).toBe(4);
  expect(listIndentWidth("- child", ["100. parent"], 2, false)).toBe(5);
  expect(listIndentWidth("- child", ["- parent"], 2, false)).toBe(2);
});

test("outdents to the previous list level", () => {
  expect(listIndentWidth("   - child", ["1. parent"], 2, true)).toBe(3);
  expect(listIndentWidth("     - grandchild", ["   - child", "1. parent"], 2, true)).toBe(2);
});

test("nested ordered lists restart at one like Obsidian", () => {
  expect(nestedOrderedMarkerEdit("2. child")).toEqual({ from: 0, to: 1, insert: "1" });
  expect(nestedOrderedMarkerEdit("   12) child")).toEqual({ from: 3, to: 5, insert: "1" });
  expect(nestedOrderedMarkerEdit("1. child")).toBeNull();
});
