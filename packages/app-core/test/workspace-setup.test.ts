import { expect, test } from "bun:test";
import { workspaceCreationPath } from "../src/workbench/workspace-setup";

test("new workspace uses a child folder on desktop and a registry name on web", () => {
  expect(workspaceCreationPath(" My notes ", "/Users/me/Documents/", false)).toBe("/Users/me/Documents/My notes");
  expect(workspaceCreationPath("Notes", "C:\\Users\\me\\", false)).toBe("C:\\Users\\me\\Notes");
  expect(workspaceCreationPath("Notes", "/", false)).toBe("/Notes");
  expect(workspaceCreationPath("Research", "", true)).toBe("Research");
  for (const name of ["", ".", "..", "../notes", "a/b", "a\\b", "CON", "notes.", "a:b"]) {
    expect(() => workspaceCreationPath(name, "/tmp", false)).toThrow();
  }
  expect(() => workspaceCreationPath("Notes", "relative/path", false)).toThrow();
  expect(() => workspaceCreationPath("Notes", "", false)).toThrow();
});
