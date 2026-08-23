import { expect, test } from "bun:test";
import { setFrontmatterProperty, splitFrontmatter } from "../src/editor/frontmatter";

test("keeps frontmatter out of the editor while preserving it in the file", () => {
  const file = "---\ntags: [flux]\n---\n\n# Note";
  expect(splitFrontmatter(file).body).toBe("\n# Note");
  expect(setFrontmatterProperty(file, "status", "draft")).toBe(
    '---\ntags: [flux]\nstatus: "draft"\n---\n\n# Note'
  );
});
