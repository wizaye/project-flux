import { expect, test } from "bun:test";

import { createGraphWorkspaceTab } from "../src/workspace/tabs";

test("graph tabs have their own view identity and optional local root", () => {
  expect(createGraphWorkspaceTab(4)).toMatchObject({
    id: 4,
    title: "Graph view",
    kind: "graph",
    document: null,
  });
  expect(createGraphWorkspaceTab(5, "notes/Root.md")).toMatchObject({
    id: 5,
    title: "Local graph",
    kind: "graph",
    graphRootPath: "notes/Root.md",
    document: null,
  });
});
