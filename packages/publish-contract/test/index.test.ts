import { describe, expect, test } from "bun:test";
import {
  PUBLICATION_SCHEMA_VERSION,
  isSafeBundlePath,
  manifestErrors,
  type PublicationManifest,
} from "../src";

const hash = "a".repeat(64);

function manifest(): PublicationManifest {
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    publication: { id: "publication", name: "Garden", title: "Garden" },
    snapshot: { id: "snapshot", contentHash: hash },
    pages: [
      {
        id: "page",
        contentPath: "pages/note.md",
        outputPath: "note/index.html",
        slug: "/note",
        title: "Note",
        tags: [],
        aliases: [],
        contentHash: hash,
        outgoing: [],
        toc: [],
        draft: false,
      },
    ],
    assets: [],
    navigation: [],
    graph: { path: "graph.json" },
    backlinks: { path: "backlinks.json" },
  };
}

describe("publication manifest", () => {
  test("accepts safe renderer-only metadata", () => {
    expect(manifestErrors(manifest())).toEqual([]);
  });

  test("rejects private and escaping paths", () => {
    expect(isSafeBundlePath(".flux/index.db")).toBeFalse();
    expect(isSafeBundlePath("pages/../../private.md")).toBeFalse();
    const value = manifest();
    value.pages[0]!.contentPath = "../private.md";
    expect(manifestErrors(value)).toContain("unsafe page path: page");
  });

  test("rejects malformed input without throwing", () => {
    expect(manifestErrors(null)).toEqual(["manifest must be an object"]);
    expect(manifestErrors({ schemaVersion: 1 })).toContain("pages must be an array");
  });
});
