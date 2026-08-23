import { describe, expect, test } from "bun:test";
import { buildLinkIndex, linkedMentionsFor, unlinkedMentionsFor } from "../src/editor/link-index";
import type { DemoDocument } from "../src/editor/markdown-editor";

const documents: DemoDocument[] = [
  { title: "Target", path: "notes/Target.md", content: "# Target\n" },
  {
    title: "Linked",
    path: "Linked.md",
    content: "See [[Target#Heading|the target]].\nAnd [again](notes/Target.md#Heading).",
  },
  {
    title: "Plain",
    path: "Plain.md",
    content: "Target is mentioned here. `Target` and [[Target]] are links, not plain mentions.",
  },
];

describe("link index", () => {
  test("resolves wiki and markdown links by title or vault path", () => {
    const index = buildLinkIndex(documents);
    expect(index.backlinks.get("notes/Target.md")).toEqual(new Set(["Linked.md", "Plain.md"]));
    expect(linkedMentionsFor(documents, "Target")).toHaveLength(3);
  });

  test("finds unlinked title mentions but ignores links and inline code", () => {
    expect(unlinkedMentionsFor(documents, "Target")).toEqual([
      expect.objectContaining({ source: "Plain.md", line: 1 }),
    ]);
  });

  test("does not silently resolve duplicate filenames", () => {
    const duplicates: DemoDocument[] = [
      { title: "route", path: "one/route.ts", content: "" },
      { title: "route", path: "two/route.ts", content: "" },
      { title: "source", path: "source.md", content: "[[route]] [[one/route.ts]]" },
    ];
    const index = buildLinkIndex(duplicates);
    expect(index.edges).toEqual([{ source: "source.md", target: "one/route.ts" }]);
  });
});
