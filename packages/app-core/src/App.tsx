import { useCallback, useEffect, useRef, useState } from "react";
import { VSCodeWorkbench } from "@flux/shared-ui/components/design-system/workbench";
import { ThemeProvider } from "@flux/shared-ui/components/theme-provider";
import type {
  WorkbenchSnapshot,
  WorkbenchTheme,
  WorkbenchUpdate,
} from "@flux/shared-ui/components/design-system/workbench";
import type { FluxClient } from "@flux/bridge-contract";
import { browserStatePersistence, type FluxStatePersistence } from "./app/state";
import { useAgentChat } from "./agent/use-agent-chat";
import { MarkdownEditor, type DemoDocument } from "./editor/markdown-editor";
import { PdfExportDialog } from "./pdf/export";
import { VaultManager } from "./workspace/dialogs";
import { useWorkbenchVault } from "./workbench/use-workbench-vault";
import { dateFromKey, localDateKey } from "./daily-notes/config";
import { useDailyNotes } from "./daily-notes/use-daily-notes";

export interface FluxRuntime {
  label: string;
  connect: () => Promise<string>;
  client: FluxClient | null;
  selectVaultDirectory?: (mode: "open" | "create") => Promise<string | null>;
  getPerformanceStats?: () => Promise<FluxPerformanceStats | null>;
  checkForUpdates?: () => Promise<WorkbenchUpdate>;
  downloadUpdate?: () => Promise<void>;
  installUpdate?: () => Promise<void>;
  onUpdateStatus?: (handler: (status: UpdateRuntimeStatus) => void) => () => void;
  openWindow?: (url: string) => Promise<void>;
  hideWindow?: () => Promise<void>;
  getMCPServerCommand?: () => Promise<{ command: string; args: string[] }>;
  onCommand?: (
    handler: (command: "search" | "daily-today" | "calendar" | "settings") => void
  ) => () => void;
  onBeforeShutdown?: (handler: () => Promise<void>) => () => void;
  exportPdf?: (options: PdfExportOptions) => Promise<string | null>;
  getWindowId?: () => Promise<string>;
  setTheme?: (theme: "system" | "dark" | "light") => Promise<void>;
  setMenuBarIconEnabled?: (enabled: boolean) => Promise<void>;
  statePersistence?: FluxStatePersistence;
  vaultAccess?: "filesystem" | "registry";
}

export type UpdateRuntimeStatus =
  | { state: "checking" }
  | { state: "available"; update: WorkbenchUpdate }
  | { state: "not-available"; update: WorkbenchUpdate }
  | { state: "downloading"; percent: number; transferred: number; total: number }
  | { state: "downloaded"; update: WorkbenchUpdate }
  | { state: "verifying"; update: WorkbenchUpdate }
  | { state: "ready"; update: WorkbenchUpdate }
  | { state: "installing"; update: WorkbenchUpdate }
  | { state: "error"; message: string };

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

const THEME_KEY = "workbench.theme";

function preferredTheme(): WorkbenchTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function snapshotKey(windowId: string) {
  return `workbench.window.${windowId}`;
}

export function FluxApp({ runtime, windowControlsInset = 0 }: FluxAppProps) {
  const persistence = runtime.statePersistence ?? browserStatePersistence;
  const [theme, setTheme] = useState<WorkbenchTheme>(preferredTheme);
  const [windowId, setWindowId] = useState<string>();
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>();
  const [update, setUpdate] = useState<WorkbenchUpdate>();
  const [updateStatus, setUpdateStatus] = useState<UpdateRuntimeStatus>();
  const [hydrated, setHydrated] = useState(false);
  const snapshotRef = useRef<WorkbenchSnapshot | undefined>(undefined);
  const [vaultQuery, setVaultQuery] = useState("");
  const [backlinks, setBacklinks] = useState<number>();
  const [findRequest, setFindRequest] = useState(0);
  const [pdfDocument, setPdfDocument] = useState<DemoDocument | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      runtime.getWindowId?.() ?? Promise.resolve("main"),
      persistence.loadAppSettings(),
    ])
      .then(([id, settings]) => {
        if (cancelled) return;
        const savedTheme = settings[THEME_KEY];
        setWindowId(id);
        setSnapshot(settings[snapshotKey(id)] as WorkbenchSnapshot | undefined);
        if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setWindowId("main");
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [persistence, runtime]);

  const vault = useWorkbenchVault({ runtime, persistence, windowId });
  const chat = useAgentChat(runtime.client, vault.vault?.id);
  const reportJournalError = useCallback((message: string) => console.error(message), []);
  const journal = useDailyNotes({
    client: runtime.client,
    vault: vault.vault,
    files: vault.files,
    refreshFiles: vault.refreshFiles,
    openDocument: vault.openFile,
    onStatus: reportJournalError,
  });
  const changeVaultDocument = vault.changeDocument;

  useEffect(() => {
    if (!hydrated || !runtime.checkForUpdates) return;
    let cancelled = false;
    void runtime
      .checkForUpdates()
      .then((nextUpdate) => {
        if (!cancelled) setUpdate(nextUpdate);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hydrated, runtime]);

  useEffect(
    () =>
      runtime.onUpdateStatus?.((status) => {
        setUpdateStatus(status);
        if ("update" in status) setUpdate(status.update);
      }),
    [runtime]
  );

  useEffect(() => {
    if (!hydrated) return;
    void persistence.saveAppSetting(THEME_KEY, theme).catch(() => undefined);
    void runtime.setTheme?.(theme);
  }, [hydrated, persistence, runtime, theme]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    if (!hydrated || !windowId || !snapshot) return;
    const timeout = window.setTimeout(() => {
      void persistence.saveAppSetting(snapshotKey(windowId), snapshot).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [hydrated, persistence, snapshot, windowId]);

  useEffect(
    () =>
      runtime.onBeforeShutdown?.(async () => {
        if (windowId && snapshotRef.current) {
          await persistence.saveAppSetting(snapshotKey(windowId), snapshotRef.current);
        }
      }),
    [persistence, runtime, windowId]
  );

  const handleStateChange = useCallback((next: WorkbenchSnapshot) => setSnapshot(next), []);
  const renderEditor = useCallback(
    (
      tab: { id: string; title: string; content?: string },
      update: (changes: { title?: string; content?: string; dirty?: boolean }) => void
    ) => {
      if (!tab.title.toLowerCase().endsWith(".md")) return null;
      const path = tab.id.startsWith("file:") ? tab.id.slice(5) : undefined;
      return (
        <MarkdownEditor
          document={{ title: tab.title.replace(/\.md$/i, ""), path, content: tab.content ?? "" }}
          mode="live"
          onChange={(content) => {
            update({ content, dirty: true });
            if (path) changeVaultDocument(path, content, () => update({ dirty: false }));
          }}
          onTitleChange={() => undefined}
          showBacklinks={false}
          findRequest={findRequest}
        />
      );
    },
    [changeVaultDocument, findRequest]
  );

  if (!hydrated) return <div className="h-dvh bg-background" />;

  return (
    <ThemeProvider
      theme={theme}
      onThemeChange={(nextTheme) => nextTheme !== "system" && setTheme(nextTheme)}
    >
      <VSCodeWorkbench
        key={windowId}
        runtimeLabel={runtime.label}
        theme={theme}
        titleBarInset={windowControlsInset}
        initialState={snapshot}
        update={update}
        updateStatus={
          updateStatus?.state === "checking"
            ? "checking"
            : updateStatus?.state === "available"
              ? "available"
              : updateStatus?.state === "downloading"
                ? "downloading"
                : updateStatus?.state === "downloaded"
                  ? "downloaded"
                  : updateStatus?.state === "verifying"
                    ? "verifying"
                    : updateStatus?.state === "ready"
                      ? "ready"
                      : updateStatus?.state === "installing"
                        ? "installing"
                        : updateStatus?.state === "error"
                          ? "error"
                          : undefined
        }
        updateProgress={updateStatus?.state === "downloading" ? updateStatus.percent : undefined}
        onDownloadUpdate={runtime.downloadUpdate}
        onInstallUpdate={runtime.installUpdate}
        onThemeChange={setTheme}
        onStateChange={handleStateChange}
        files={vault.files}
        workspaceName={vault.vault?.name ?? "No vault open"}
        workspaceOpen={Boolean(vault.vault)}
        onOpenFile={vault.openFile}
        onCreateFile={vault.createFile}
        onCreateFolder={vault.createFolder}
        onRefreshFiles={vault.refreshFiles}
        onRenameFile={vault.renameFile}
        onDeleteFile={vault.deleteFile}
        onManageVaults={() => vault.setManagerOpen(true)}
        onEditorChange={(tab, content, onSaved) => {
          if (tab.id.startsWith("file:")) vault.changeDocument(tab.id.slice(5), content, onSaved);
        }}
        onActiveEditorChange={(tab) => {
          const path = tab?.id.startsWith("file:") ? tab.id.slice(5) : undefined;
          if (!path) {
            setBacklinks(undefined);
            return;
          }
          void vault
            .backlinkCount(path)
            .then(setBacklinks)
            .catch(() => setBacklinks(0));
        }}
        backlinks={backlinks}
        onFindInEditor={() => setFindRequest((value) => value + 1)}
        onExportPdf={(tab) => {
          setPdfDocument({
            title: tab.title.replace(/\.md$/i, ""),
            path: tab.id.startsWith("file:") ? tab.id.slice(5) : undefined,
            content: tab.content ?? "",
          });
          setPdfOpen(true);
        }}
        chat={runtime.client ? (chat ?? { sessions: [], messages: [] }) : undefined}
        journal={{
          selectedDate: journal.date,
          monthLabel: journal.monthLabel,
          days: journal.days,
          entries: journal.entries,
          onSelectDate: journal.setDate,
          onChangeMonth: (offset) => {
            const date = dateFromKey(journal.date);
            date.setMonth(date.getMonth() + offset, 1);
            journal.setDate(localDateKey(date));
          },
          onOpenEntry: vault.openFile,
          onCreateEntry: journal.createEntry,
          onOpenWeekly: journal.openWeekly,
        }}
        renderEditor={renderEditor}
        onMoveEditorToNewWindow={(tab) => {
          const url = new URL(window.location.href);
          url.searchParams.set("popout", tab.id.startsWith("file:") ? tab.id.slice(5) : tab.title);
          if (runtime.openWindow) void runtime.openWindow(url.toString());
          else window.open(url.toString(), "_blank", "popup,width=960,height=720");
        }}
      />
      <VaultManager
        open={vault.managerOpen}
        canClose={Boolean(vault.vault)}
        activeVaultId={vault.vault?.id ?? ""}
        vaults={vault.available
          .filter((item) =>
            `${item.name} ${item.path}`.toLowerCase().includes(vaultQuery.toLowerCase())
          )
          .map((item) => ({ key: item.vaultId ?? item.path, name: item.name, path: item.path }))}
        recentVaults={vault.recent}
        query={vaultQuery}
        vaultAccess={runtime.vaultAccess}
        canSelectDirectory={Boolean(runtime.selectVaultDirectory)}
        onClose={() => vault.setManagerOpen(false)}
        onQueryChange={setVaultQuery}
        onOpenVault={(item) => void vault.openVault(item)}
        onForgetVault={(vaultId) => void vault.forgetVault(vaultId)}
        onChooseVault={(mode) => void vault.chooseVault(mode)}
      />
      <PdfExportDialog
        document={pdfDocument}
        documents={Object.values(vault.documents).map((document) => ({
          title: document.path.split("/").pop()?.replace(/\.md$/i, "") ?? document.path,
          path: document.path,
          content: document.content,
          contentHash: document.contentHash,
        }))}
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        onExport={runtime.exportPdf}
      />
    </ThemeProvider>
  );
}
