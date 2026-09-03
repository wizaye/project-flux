import { beforeEach, describe, expect, test } from "bun:test";

import { browserStatePersistence, useAppStore } from "../src/app/state";

describe("app state", () => {
  beforeEach(() => {
    useAppStore.setState({
      hydrated: false,
      vaultId: null,
      vaultName: null,
      lifecycle: "initializing",
      indexing: null,
      workspace: null,
      settings: {},
    });
  });

  test("tracks lifecycle progress without vault contents", () => {
    useAppStore.getState().setVault({ id: "vault-1", name: "Notes" }, "indexing", {
      phase: "markdown",
      processed: 4,
      total: 10,
      failed: 0,
    });

    expect(useAppStore.getState()).toMatchObject({
      vaultId: "vault-1",
      lifecycle: "indexing",
      indexing: { processed: 4, total: 10 },
    });
    expect(useAppStore.getState()).not.toHaveProperty("documents");
  });

  test("keeps settings changed while hydration is in flight", () => {
    useAppStore.getState().setSetting("theme", "dark");
    useAppStore.getState().hydrate({ theme: "light", spellcheck: true });

    expect(useAppStore.getState()).toMatchObject({
      hydrated: true,
      settings: { theme: "dark", spellcheck: true },
    });
  });

  test("keeps workspace only while setting the same vault", () => {
    const session = {
      version: 1,
      vaultId: "vault-1",
      activePath: "Notes/One.md",
      tabs: [{ id: 1, path: "Notes/One.md", mode: "read", pinned: true }],
      workspaceRoot: {
        kind: "leaf",
        id: 1,
        view: "editor",
        tabIds: [1],
        activeTabId: 1,
      },
      activeLeafId: 1,
      leftSidebarPane: "files",
      rightSidebarPane: "backlinks",
    } as const;

    useAppStore.getState().setVault({ id: "vault-1", name: "Notes" });
    useAppStore.getState().setWorkspace(session);
    useAppStore.getState().setVault({ id: "vault-1", name: "Notes renamed" });
    expect(useAppStore.getState().workspace).toBe(session);

    useAppStore.getState().setVault({ id: "vault-2", name: "Other" });
    expect(useAppStore.getState().workspace).toBeNull();
  });

  test("uses volatile fallback without browser storage", async () => {
    const session = {
      version: 1,
      vaultId: "volatile-vault",
      tabs: [],
      workspaceRoot: { kind: "leaf", id: 1, view: "editor", tabIds: [], activeTabId: 1 },
      activeLeafId: 1,
      leftSidebarPane: "files",
      rightSidebarPane: "backlinks",
    } as const;

    await browserStatePersistence.saveWorkspaceSession("volatile-window", session);
    await browserStatePersistence.saveAppSetting("theme", "dark");

    await expect(
      browserStatePersistence.loadWorkspaceSession("volatile-window", "volatile-vault")
    ).resolves.toEqual(session);
    await expect(browserStatePersistence.loadAppSettings()).resolves.toMatchObject({
      theme: "dark",
    });
  });
});
