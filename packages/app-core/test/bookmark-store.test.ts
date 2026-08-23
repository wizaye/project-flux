import { describe, expect, test } from "bun:test";
import {
  loadBookmarks,
  saveBookmarks,
  loadBookmarkGroups,
  saveBookmarkGroups,
  type BookmarkItem,
} from "../src/bookmarks/store";

describe("bookmark-store", () => {
  test("loadBookmarks returns default empty array when empty", () => {
    const items = loadBookmarks("test-vault");
    expect(items).toEqual([]);
  });

  test("saveBookmarks and loadBookmarks persist items correctly", () => {
    const sample: BookmarkItem[] = [
      { id: "1", title: "Project Plan", path: "Projects/Project Plan.md", group: "Writing", createdAt: 1000 },
      { id: "2", title: "Reference Notes", path: "Reference/Notes.md", group: undefined, createdAt: 2000 },
    ];
    saveBookmarks(sample, "test-vault");
    const loaded = loadBookmarks("test-vault");
    expect(loaded).toEqual(sample);
  });

  test("saveBookmarkGroups and loadBookmarkGroups persist groups", () => {
    const groups = ["Writing", "Reference", "Archive"];
    saveBookmarkGroups(groups, "test-vault");
    const loaded = loadBookmarkGroups("test-vault");
    expect(loaded).toEqual(groups);
  });
});
