import { expect, test } from "bun:test";
import { GFM, parser } from "@lezer/markdown";
import { obsidianMarkdownExtensions } from "../src/editor/obsidian-markdown";

test("parses Obsidian and GFM syntax as semantic nodes", () => {
  const tree = parser.configure([...GFM, ...obsidianMarkdownExtensions]).parse(`
~~strike~~ ==highlight== [[Note|alias]] ![[Embed]] [^1] #tag
- [x] task

| A | B |
|---|---|
| 1 | 2 |

hidden %%comment%% visible ^block-id
`);
  const names = new Set<string>();
  tree.iterate({ enter: (node) => void names.add(node.type.name) });

  for (const name of [
    "Strikethrough",
    "Highlight",
    "WikiLink",
    "Embed",
    "FootnoteRef",
    "Tag",
    "Task",
    "Table",
    "Comment",
    "BlockRef",
  ]) {
    expect(names.has(name)).toBeTrue();
  }
});
