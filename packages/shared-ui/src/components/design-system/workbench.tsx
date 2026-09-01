import { useEffect, useMemo, useRef, useState } from "react";
import "@vscode/codicons/dist/codicon.css";

import { Button } from "../ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { ActivityBar, type ActivityBarItem } from "./workbench/chrome/activity-bar";
import { CommandPalette } from "./workbench/chrome/command-palette";
import { NotificationCenter } from "./workbench/chrome/notification-center";
import {
  ReleaseNotesDialog,
  type UpdateDownloadStatus,
} from "./workbench/chrome/release-notes-dialog";
import { WorkbenchFooter } from "./workbench/chrome/workbench-footer";
import { WorkbenchHeader } from "./workbench/chrome/workbench-header";
import { EditorArea, type EditorAreaHandle } from "./workbench/editor/editor-area";
import { JournalCalendar } from "./workbench/journal/journal-calendar";
import { GroupButton } from "./group-button";
import { PrimarySidebar } from "./workbench/sidebar/primary-sidebar";
import { SecondarySidebar } from "./workbench/sidebar/secondary-sidebar";
import { WorkbenchIcon } from "./workbench/shared/workbench-icon";
import { WorkbenchPanel } from "./workbench/shared/workbench-panel";
import type {
  VSCodeWorkbenchProps,
  WorkbenchNotification,
  WorkbenchSnapshot,
  WorkbenchTheme,
} from "./workbench/types";
import { getWorkbenchTheme } from "./workbench/workbench-theme";

export type {
  VSCodeWorkbenchProps,
  WorkbenchSnapshot,
  WorkbenchTheme,
  WorkbenchUpdate,
} from "./workbench/types";

const activityItems: readonly ActivityBarItem[] = [
  { id: "explorer", label: "Explorer", icon: "files" },
  { id: "search", label: "Search", icon: "search" },
  { id: "source-control", label: "Source Control", icon: "source-control" },
  { id: "run", label: "Run and Debug", icon: "debug-alt" },
  { id: "extensions", label: "Extensions", icon: "extensions" },
  { id: "chat", label: "Chat", icon: "comment-discussion" },
  { id: "journal", label: "Journal", icon: "calendar" },
];

const activityCopy: Record<string, { title: string; description: string }> = {
  search: {
    title: "Search isn't connected",
    description: "Workspace search will appear here when a document provider is available.",
  },
  "source-control": {
    title: "Source control isn't connected",
    description: "Repository changes and branches will appear here when Git support is available.",
  },
  run: {
    title: "Run and debug isn't connected",
    description:
      "Launch configurations and debug sessions will appear here when runtime support is available.",
  },
  extensions: {
    title: "Extensions aren't available",
    description: "Extension browsing will appear here when a registry is connected.",
  },
};

type WorkbenchState = {
  activeActivity: string;
  leftOpen: boolean;
  rightOpen: boolean;
  rightMaximized: boolean;
  dismissedNotifications: string[];
};

const LAYOUT_KEY = "flux-workbench-layout-v2";

function initialWorkbenchState(value?: unknown): WorkbenchState {
  const width = typeof window === "undefined" ? 1280 : window.innerWidth;
  const fallback: WorkbenchState = {
    activeActivity: "explorer",
    leftOpen: width >= 680,
    rightOpen: width >= 900,
    rightMaximized: false,
    dismissedNotifications: [],
  };
  const shell =
    isRecord(value) && value.version === 1 && isRecord(value.shell) ? value.shell : null;
  if (!shell) return fallback;
  return {
    activeActivity:
      typeof shell.activeActivity === "string" ? shell.activeActivity : fallback.activeActivity,
    leftOpen: typeof shell.leftOpen === "boolean" ? shell.leftOpen : fallback.leftOpen,
    rightOpen: typeof shell.rightOpen === "boolean" ? shell.rightOpen : fallback.rightOpen,
    rightMaximized:
      typeof shell.rightMaximized === "boolean" ? shell.rightMaximized : fallback.rightMaximized,
    dismissedNotifications: Array.isArray(shell.dismissedNotifications)
      ? shell.dismissedNotifications.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function layoutStorageKey(leftOpen: boolean, rightOpen: boolean) {
  return `${LAYOUT_KEY}:${leftOpen ? "left" : "no-left"}:${rightOpen ? "right" : "no-right"}`;
}

function initialPanelLayouts(value?: unknown): WorkbenchSnapshot["panelLayouts"] {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.panelLayouts)) return {};
  return Object.fromEntries(
    Object.entries(value.panelLayouts).flatMap(([key, layout]) => {
      if (!isRecord(layout)) return [];
      const entries = Object.entries(layout).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1])
      );
      return entries.length ? [[key, Object.fromEntries(entries)]] : [];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function previewFor(path: string) {
  if (path === "AGENTS.md") {
    return "# Flux\n\nLocal-first workspace for thinking, writing, and building.\n\n## Working agreements\n\n- Keep components focused and composable.\n- Build shared interface primitives in the design system.\n- Prefer clear behavior over speculative abstraction.";
  }
  if (path === "package.json") {
    return '{\n  "name": "flux",\n  "private": true,\n  "scripts": {\n    "dev": "turbo dev",\n    "typecheck": "turbo typecheck"\n  }\n}';
  }
  if (path.endsWith(".md")) {
    return `# ${path.split("/").pop()}\n\nPreview content is not connected to a workspace document provider yet.`;
  }
  return `// ${path}\n// Preview content is not connected to a workspace document provider yet.`;
}

export function VSCodeWorkbench({
  runtimeLabel = "Desktop",
  theme,
  titleBarInset = 0,
  initialState,
  update,
  updateStatus,
  updateProgress,
  onDownloadUpdate,
  onInstallUpdate,
  onThemeChange,
  onStateChange,
  words,
  characters,
  backlinks,
  files,
  workspaceName,
  workspaceOpen,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRefreshFiles,
  onRenameFile,
  onDeleteFile,
  onManageVaults,
  onEditorChange,
  onActiveEditorChange,
  onExportPdf,
  onFindInEditor,
  chat,
  journal,
  renderEditor,
  onMoveEditorToNewWindow,
}: VSCodeWorkbenchProps) {
  const [workbenchState, setWorkbenchState] = useState(() => initialWorkbenchState(initialState));
  const [panelLayouts, setPanelLayouts] = useState(() => initialPanelLayouts(initialState));
  const { activeActivity, leftOpen, rightOpen, rightMaximized } = workbenchState;
  const [commandOpen, setCommandOpen] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [localDownloadStatus, setDownloadStatus] = useState<UpdateDownloadStatus>("available");
  const downloadStatus = updateStatus ?? localDownloadStatus;
  const [selectedPath, setSelectedPath] = useState("AGENTS.md");
  const [activeTab, setActiveTab] = useState<import("./workbench/editor/editor-model").EditorTab>();
  const editorRef = useRef<EditorAreaHandle>(null);
  const panelLayoutKey = layoutStorageKey(leftOpen, rightOpen);
  const defaultLayout = panelLayouts[panelLayoutKey];

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", theme === "dark");
    return () => {
      root.classList.toggle("dark", wasDark);
    };
  }, [theme]);

  useEffect(() => {
    onStateChange?.({ version: 1, shell: workbenchState, panelLayouts });
  }, [onStateChange, panelLayouts, workbenchState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setCommandOpen(true);
      }
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        target.matches("input, textarea, select, [contenteditable='true']");
      if (
        !isEditing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        onThemeChange(theme === "dark" ? "light" : "dark");
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onThemeChange, theme]);

  const rootStyle = useMemo(() => getWorkbenchTheme(theme), [theme]);
  const latestVersion = update?.latestVersion;
  const updateAvailable = Boolean(latestVersion && latestVersion !== update?.currentVersion);
  const dismissedNotifications = useMemo(
    () => new Set(workbenchState.dismissedNotifications),
    [workbenchState.dismissedNotifications]
  );
  const notifications = useMemo<WorkbenchNotification[]>(() => {
    if (!updateAvailable || !latestVersion) return [];
    const id = `update:${latestVersion}`;
    if (dismissedNotifications.has(id)) return [];
    return [
      {
        id,
        title: `Flux ${latestVersion} is available`,
        message:
          downloadStatus === "downloading"
            ? "Downloading the update…"
            : downloadStatus === "ready"
              ? "Download complete. Restart Flux when you're ready to install it."
              : downloadStatus === "error"
                ? "The update could not be downloaded. Retry when you're ready."
                : `Codename ${update?.codename ?? "Atlas"} is ready to download.`,
        source: "Flux Update Service",
      },
    ];
  }, [dismissedNotifications, downloadStatus, latestVersion, update?.codename, updateAvailable]);

  function updateWorkbench(changes: Partial<WorkbenchState>) {
    setWorkbenchState((current) => ({ ...current, ...changes }));
  }

  function selectActivity(id: string) {
    if (id === "journal" && journal) {
      editorRef.current?.openTab({ id: "workbench:journal", title: "Journal" });
      return;
    }
    if (id === "chat") {
      updateWorkbench({ activeActivity: id, rightOpen: true, rightMaximized: false });
      return;
    }
    if (id === activeActivity && leftOpen) {
      updateWorkbench({ leftOpen: false });
      return;
    }
    updateWorkbench({ activeActivity: id, leftOpen: true });
  }

  function toggleLeftPane() {
    updateWorkbench({
      leftOpen: !leftOpen,
      activeActivity: leftOpen ? activeActivity : "explorer",
    });
  }

  function toggleRightPane() {
    updateWorkbench({ rightOpen: !rightOpen, rightMaximized: false });
  }

  function toggleTheme() {
    const nextTheme: WorkbenchTheme = theme === "dark" ? "light" : "dark";
    onThemeChange(nextTheme);
  }

  async function openFile(path: string) {
    setSelectedPath(path);
    const tab = (await onOpenFile?.(path)) ?? {
      id: `file:${path}`,
      title: path.split("/").pop() ?? path,
      content: previewFor(path),
    };
    editorRef.current?.openTab(tab);
  }

  function openReleaseNotes() {
    setReleaseNotesOpen(true);
  }

  async function downloadUpdate() {
    if (downloadStatus !== "available" && downloadStatus !== "error") return;
    setDownloadStatus("downloading");
    try {
      await onDownloadUpdate?.();
      setDownloadStatus("ready");
    } catch {
      setDownloadStatus("error");
    }
  }

  async function installUpdate() {
    if (downloadStatus !== "ready") return;
    await onInstallUpdate?.();
  }

  const primary =
    activeActivity === "explorer" ? (
      <PrimarySidebar
        files={files}
        selectedPath={selectedPath}
        workspaceName={workspaceName}
        canMutate={workspaceOpen}
        onSelectFile={(path) => void openFile(path)}
        onCreateFile={
          onCreateFile
            ? async (parent, name) => {
                const tab = await onCreateFile(parent, name);
                if (tab) editorRef.current?.openTab(tab);
              }
            : undefined
        }
        onCreateFolder={onCreateFolder}
        onRefresh={() => void onRefreshFiles?.()}
        onRenameFile={
          onRenameFile
            ? async (path, name) => {
                await onRenameFile(path, name);
                const destination = renamedPath(path, name);
                editorRef.current?.renamePath(path, destination);
                setSelectedPath((current) =>
                  current === path || current.startsWith(`${path}/`)
                    ? `${destination}${current.slice(path.length)}`
                    : current
                );
              }
            : undefined
        }
        onDeleteFile={
          onDeleteFile
            ? async (path) => {
                await onDeleteFile(path);
                editorRef.current?.closePath(path);
                setSelectedPath((current) =>
                  current === path || current.startsWith(`${path}/`) ? "" : current
                );
              }
            : undefined
        }
        onManageVaults={onManageVaults}
      />
    ) : (
      <ActivityPlaceholder activityId={activeActivity} />
    );

  const secondary = (
    <SecondarySidebar
      {...chat}
      maximized={rightMaximized}
      onClose={() =>
        updateWorkbench({
          rightOpen: false,
          rightMaximized: false,
          activeActivity: activeActivity === "chat" ? "explorer" : activeActivity,
        })
      }
      onToggleMaximize={() => updateWorkbench({ rightMaximized: !rightMaximized })}
    />
  );

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} relative grid h-dvh min-h-0 w-full grid-rows-[35px_minmax(0,1fr)_22px] overflow-hidden bg-[var(--workbench-chrome)] text-[13px] text-[var(--workbench-fg)] antialiased`}
      data-theme={theme}
      data-workbench=""
      style={rootStyle}
    >
      <WorkbenchHeader
        title="flux"
        leftInset={titleBarInset}
        leftPaneOpen={leftOpen}
        rightPaneOpen={rightOpen}
        onCommand={() => setCommandOpen(true)}
        onToggleLeftPane={toggleLeftPane}
        onToggleRightPane={toggleRightPane}
        updateLabel={updateAvailable ? "Update available" : undefined}
        updateStatus={downloadStatus}
        updateProgress={updateProgress}
        onDownloadUpdate={updateAvailable ? () => void downloadUpdate() : undefined}
        onInstallUpdate={updateAvailable ? () => void installUpdate() : undefined}
        onOpenReleaseNotes={updateAvailable ? openReleaseNotes : undefined}
      />

      <main id="workbench-content" className="flex min-h-0 min-w-0 gap-1 overflow-hidden pb-1">
        <ActivityBar
          items={activityItems}
          activeId={activeActivity}
          theme={theme}
          onActiveChange={selectActivity}
          onThemeChange={onThemeChange}
        />

        {rightOpen && rightMaximized ? (
          <div className="min-w-0 flex-1 pe-1">{secondary}</div>
        ) : (
          <ResizablePanelGroup
            key={panelLayoutKey}
            id={panelLayoutKey}
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={(layout, meta) => {
              if (meta.isUserInteraction) {
                setPanelLayouts((current) => ({ ...current, [panelLayoutKey]: layout }));
              }
            }}
            className="min-w-0 flex-1 pe-1"
          >
            {leftOpen ? (
              <>
                <ResizablePanel
                  id="primary-sidebar"
                  defaultSize="296px"
                  minSize="190px"
                  maxSize="45%"
                >
                  {primary}
                </ResizablePanel>
                <WorkbenchResizeHandle label="Resize primary side bar" />
              </>
            ) : null}

            <ResizablePanel id="editor" minSize="280px">
              <div className="h-full overflow-hidden rounded-[6px] border border-[var(--workbench-border)] bg-[var(--workbench-editor)] shadow-[0_1px_2px_var(--workbench-shadow)]">
                <EditorArea
                  ref={editorRef}
                  renderEditor={(tab, updateTab) =>
                    tab.id === "workbench:journal" && journal ? (
                      <JournalCalendar
                        {...journal}
                        onOpenEntry={async (path) => {
                          const opened = await journal.onOpenEntry(path);
                          if (opened) editorRef.current?.openTab(opened);
                        }}
                        onCreateEntry={async (date, title, tags) => {
                          const opened = await journal.onCreateEntry(date, title, tags);
                          if (opened) editorRef.current?.openTab(opened);
                          return opened;
                        }}
                        onOpenWeekly={async (date) => {
                          const opened = await journal.onOpenWeekly(date);
                          if (opened) editorRef.current?.openTab(opened);
                        }}
                      />
                    ) : (
                      renderEditor?.(tab, updateTab)
                    )
                  }
                  onMoveToNewWindow={onMoveEditorToNewWindow}
                  onDocumentChange={onEditorChange}
                  onActiveTabChange={(tab) => {
                    setActiveTab(tab);
                    onActiveEditorChange?.(tab);
                  }}
                  onResolveTab={(tab) =>
                    tab.id.startsWith("file:")
                      ? (onOpenFile?.(tab.id.slice(5)) ?? Promise.resolve(tab))
                      : Promise.resolve(tab)
                  }
                  onExportPdf={onExportPdf}
                  onFind={onFindInEditor}
                  initialTabs={
                    files
                      ? []
                      : [
                          {
                            id: "file:AGENTS.md",
                            title: "AGENTS.md",
                            content: previewFor("AGENTS.md"),
                          },
                        ]
                  }
                />
              </div>
            </ResizablePanel>

            {rightOpen ? (
              <>
                <WorkbenchResizeHandle label="Resize secondary side bar" />
                <ResizablePanel
                  id="secondary-sidebar"
                  defaultSize="300px"
                  minSize="240px"
                  maxSize="50%"
                >
                  {secondary}
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        )}
      </main>

      <WorkbenchFooter
        words={
          words ??
          (activeTab
            ? (activeTab.content?.trim().split(/\s+/).filter(Boolean).length ?? 0)
            : undefined)
        }
        characters={characters ?? activeTab?.content?.length}
        backlinks={backlinks}
        left={
          <GroupButton>
            <Button variant="ghost" size="xs" type="button" title="Current branch">
              <WorkbenchIcon name="git-branch" size={12} />
              main
            </Button>
            <Button variant="ghost" size="xs" type="button" title="No problems">
              <WorkbenchIcon name="error-small" size={12} />0 0
            </Button>
          </GroupButton>
        }
        center={`${runtimeLabel} · Flux`}
        right={
          <GroupButton>
            <Button
              variant="ghost"
              size="xs"
              type="button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-pressed={theme === "dark"}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme (D)`}
              onClick={toggleTheme}
            >
              <WorkbenchIcon name={theme === "dark" ? "color-mode" : "symbol-color"} size={12} />
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
            <NotificationCenter
              notifications={notifications}
              onNotificationClick={openReleaseNotes}
              onAction={(_notificationId, actionId) => {
                if (actionId === "download") void downloadUpdate();
                if (actionId === "release-notes") openReleaseNotes();
              }}
              onDismiss={(notificationId) =>
                updateWorkbench({
                  dismissedNotifications: [
                    ...new Set([...workbenchState.dismissedNotifications, notificationId]),
                  ],
                })
              }
              onClear={() =>
                updateWorkbench({
                  dismissedNotifications: [
                    ...new Set([
                      ...workbenchState.dismissedNotifications,
                      ...notifications.map(({ id }) => id),
                    ]),
                  ],
                })
              }
            />
          </GroupButton>
        }
      />

      <ReleaseNotesDialog
        open={releaseNotesOpen}
        update={update}
        downloadStatus={downloadStatus}
        onOpenChange={setReleaseNotesOpen}
        onDownload={() => void downloadUpdate()}
      />

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        commands={[
          {
            label: leftOpen ? "View: Hide Primary Side Bar" : "View: Show Primary Side Bar",
            run: toggleLeftPane,
          },
          {
            label: rightOpen ? "View: Hide Secondary Side Bar" : "View: Show Secondary Side Bar",
            run: toggleRightPane,
          },
          ...(update ? [{ label: "Help: Show Release Notes", run: openReleaseNotes }] : []),
          ...(journal
            ? [{ label: "Journal: Open Calendar", run: () => selectActivity("journal") }]
            : []),
        ]}
      />
    </div>
  );
}

function renamedPath(path: string, name: string) {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return parent ? `${parent}/${name}` : name;
}

function WorkbenchResizeHandle({ label }: { label: string }) {
  return (
    <ResizableHandle
      aria-label={label}
      className="w-1 bg-transparent after:w-1 after:bg-transparent hover:after:bg-[var(--workbench-focus)] focus-visible:ring-0 focus-visible:after:bg-[var(--workbench-focus)]"
    />
  );
}

function ActivityPlaceholder({ activityId }: { activityId: string }) {
  const copy = activityCopy[activityId] ?? {
    title: "View unavailable",
    description: "This view is not connected yet.",
  };
  return (
    <WorkbenchPanel>
      <header className="flex h-[35px] shrink-0 items-center px-3">
        <h2 className="truncate text-[11px] font-normal uppercase tracking-[.04em]">
          {activityItems.find((item) => item.id === activityId)?.label ?? "View"}
        </h2>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <WorkbenchIcon name="info" size={24} className="mb-3 text-[var(--workbench-muted)]" />
        <p className="text-[13px] font-medium text-[var(--workbench-fg)]">{copy.title}</p>
        <p className="mt-1 max-w-[28ch] text-pretty text-[12px] leading-[1.5] text-[var(--workbench-muted)]">
          {copy.description}
        </p>
      </div>
    </WorkbenchPanel>
  );
}
