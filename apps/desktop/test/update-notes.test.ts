import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { formatReleaseNotes } from "../src/main/update-notes";

describe("formatReleaseNotes", () => {
  test("normalizes updater strings and versioned note lists", () => {
    expect(formatReleaseNotes("Fixed sync")).toBe("Fixed sync");
    expect(
      formatReleaseNotes([
        { version: "0.2.0", note: "Added notifications" },
        { version: "0.1.1", note: "Fixed startup" },
      ])
    ).toBe("## 0.2.0\n\nAdded notifications\n\n## 0.1.1\n\nFixed startup");
    expect(formatReleaseNotes({ note: "ignored" })).toBeUndefined();
  });
});

test("desktop releases publish updater metadata and expose a real install path", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as {
    build: { publish: { provider: string; owner: string; repo: string }; mac: { target: string[] } };
  };
  const main = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

  expect(packageJson.build.publish).toMatchObject({
    provider: "github",
    owner: "wizaye",
    repo: "project-flux",
  });
  expect(packageJson.build.mac.target).toEqual(["dmg", "zip"]);
  expect(main).toContain('ipcMain.handle("install-update"');
  expect(main).toContain('autoUpdater.on("download-progress"');
  expect(main).toContain('autoUpdater.on("update-downloaded"');
});
