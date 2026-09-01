import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { getWorkbenchTheme } from "../src/components/design-system/workbench/workbench-theme";

describe("workbench visual contract", () => {
  test("active tabs separate from their strip in both themes", () => {
    const dark = getWorkbenchTheme("dark") as Record<string, string>;
    const light = getWorkbenchTheme("light") as Record<string, string>;

    expect(dark["--workbench-tab-bar"]).toBe("#181818");
    expect(dark["--workbench-tab-active"]).toBe("#2b2b2b");
    expect(light["--workbench-tab-bar"]).toBe("#f3f3f3");
    expect(light["--workbench-tab-active"]).toBe("#ffffff");
  });

  test("workbench scrollbars and PDF printing have scoped CSS", () => {
    const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

    expect(css).toContain("[data-workbench]");
    expect(css).toContain("--workbench-scrollbar-thumb");
    expect(css).toContain(".flux-print-document");
    expect(css).toContain("@media print");
    expect(css).toContain("white-space: pre-wrap");
    expect(css).toContain("body > :not(.flux-print-document)");
    expect(css).toContain("height: auto !important");
    expect(css).toContain("var(--flux-print-margin, 18mm)");
  });

  test("updater keeps its blue staged-action treatment", () => {
    const source = readFileSync(
      new URL("../src/components/design-system/button-with-dropdown.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("from-blue-500");
    expect(source).toContain("to-blue-700");
    expect(source).toContain("Downloaded");
    expect(source).toContain("Verifying package…");
    expect(source).toContain("Click to install");
  });
});
