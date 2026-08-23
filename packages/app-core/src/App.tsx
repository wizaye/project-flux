import { useCallback, useEffect } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { FluxLayout } from "@flux/shared-ui/components/flux-layout";
import { ModeToggle } from "@flux/shared-ui/components/mode-toggle";
import { FluxStatusBar } from "@flux/shared-ui/components/status-bar";
import { ThemeProvider, type Theme } from "@flux/shared-ui/components/theme-provider";
import { TooltipProvider } from "@flux/shared-ui/components/tooltip";
import { Toaster } from "@flux/shared-ui/components/sonner";
import { Settings } from "lucide-react";
import type { FluxClient } from "@flux/bridge-contract";
import {
  WorkspaceLeftSidebar,
  WorkspaceRibbon,
  WorkspaceRightSidebar,
  WorkspaceSidebarHeader,
} from "./workspace/sidebars";
import { AddBookmarkDialog } from "./bookmarks/dialog";
import { PdfExportDialog } from "./pdf/export";
import { SettingsDialog } from "./app/settings-dialog";
import { WorkspaceTree } from "./workspace/tree";
import { browserStatePersistence, useAppStore, type FluxStatePersistence } from "./app/state";
import { errorMessage } from "./app/helpers";
import { loadDailyNoteConfig } from "./daily-notes/config";
import { DegradedBanner, InitializationOverlay } from "./app/chrome";
import { PluginModal, PluginSurface } from "./plugins/surface";
import { QuickCapture } from "./quick-capture/view";
import { PluginManager } from "./plugins/manager";
import { WorkspaceLeaf } from "./workspace/leaf";
import {
  CalendarDialog,
  ConfirmDialog,
  RenameDialog,
  TrashManager,
  VaultManager,
} from "./workspace/dialogs";

import {ButtonGroupDropdown} from "@flux/shared-ui/components/design-system/button-with-dropdown";
import ToastDemo from "@flux/shared-ui/components/design-system/toast-demo";
import { ToastProvider } from "@flux/shared-ui/components/ui/toast";
import {OnboardingDemo}  from "@flux/shared-ui/components/design-system/onboarding";

import { useFluxAppController } from "./app/use-flux-app-controller";

export interface FluxRuntime {
  label: string;
  connect: () => Promise<string>;
  client: FluxClient | null;
  selectVaultDirectory?: (mode: "open" | "create") => Promise<string | null>;
  getPerformanceStats?: () => Promise<FluxPerformanceStats | null>;
  openWindow?: (url: string) => Promise<void>;
  hideWindow?: () => Promise<void>;
  getMCPServerCommand?: () => Promise<{ command: string; args: string[] }>;
  onCommand?: (
    handler: (command: "search" | "daily-today" | "calendar" | "settings") => void
  ) => () => void;
  onBeforeShutdown?: (handler: () => Promise<void>) => () => void;
  exportPdf?: (options: PdfExportOptions) => Promise<string | null>;
  getWindowId?: () => Promise<string>;
  setTheme?: (theme: Theme) => Promise<void>;
  setMenuBarIconEnabled?: (enabled: boolean) => Promise<void>;
  statePersistence?: FluxStatePersistence;
  vaultAccess?: "filesystem" | "registry";
}

export interface PdfExportOptions {
  title: string;
  pageSize: "A4" | "Letter";
  landscape: boolean;
  marginMillimetres: number;
  scale: number;
}

export interface FluxPerformanceStats {
  cpuPercent: number;
  memoryMB: number;
}

export interface FluxAppProps {
  runtime: FluxRuntime;
  windowControlsInset?: number;
}

export function FluxApp(props: FluxAppProps) {
  const storedTheme = useAppStore((state) => state.settings.theme);
  const setAppSetting = useAppStore((state) => state.setSetting);
  const statePersistence = props.runtime.statePersistence ?? browserStatePersistence;
  const theme: Theme =
    storedTheme === "dark" || storedTheme === "light" || storedTheme === "system"
      ? storedTheme
      : "system";
  const changeTheme = useCallback(
    (nextTheme: Theme) => {
      if (useAppStore.getState().settings.theme === nextTheme) return;
      setAppSetting("theme", nextTheme);
      void statePersistence.saveAppSetting("theme", nextTheme).catch(() => undefined);
    },
    [setAppSetting, statePersistence]
  );

  useEffect(() => {
    const toggleTheme = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "d" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const isDark =
        theme === "dark" ||
        (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      changeTheme(isDark ? "light" : "dark");
    };

    window.addEventListener("keydown", toggleTheme);
    return () => window.removeEventListener("keydown", toggleTheme);
  }, [changeTheme, theme]);

  useEffect(() => {
    void props.runtime.setTheme?.(theme);
  }, [props.runtime, theme]);

  return (
    <ThemeProvider theme={theme} onThemeChange={changeTheme}>
      {new URLSearchParams(window.location.search).has("quickCapture") ? (
        <QuickCapture runtime={props.runtime} />
      ) : (
        <FluxAppContent {...props} />
      )}
    </ThemeProvider>
  );
}

function FluxAppContent({ runtime, windowControlsInset }: FluxAppProps) {
  const { shell, workspace, vault, sidebar, bookmarks, plugins, dialogs } = useFluxAppController({
    runtime,
  });

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <FluxLayout
            key={shell.sessionVaultId || "initial"}
            windowControlsInset={windowControlsInset}
            mainExtendsIntoTitlebar
            leftSidebarHeader={
              <WorkspaceSidebarHeader
                side="left"
                active={sidebar.effectiveLeftSidebarPane}
                onChange={sidebar.setLeftSidebarPane}
                plugins={plugins.enabled}
              />
            }
            rightSidebarHeader={
              <WorkspaceSidebarHeader
                side="right"
                active={sidebar.rightSidebarPane}
                onChange={sidebar.setRightSidebarPane}
                plugins={plugins.enabled}
              />
            }
            stickySidebar={
              <WorkspaceRibbon
                onGraph={() => {
                  if (plugins.enabled["graph-view"] !== false)
                    workspace.openGraphTab(workspace.activeLeafId);
                }}
                onFiles={() => {
                  if (plugins.enabled["file-explorer"] !== false)
                    workspace.setLeafView(workspace.activeLeafId, "editor");
                }}
                onPlugins={plugins.openPluginManager}
                onCanvas={() => {
                  if (plugins.enabled["canvas"] !== false) workspace.openDocument("Canvas");
                }}
                onCalendar={() => dialogs.setCalendarOpen(true)}
                plugins={plugins.enabled}
                pluginItems={plugins.pluginRibbonItems}
              />
            }
            leftSidebar={
              plugins.pluginView && plugins.pluginViewLocation === "left-sidebar" ? (
                <PluginSurface
                  view={plugins.pluginView}
                  revision={plugins.pluginRuntimeRevision}
                  onClose={() => plugins.setPluginView(undefined)}
                  invokeCapability={plugins.invokePluginViewCapability}
                  showHeader={false}
                />
              ) : (
                <WorkspaceLeftSidebar
                  activeTitle={workspace.visibleActiveTab?.title ?? ""}
                  activePath={workspace.activeFilePath}
                  revealPath={sidebar.sidebarRevealPath}
                  onClearRevealPath={() => sidebar.setSidebarRevealPath(undefined)}
                  pane={sidebar.effectiveLeftSidebarPane}
                  documents={workspace.documents}
                  onOpenDocument={(path) => void workspace.openDocument(path)}
                  onOpenPdf={() => workspace.setLeafView(workspace.activeLeafId, "pdf")}
                  onCreateNote={(parent, name) => void workspace.createNote(parent, name)}
                  vaultEntries={vault.vault ? vault.fileEntries : undefined}
                  onCreateFolder={(parent, name) => void vault.createFolder(parent, name)}
                  onMovePath={(source, destination) => {
                    if (
                      window.confirm(
                        `Move "${source}" to "${destination}"?\n\nLinks and backlinks will be updated.`
                      )
                    )
                      void vault.movePath(source, destination);
                  }}
                  onRenamePath={vault.renamePath}
                  onDeletePath={(path) => void vault.deletePath(path)}
                  onArchivePath={(path) => void vault.archivePath(path)}
                  onOpenTrash={() => void dialogs.openTrash()}
                  onPreviewPath={async (path) => {
                    if (!runtime.client || !vault.vault) return null;
                    return (await runtime.client.readFile(vault.vault.id, path)).content;
                  }}
                  bookmarks={bookmarks.bookmarks}
                  bookmarkGroups={bookmarks.bookmarkGroups}
                  onRemoveBookmark={bookmarks.handleRemoveBookmark}
                  onOpenAddBookmark={() => bookmarks.handleOpenAddBookmark()}
                  onCreateBookmarkGroup={bookmarks.handleCreateBookmarkGroup}
                  expandedFolders={sidebar.expandedFolders}
                  onExpandedFoldersChange={sidebar.setExpandedFolders}
                  onExpandFolder={(path) => void vault.loadFolderChildren(path)}
                  searchVault={vault.searchVaultIndex}
                  searchQuery={sidebar.sidebarSearchQuery}
                  onSearchQueryChange={sidebar.setSidebarSearchQuery}
                  selectedPath={sidebar.sidebarSelectedPath}
                  onSelectPath={sidebar.setSidebarSelectedPath}
                />
              )
            }
            main={
              plugins.pluginView && plugins.pluginViewLocation === "workspace" ? (
                <PluginSurface
                  view={plugins.pluginView}
                  revision={plugins.pluginRuntimeRevision}
                  onClose={() => plugins.setPluginView(undefined)}
                  invokeCapability={plugins.invokePluginViewCapability}
                />
              ) : (
                <div className="relative flex h-full min-h-0 min-w-0 flex-col">
                  {shell.lifecycle === "degraded" ? (
                    <DegradedBanner onRebuild={() => void vault.rebuildIndex()} />
                  ) : null}
                  <div className="min-h-0 flex-1">
                    <WorkspaceTree
                      node={workspace.workspaceRoot}
                      renderLeaf={(leaf) => (
                        <WorkspaceLeaf leaf={leaf} context={workspace.workspaceLeafContext} />
                      )}
                    />
                  </div>
                </div>
              )
            }
            rightSidebar={
              plugins.pluginView && plugins.pluginViewLocation === "right-sidebar" ? (
                <PluginSurface
                  view={plugins.pluginView}
                  revision={plugins.pluginRuntimeRevision}
                  onClose={() => plugins.setPluginView(undefined)}
                  invokeCapability={plugins.invokePluginViewCapability}
                  showHeader={false}
                />
              ) : (
                <WorkspaceRightSidebar
                  pane={sidebar.rightSidebarPane}
                  activeDocument={workspace.visibleActiveTab?.document ?? null}
                  documents={workspace.documents}
                  onOpenDocument={workspace.openDocument}
                  loadReferences={vault.loadDocumentReferences}
                  loadFacets={vault.loadVaultFacets}
                  onSearchTag={(tag) => {
                    sidebar.setSidebarSearchQuery(`tag:${tag}`);
                    sidebar.setLeftSidebarPane("search");
                  }}
                  onNavigateHeading={(heading, line) => {
                    const path = workspace.visibleActiveTab?.document?.path;
                    if (!path) return;
                    sidebar.setHeadingReveal({ path, heading, line, request: Date.now() });
                  }}
                  onOpenReference={(path, line) => {
                    void workspace.openDocument(path).then(() =>
                      sidebar.setHeadingReveal({
                        path,
                        heading: "",
                        line,
                        request: Date.now(),
                        absolute: true,
                      })
                    );
                  }}
                />
              )
            }
            footer={
              <FluxStatusBar
                activeVaultId={vault.activeVaultId}
                vaults={
                  vault.selectableVaults.length
                    ? vault.selectableVaults.map((candidate) => ({
                        id: candidate.key,
                        label: candidate.name,
                      }))
                    : [{ id: "", label: "No vault" }]
                }
                onVaultChange={(id) => {
                  if (id === vault.activeVaultId) return;
                  const candidate = vault.selectableVaults.find((item) => item.key === id);
                  if (candidate) void vault.openRegisteredVault(candidate);
                }}
                onManageVaults={() => vault.setVaultPickerOpen(true)}
                version="FLUX 0.0.1"
                updateStatus="Up to date"
                connectionStatus={shell.status}
                characters={workspace.visibleActiveTab?.document?.content.length ?? 0}
                words={
                  workspace.visibleActiveTab?.document?.content.trim().split(/\s+/).filter(Boolean)
                    .length ?? 0
                }
                backlinks={workspace.backlinksCount}
                cpuPercent={shell.performanceStats?.cpuPercent}
                memoryMB={shell.performanceStats?.memoryMB}
                themeControl={
                  <div className="flex items-center gap-0 -mr-1">
                    <button
                      type="button"
                      aria-label="Settings"
                      title="Settings"
                      onClick={() => dialogs.setSettingsOpen(true)}
                      className="grid size-6 shrink-0 place-items-center rounded-sm outline-none text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50"
                    >
                      <Settings className="size-[15px]" />
                    </button>
                    <ModeToggle className="size-6 rounded-sm border-0 bg-transparent shadow-none hover:bg-accent/60 dark:bg-transparent" />
                  </div>
                }
              />
            }
            leftSidebarOptions={{ defaultWidth: 260, minWidth: 200, maxWidth: 480 }}
            rightSidebarOptions={{ defaultWidth: 280, minWidth: 220, maxWidth: 480 }}
            layoutState={shell.layoutState}
            onLayoutChange={shell.setLayoutState}
          />
          {shell.lifecycle === "initializing" ||
          (vault.vault && shell.sessionVaultId !== vault.vault.id) ? (
            <InitializationOverlay phase={shell.initializationPhase} label={shell.status} />
          ) : null}
          <PluginModal
            view={plugins.pluginViewLocation === "modal" ? plugins.pluginView : undefined}
            revision={plugins.pluginRuntimeRevision}
            onClose={() => plugins.setPluginView(undefined)}
            invokeCapability={plugins.invokePluginViewCapability}
          />

          <PluginManager
            open={plugins.pluginManagerOpen}
            pluginBusy={plugins.pluginBusy}
            pluginCatalog={plugins.pluginCatalog}
            marketplacePlugins={plugins.marketplacePlugins}
            marketplaceError={plugins.marketplaceError}
            pluginSection={plugins.pluginSection}
            pluginQuery={plugins.pluginQuery}
            pluginSettings={plugins.pluginSettings}
            vault={vault.vault}
            vaultPlugins={plugins.vaultPlugins}
            client={runtime.client}
            pluginHostRef={plugins.pluginHostRef}
            onClose={() => plugins.setPluginManagerOpen(false)}
            setPluginSection={plugins.setPluginSection}
            setPluginQuery={plugins.setPluginQuery}
            installPlugin={plugins.installPlugin}
            installMarketplacePlugin={plugins.installMarketplacePlugin}
            savePluginSetting={plugins.savePluginSetting}
            updatePlugin={plugins.updatePlugin}
            openPluginSurface={plugins.openPluginSurface}
          />
          <VaultManager
            open={vault.vaultPickerOpen}
            canClose={Boolean(vault.vault)}
            activeVaultId={vault.activeVaultId}
            vaults={vault.filteredSelectableVaults}
            recentVaults={vault.recentVaults}
            query={vault.vaultQuery}
            vaultAccess={runtime.vaultAccess}
            canSelectDirectory={Boolean(runtime.selectVaultDirectory)}
            onClose={() => vault.setVaultPickerOpen(false)}
            onQueryChange={vault.setVaultQuery}
            onOpenVault={(selected) => void vault.openRegisteredVault(selected)}
            onForgetVault={(vaultId) => void vault.forgetRegisteredVault(vaultId)}
            onChooseVault={(mode) => void vault.chooseVault(mode)}
          />
          <RenameDialog
            request={dialogs.renameRequest}
            onChange={(value) =>
              dialogs.setRenameRequest((current) => (current ? { ...current, value } : current))
            }
            onCancel={() => dialogs.setRenameRequest(undefined)}
            onRename={vault.renamePath}
          />
          <TrashManager
            open={dialogs.trashOpen}
            vaultName={vault.vault?.name}
            entries={dialogs.filteredTrashEntries}
            query={dialogs.trashQuery}
            onQueryChange={dialogs.setTrashQuery}
            onClose={() => dialogs.setTrashOpen(false)}
            onEmpty={() => dialogs.setEmptyTrashRequest(true)}
            onRestore={(entry) => void dialogs.restoreTrashEntry(entry)}
            onDelete={dialogs.setPermanentDeleteRequest}
          />
          <ConfirmDialog
            open={Boolean(dialogs.permanentDeleteRequest)}
            title="Permanently delete?"
            description={
              <>
                This permanently deletes{" "}
                <span className="font-medium text-foreground">
                  {dialogs.permanentDeleteRequest?.originalPath}
                </span>
                . This cannot be undone.
              </>
            }
            action="Delete permanently"
            onCancel={() => dialogs.setPermanentDeleteRequest(undefined)}
            onConfirm={() =>
              dialogs.permanentDeleteRequest &&
              void dialogs.permanentlyDeleteTrashEntry(dialogs.permanentDeleteRequest)
            }
          />
          <ConfirmDialog
            open={dialogs.emptyTrashRequest}
            title="Empty vault trash?"
            description={
              <>
                This permanently deletes all {dialogs.trashEntries.length} items. This cannot be
                undone.
              </>
            }
            action="Empty trash"
            zIndex={205}
            onCancel={() => dialogs.setEmptyTrashRequest(false)}
            onConfirm={() => void dialogs.emptyTrash()}
          />
          <PdfExportDialog
            document={dialogs.pdfExportDocument}
            documents={workspace.documents}
            open={dialogs.pdfExportOpen}
            onOpenChange={dialogs.setPdfExportOpen}
            onExport={runtime.exportPdf}
          />
          <CalendarDialog
            open={dialogs.calendarOpen}
            selected={dialogs.calendarDate}
            monthLabel={dialogs.calendarMonthLabel}
            days={dialogs.calendarDays}
            entries={vault.fileEntries}
            config={dialogs.dailyNoteConfig}
            onSelect={dialogs.setCalendarDate}
            onClose={() => dialogs.setCalendarOpen(false)}
            onOpenDaily={(date) => void dialogs.openDailyNote(date)}
            onOpenWeekly={(date) => void dialogs.openWeeklyNote(date)}
          />
          <SettingsDialog
            open={dialogs.settingsOpen}
            onOpenChange={dialogs.setSettingsOpen}
            onOpenPlugins={() => {
              dialogs.setSettingsOpen(false);
              plugins.openPluginManager();
            }}
            vaultName={vault.vault?.name}
            client={runtime.client}
            vaults={vault.recentVaults}
            vaultId={vault.vault?.id}
            onVaultConfigChange={() => {
              if (!runtime.client || !vault.vault) return;
              void loadDailyNoteConfig(runtime.client, vault.vault.id)
                .then(dialogs.setDailyNoteConfig)
                .catch((cause) => shell.setStatus(errorMessage(cause)));
            }}
            getMCPServerCommand={runtime.getMCPServerCommand}
            onMenuBarIconChange={runtime.setMenuBarIconEnabled}
          />
          <AddBookmarkDialog
            key={`${bookmarks.bookmarkTarget?.path ?? bookmarks.bookmarkTarget?.title ?? "none"}:${bookmarks.addBookmarkDialogOpen}`}
            open={bookmarks.addBookmarkDialogOpen}
            onOpenChange={bookmarks.setAddBookmarkDialogOpen}
            target={bookmarks.bookmarkTarget}
            existingBookmarks={bookmarks.bookmarks}
            existingGroups={bookmarks.bookmarkGroups}
            onSave={bookmarks.handleSaveBookmark}
            onRemove={bookmarks.handleRemoveBookmark}
            onCreateGroup={bookmarks.handleCreateBookmarkGroup}
          />
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </LazyMotion>
    // <ToastProvider>
    //   <div className="align-center flex h-full w-full items-center justify-center gap-2">
    //     <ButtonGroupDropdown/>
    //     <ToastDemo/>
        
    //   </div>

    //   <OnboardingDemo/>
    // </ToastProvider>
  );
}
