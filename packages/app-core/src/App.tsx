import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { AnimatePresence, LazyMotion, LayoutGroup, MotionConfig, domAnimation } from "motion/react";
import * as m from "motion/react-m";
import { FluxLayout } from "@flux/shared-ui/components/flux-layout";
import type { FluxLayoutState } from "@flux/shared-ui/hooks/use-flux-layout";
import {
  FluxTab,
  FluxTabAddButton,
  FluxTabBar,
  FluxTabMenu,
  FluxStackedTab,
} from "@flux/shared-ui/components/flux-tabs";
import { ModeToggle } from "@flux/shared-ui/components/mode-toggle";
import { Button } from "@flux/shared-ui/components/ui/button";
import { FluxStatusBar } from "@flux/shared-ui/components/status-bar";
import { ThemeProvider, type Theme } from "@flux/shared-ui/components/theme-provider";
import { TooltipProvider } from "@flux/shared-ui/components/tooltip";
import { Toaster, toast } from "@flux/shared-ui/components/sonner";
import { VaultPluginHost, type PluginBundle } from "@flux/plugin-runtime";
import type { PluginCapability } from "@flux/plugin-sdk";
import { Bookmark, Settings } from "lucide-react";
import type {
  DocumentReferences,
  FileEntry,
  FluxClient,
  MarketplacePlugin,
  PluginCatalogEntry,
  RecentVault,
  ServerStatus,
  TrashEntry,
  VaultChange,
  VaultInfo,
  VaultLocation,
  VaultGraph,
  VaultPlugin,
} from "@flux/bridge-contract";
import {
  FluxEditorPane,
  FluxTabContextMenu,
  type FluxTabCommands,
} from "@flux/shared-ui/components/workspace-tab";
import {
  DEMO_DOCUMENT,
  MarkdownDocumentMenu,
  MarkdownEditor,
  MarkdownViewToggle,
  REFERENCE_DOCUMENTS,
  type DemoDocument,
} from "./markdown-editor";
import { setFrontmatterProperty } from "./frontmatter";
import { isIgnoredPath } from "./link-index";
import {
  WorkspaceLeftSidebar,
  WorkspaceRibbon,
  WorkspaceRightSidebar,
  WorkspaceSidebarHeader,
  type LeftPane,
  type RightPane,
} from "./workspace-sidebars";
import { AddBookmarkDialog } from "./add-bookmark-dialog";
import {
  DEFAULT_BOOKMARK_GROUPS,
  loadBookmarks,
  saveBookmarks,
  loadBookmarkGroups,
  saveBookmarkGroups,
  type BookmarkItem,
} from "./bookmark-store";
import { PdfExportDialog } from "./pdf-export";
import { SettingsDialog } from "./settings-dialog";
import { APP_STATE_KEY, useFluxSettings } from "./settings-store";
import { FilePreview } from "./file-preview";
import { quickCaptureInboxPath } from "./quick-capture-path";
import {
  closeOtherWorkspaceTabs,
  closeWorkspaceTabsAfter,
  findWorkspaceLeaf,
  mapWorkspaceLeaves,
  mapWorkspaceLeaf,
  moveWorkspaceTab,
  removeWorkspaceLeaf,
  workspaceEdgeLeafIds,
  workspaceHasTab,
  workspaceLeaves,
  WorkspaceTree,
  type WorkspaceLeafView,
  type WorkspaceNode,
} from "./workspace-tree";
import {
  createBrowserWorkspaceTab,
  createGraphWorkspaceTab,
  createWorkspaceTab,
  type WorkspaceTab,
} from "./workspace-tabs";
import { BrowserView } from "./browser-view";
import {
  browserStatePersistence,
  useAppStore,
  type FluxStatePersistence,
  type IndexingProgress,
  type PersistedWorkspaceSession,
  type PersistedWorkspaceTab,
  type VaultLifecycleState,
} from "./app-state";

export interface FluxRuntime {
  label: string;
  connect: () => Promise<string>;
  client: FluxClient | null;
  selectVaultDirectory?: (mode: "open" | "create") => Promise<string | null>;
  getPerformanceStats?: () => Promise<FluxPerformanceStats | null>;
  openWindow?: (url: string) => Promise<void>;
  openPublicationPreview?: (sitePath: string) => Promise<void>;
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

const DOCUMENT_LIBRARY = [DEMO_DOCUMENT, ...REFERENCE_DOCUMENTS];
const EMPTY_BOOKMARKS: BookmarkItem[] = [];
const bootstrapStatus = new WeakMap<FluxClient, Promise<ServerStatus>>();

function getBootstrapStatus(client: FluxClient) {
  let pending = bootstrapStatus.get(client);
  if (!pending) {
    pending = client.getStatus().catch((error: unknown) => {
      bootstrapStatus.delete(client);
      throw error;
    });
    bootstrapStatus.set(client, pending);
  }
  return pending;
}

interface IndexedVaultInfo extends VaultInfo {
  indexing?: IndexingProgress;
}

interface PendingDocumentSave {
  vaultId: string;
  tabId: number;
  document: DemoDocument;
  content: string;
}

function lifecycleFromVault(info: VaultInfo): VaultLifecycleState {
  const state = info.state as string;
  if (
    state === "initializing" ||
    state === "read_only_ready" ||
    state === "writable" ||
    state === "indexing" ||
    state === "active" ||
    state === "degraded"
  ) {
    return state;
  }
  return state === "ready" ? "active" : "degraded";
}

function sandboxedPluginDocument(html: string) {
  const policy =
    `<meta http-equiv="Content-Security-Policy" content="` +
    `default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; ` +
    `img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:">`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index !== undefined) {
    const insertAt = head.index + head[0].length;
    return `${html.slice(0, insertAt)}${policy}${html.slice(insertAt)}`;
  }
  const root = /<html(?:\s[^>]*)?>/i.exec(html);
  if (root?.index !== undefined) {
    const insertAt = root.index + root[0].length;
    return `${html.slice(0, insertAt)}<head>${policy}</head>${html.slice(insertAt)}`;
  }
  return `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`;
}

type PluginViewLocation = "modal" | "left-sidebar" | "right-sidebar" | "workspace";

interface OpenPluginView {
  pluginId: string;
  viewId: string;
  title: string;
  html: string;
}

function PluginSurface({
  view,
  revision,
  onClose,
  invokeCapability,
  showHeader = true,
}: {
  view: OpenPluginView;
  revision: number;
  onClose: () => void;
  invokeCapability: (pluginId: string, capability: PluginCapability, input: unknown) => Promise<unknown>;
  showHeader?: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const postTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      {
        kind: "flux-plugin-theme",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      },
      "*"
    );
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as {
        type?: string;
        kind?: string;
        id?: number;
        capability?: PluginCapability;
        input?: unknown;
      };
      if (message.type === "close_plugin_view") {
        onClose();
        return;
      }
      if (
        message.kind !== "flux-plugin-capability" ||
        typeof message.id !== "number" ||
        typeof message.capability !== "string"
      )
        return;
      void invokeCapability(view.pluginId, message.capability, message.input).then(
        (value) =>
          frameRef.current?.contentWindow?.postMessage(
            { kind: "flux-plugin-capability-result", id: message.id, value },
            "*"
          ),
        (error) =>
          frameRef.current?.contentWindow?.postMessage(
            {
              kind: "flux-plugin-capability-result",
              id: message.id,
              error: error instanceof Error ? error.message : String(error),
            },
            "*"
          )
      );
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [invokeCapability, onClose, view.pluginId]);
  useEffect(() => {
    const observer = new MutationObserver(postTheme);
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [postTheme]);
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      {showHeader ? <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3 [border-color:var(--layout-separator)]">
        <h2 className="truncate text-xs font-semibold">{view.title}</h2>
        <button
          type="button"
          aria-label={`Close ${view.title}`}
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          Close
        </button>
      </header> : null}
      <iframe
        ref={frameRef}
        key={`${view.pluginId}:${view.viewId}:${revision}`}
        title={view.title}
        sandbox="allow-scripts"
        srcDoc={sandboxedPluginDocument(view.html)}
        onLoad={postTheme}
        className="min-h-0 w-full flex-1 border-0 bg-sidebar"
      />
    </section>
  );
}

const bookmarkItemsKey = (vaultId?: string) => `flux-bookmarks-items:${vaultId ?? "default"}`;
const bookmarkGroupsKey = (vaultId?: string) => `flux-bookmarks-groups:${vaultId ?? "default"}`;

function restoreWorkspaceRoot(
  node: WorkspaceNode | undefined,
  tabIds: Set<number>
): WorkspaceNode | null {
  if (!node) return null;
  if (node.kind === "leaf") {
    const kept = node.tabIds.filter((id) => tabIds.has(id));
    if (!kept.length) return null;
    return {
      ...node,
      view: node.view === "pdf" ? "editor" : node.view,
      tabIds: kept,
      activeTabId: kept.includes(node.activeTabId) ? node.activeTabId : kept[0],
    };
  }
  const first = restoreWorkspaceRoot(node.children[0], tabIds);
  const second = restoreWorkspaceRoot(node.children[1], tabIds);
  if (!first) return second;
  if (!second) return first;
  return { ...node, children: [first, second] };
}

function maxWorkspaceNodeId(node: WorkspaceNode): number {
  return node.kind === "leaf"
    ? node.id
    : Math.max(node.id, maxWorkspaceNodeId(node.children[0]), maxWorkspaceNodeId(node.children[1]));
}

type InitializationPhase = "starting" | "vault" | "cache" | "workspace";

const INITIALIZATION_PHASES: Array<{ id: InitializationPhase; label: string }> = [
  { id: "starting", label: "Starting Flux" },
  { id: "vault", label: "Loading vault" },
  { id: "cache", label: "Loading cache" },
  { id: "workspace", label: "Restoring workspace" },
];

function InitializationOverlay({ phase, label }: { phase: InitializationPhase; label: string }) {
  const phaseIndex = INITIALIZATION_PHASES.findIndex((candidate) => candidate.id === phase);
  return (
    <div className="fixed inset-0 z-[190] grid place-items-center bg-background">
      <div
        role="status"
        aria-live="polite"
        className="flex w-72 flex-col items-center gap-4 text-center"
      >
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none"
        />
        <div className="w-full">
          <p className="text-sm font-medium">{INITIALIZATION_PHASES[phaseIndex].label}</p>
          <p className="mt-1 max-w-72 truncate text-xs text-muted-foreground">{label}</p>
          <div className="mt-4 grid grid-cols-4 gap-1" aria-hidden="true">
            {INITIALIZATION_PHASES.map((candidate, index) => (
              <span
                key={candidate.id}
                className={`h-0.5 rounded-full ${
                  index <= phaseIndex ? "bg-foreground/70" : "bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DegradedBanner({ onRebuild }: { onRebuild: () => void }) {
  return (
    <div
      role="status"
      className="mx-2 mt-2 flex shrink-0 items-center gap-3 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground [border-color:var(--layout-separator)]"
    >
      <span className="min-w-0 flex-1 truncate">
        Vault services degraded. Notes remain editable.
      </span>
      <Button size="xs" variant="outline" onClick={onRebuild} className="shrink-0">
        Rebuild index
      </Button>
    </div>
  );
}
const PdfViewer = lazy(() =>
  import("./pdf-viewer").then((module) => ({ default: module.PdfViewer }))
);
const GraphView = lazy(() =>
  import("./graph-view").then((module) => ({ default: module.GraphView }))
);

function documentFromLocation() {
  if (typeof window === "undefined") return DEMO_DOCUMENT;
  const title = new URLSearchParams(window.location.search).get("popout");
  return DOCUMENT_LIBRARY.find((document) => document.title === title) ?? DEMO_DOCUMENT;
}

function titleFromPath(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.(md|markdown)$/i, "");
}

function fileTitleFromPath(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.[^./]+$/, "");
}

function workspaceTabPath(tab: WorkspaceTab) {
  return tab.document?.path ?? tab.pdf?.path ?? tab.preview?.path ?? tab.deferred?.path;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await task(items[index]);
      }
    })
  );
  return results;
}

function workspaceTabView(tab: WorkspaceTab | undefined): WorkspaceLeafView {
  return tab?.kind === "graph" ? "graph" : tab?.kind === "browser" ? "browser" : "editor";
}

function EditorPathBreadcrumb({
  path,
  onReveal,
  onRename,
  onClearReveal,
}: {
  path: string;
  onReveal: (path: string, file: boolean) => void;
  onRename?: (path: string, name: string) => void;
  onClearReveal?: () => void;
}) {
  const segments = path.split("/").filter(Boolean);
  const fileName = segments.at(-1) ?? "";
  const fileLabel = fileName.replace(/\.[^./]+$/, "");
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(fileLabel);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRenameRef = useRef(false);

  useEffect(() => {
    if (!isFocused) return;
    inputRef.current?.focus();
  }, [isFocused]);

  const commitRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    setIsFocused(false);
    const next = draft.trim();
    if (next && next !== fileLabel) onRename?.(path, next);
    else setDraft(fileLabel);
  };

  return (
    <m.nav
      layout
      aria-label="File path"
      title={path}
      className="mx-auto flex min-w-0 max-w-full items-center justify-center overflow-hidden h-8"
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
    >
      <LayoutGroup id="breadcrumb-nav-group">
        {segments.map((segment, index) => {
          const currentPath = segments.slice(0, index + 1).join("/");
          const file = index === segments.length - 1;
          return (
            <m.span
              layout
              key={currentPath}
              className="flex min-w-0 items-center"
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            >
              {!file ? (
                <AnimatePresence initial={false}>
                  {!isFocused && (
                    <m.span
                      layout
                      initial={{ opacity: 0, width: 0, scale: 0.8 }}
                      animate={{ opacity: 1, width: "auto", scale: 1 }}
                      exit={{ opacity: 0, width: 0, scale: 0.8 }}
                      transition={{ type: "spring", stiffness: 150, damping: 22 }}
                      className="flex items-center min-w-0 overflow-hidden"
                    >
                      {index ? (
                        <span className="select-none text-muted-foreground/35 mx-[3px] font-normal text-xs">
                          /
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Reveal ${segment}`}
                        onClick={() => onReveal(currentPath, false)}
                        className="min-w-0 truncate rounded-sm px-[3px] py-0.5 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring text-muted-foreground"
                      >
                        {segment}
                      </button>
                    </m.span>
                  )}
                </AnimatePresence>
              ) : (
                <m.span
                  layout
                  className="flex items-center min-w-0"
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                >
                  {index && !isFocused ? (
                    <m.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      className="select-none text-muted-foreground/35 mx-[3px] font-normal text-xs"
                    >
                      /
                    </m.span>
                  ) : null}
                  {isFocused ? (
                    <m.input
                      layout
                      ref={inputRef}
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          cancelRenameRef.current = true;
                          setDraft(fileLabel);
                          setIsFocused(false);
                        }
                      }}
                      className="min-w-24 max-w-64 bg-transparent border-none text-center font-medium text-foreground outline-none focus:outline-none focus:ring-0 px-[3px] py-0.5"
                      style={{ font: "inherit" }}
                    />
                  ) : (
                    <m.button
                      layout
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsFocused(true);
                        onClearReveal?.();
                      }}
                      className="min-w-0 truncate rounded-sm px-[3px] py-0.5 outline-none font-medium text-foreground cursor-pointer"
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    >
                      {fileLabel}
                    </m.button>
                  )}
                </m.span>
              )}
            </m.span>
          );
        })}
      </LayoutGroup>
    </m.nav>
  );
}

function mimeTypeForPath(path: string) {
  const extension = path.toLocaleLowerCase().split(".").pop() ?? "";
  const types: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    "3gp": "audio/3gpp",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
    mkv: "video/x-matroska",
  };
  return types[extension] ?? "application/octet-stream";
}

function decodedText(data: ArrayBuffer) {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (content.includes("\0")) return null;
    const sample = content.slice(0, 8_192);
    const readable = [...sample].filter(
      (character) =>
        character === "\n" || character === "\r" || character === "\t" || character >= " "
    ).length;
    return sample.length === 0 || readable / sample.length > 0.9 ? content : null;
  } catch {
    return null;
  }
}

function markdownPath(parent: string, title: string) {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-") || "Untitled";
  return parent ? `${parent}/${safeTitle}.md` : `${safeTitle}.md`;
}

function movedDocumentPath(candidate: string, source: string, destination: string) {
  if (candidate === source) return destination;
  return candidate.startsWith(`${source}/`)
    ? destination + candidate.slice(source.length)
    : candidate;
}

function singleTextEdit(before: string, after: string) {
  const oldRunes = Array.from(before);
  const newRunes = Array.from(after);
  let prefix = 0;
  while (
    prefix < oldRunes.length &&
    prefix < newRunes.length &&
    oldRunes[prefix] === newRunes[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldRunes.length - prefix &&
    suffix < newRunes.length - prefix &&
    oldRunes[oldRunes.length - 1 - suffix] === newRunes[newRunes.length - 1 - suffix]
  )
    suffix++;
  const encoder = new TextEncoder();
  return {
    startByte: encoder.encode(oldRunes.slice(0, prefix).join("")).length,
    endByte: encoder.encode(oldRunes.slice(0, oldRunes.length - suffix).join("")).length,
    text: newRunes.slice(prefix, newRunes.length - suffix).join(""),
  };
}

interface AsyncFeedback {
  loading: string;
  success: string;
  error: string;
  id?: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function isoWeekKey(date: Date) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function calendarGrid(selected: string) {
  const date = dateFromKey(selected);
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

interface DailyNoteConfig {
  dailyFolder: string;
  weeklyFolder: string;
  inboxPath: string;
  dailyFormat: string;
  weeklyFormat: string;
  dailyTemplate?: string;
  weeklyTemplate?: string;
  timeZone: string;
}

const defaultDailyNoteConfig: DailyNoteConfig = {
  dailyFolder: "Daily",
  weeklyFolder: "Daily/Weekly",
  inboxPath: "Inbox",
  dailyFormat: "YYYY-MM-DD",
  weeklyFormat: "GGGG-[W]WW",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function safeVaultPath(value: unknown, fallback: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.split("/").includes("..")
  ) {
    return fallback;
  }
  return value.replace(/\/+$/, "");
}

async function loadDailyNoteConfig(client: FluxClient, vaultId: string) {
  const value = await client.getVaultConfig(vaultId);
  const timeZone =
    typeof value.timeZone === "string" ? value.timeZone : defaultDailyNoteConfig.timeZone;
  new Intl.DateTimeFormat(undefined, { timeZone }).format();
  return {
    dailyFolder: safeVaultPath(value.dailyFolder, defaultDailyNoteConfig.dailyFolder),
    weeklyFolder: safeVaultPath(value.weeklyFolder, defaultDailyNoteConfig.weeklyFolder),
    inboxPath: safeVaultPath(value.inboxPath, defaultDailyNoteConfig.inboxPath),
    dailyFormat:
      typeof value.dailyFormat === "string" && value.dailyFormat
        ? value.dailyFormat
        : defaultDailyNoteConfig.dailyFormat,
    weeklyFormat:
      typeof value.weeklyFormat === "string" && value.weeklyFormat
        ? value.weeklyFormat
        : defaultDailyNoteConfig.weeklyFormat,
    dailyTemplate:
      typeof value.dailyTemplate === "string" ? safeVaultPath(value.dailyTemplate, "") : undefined,
    weeklyTemplate:
      typeof value.weeklyTemplate === "string"
        ? safeVaultPath(value.weeklyTemplate, "")
        : undefined,
    timeZone,
  } satisfies DailyNoteConfig;
}

function noteFileName(dateKey: string, format: string, weekly = false) {
  const date = dateFromKey(dateKey);
  const week = isoWeekKey(date);
  const [weekYear, weekNumber] = week.split("-W");
  const value = format
    .replaceAll("[W]", "W")
    .replaceAll("GGGG", weekYear)
    .replaceAll("WW", weekNumber)
    .replaceAll("YYYY", String(date.getFullYear()))
    .replaceAll("MM", String(date.getMonth() + 1).padStart(2, "0"))
    .replaceAll("DD", String(date.getDate()).padStart(2, "0"));
  const stem = value.replace(/\.md$/i, "");
  return `${stem || (weekly ? week : dateKey)}.md`;
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function noteTemplate(
  client: FluxClient,
  vaultId: string,
  path: string | undefined,
  fallback: string,
  replacements: Record<string, string>
) {
  if (!path) return fallback;
  if (!(await client.getFileMetadata(vaultId, path))) {
    throw new Error(`Configured template not found: ${path}`);
  }
  let content = (await client.readFile(vaultId, path)).content;
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}

function runWithToast<T>(operation: Promise<T>, feedback: AsyncFeedback) {
  return toast
    .promise(operation, {
      id: feedback.id,
      loading: feedback.loading,
      success: feedback.success,
      error: (error) => ({ message: feedback.error, description: errorMessage(error) }),
    })
    .unwrap();
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

function QuickCapture({ runtime }: { runtime: FluxRuntime }) {
  const [vaults, setVaults] = useState<RecentVault[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [target, setTarget] = useState<"inbox" | "daily">("inbox");
  const [fileName, setFileName] = useState("Quick note.md");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const vaultSelectRef = useRef<HTMLSelectElement>(null);
  const fileNameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.title = "Quick Capture";
    void runtime.connect().then(async () => {
      if (!runtime.client) return;
      const [recent, settings] = await Promise.all([
        runtime.client.listRecentVaults(),
        runtime.client.getAppSettings(),
      ]);
      if (settings.theme === "dark" || settings.theme === "light" || settings.theme === "system") {
        useAppStore.getState().setSetting("theme", settings.theme);
      }
      useAppStore.getState().hydrate(settings);
      setVaults(recent);
      const configured = String(settings.quickCaptureVaultId ?? "");
      const draft =
        settings.quickCaptureDraft && typeof settings.quickCaptureDraft === "object"
          ? (settings.quickCaptureDraft as Record<string, unknown>)
          : undefined;
      const draftVaultId = typeof draft?.vaultId === "string" ? draft.vaultId : "";
      setVaultId(
        recent.some((item) => item.vaultId === draftVaultId)
          ? draftVaultId
          : recent.some((item) => item.vaultId === configured)
            ? configured
            : ""
      );
      if (typeof draft?.content === "string") setContent(draft.content);
      if (typeof draft?.fileName === "string") setFileName(draft.fileName);
      if (draft?.target === "inbox" || draft?.target === "daily") setTarget(draft.target);
    }).catch((cause) => setError(errorMessage(cause)));
  }, [runtime]);

  useEffect(() => {
    if (!runtime.client || !content.trim()) return;
    const timer = window.setTimeout(() => {
      void runtime.client?.putAppSetting("quickCaptureDraft", {
        vaultId,
        target,
        fileName,
        content,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [runtime.client, vaultId, target, fileName, content]);

  const save = async () => {
    if (!runtime.client) {
      setError("Unable to connect to FLUX. Try again.");
      return;
    }
    if (!vaultId) {
      setError("Choose a vault.");
      vaultSelectRef.current?.focus();
      return;
    }
    if (!content.trim()) {
      setError("Write something to capture.");
      contentRef.current?.focus();
      return;
    }
    const inboxFilePath = target === "inbox" ? quickCaptureInboxPath("", fileName) : null;
    if (target === "inbox" && !inboxFilePath) {
      setError("Enter a filename without folders.");
      fileNameRef.current?.focus();
      return;
    }
    const selected = vaults.find((item) => item.vaultId === vaultId);
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const vault = await runtime.client.openVault({ path: selected.path });
      const config = await loadDailyNoteConfig(runtime.client, vault.id);
      const date = dateKeyInTimeZone(new Date(), config.timeZone);
      const path =
        target === "inbox"
          ? quickCaptureInboxPath(config.inboxPath, fileName)!
          : `${config.dailyFolder}/${noteFileName(date, config.dailyFormat)}`;
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent) await runtime.client.createDirectory(vault.id, parent);
      const addition = `\n\n${content.trim()}\n`;
      const initial =
        target === "daily"
          ? await noteTemplate(runtime.client, vault.id, config.dailyTemplate, `# ${date}\n`, {
              date,
            })
          : "";
      let saved = false;
      for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
        const existing = await runtime.client.getFileMetadata(vault.id, path);
        if (!existing) {
          try {
            await runtime.client.createFile({
              vaultId: vault.id,
              path,
              content: initial ? initial.replace(/\s*$/, "") + addition : content.trim() + "\n",
            });
            saved = true;
          } catch {
            // Another writer may have created it; reread and append.
          }
          continue;
        }
        const document = await runtime.client.readFile(vault.id, path);
        try {
          await runtime.client.saveFile({
            vaultId: vault.id,
            path,
            content: document.content.replace(/\s*$/, "") + addition,
            expectedHash: document.contentHash,
          });
          saved = true;
        } catch {
          // Conflict: bounded reread and retry.
        }
      }
      if (!saved) throw new Error("File changed repeatedly. Capture remains available.");
      await runtime.client.putAppSetting("quickCaptureVaultId", vaultId);
      await runtime.client.putAppSetting("quickCaptureDraft", null);
      setContent("");
      await runtime.hideWindow?.();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex h-screen flex-col bg-sidebar text-foreground">
      <header className="flex h-11 shrink-0 items-center border-b ps-[76px] pe-4 [border-color:var(--layout-separator)] [-webkit-app-region:drag]">
        <h1 className="text-sm font-medium tracking-[-0.01em]">Quick capture</h1>
        <span className="ms-auto text-[11px] text-foreground/70">⌘↵ to save</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2.5">
          <label className="grid min-w-0 gap-1 text-[11px] font-medium text-foreground/70">
            Vault
            <select
              ref={vaultSelectRef}
              value={vaultId}
              aria-invalid={Boolean(error && !vaultId)}
              aria-describedby={error ? "quick-capture-error" : undefined}
              onChange={(event) => {
                setVaultId(event.target.value);
                setError("");
              }}
              className="h-8 min-w-0 rounded-md border bg-popover px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
            >
              <option value="">Choose vault…</option>
              {vaults.map((item) => (
                <option key={item.vaultId} value={item.vaultId}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[11px] font-medium text-foreground/70">
            Save to
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value as "inbox" | "daily")}
              className="h-8 rounded-md border bg-popover px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
            >
              <option value="inbox">Inbox</option>
              <option value="daily">Today</option>
            </select>
          </label>
        </div>

        {target === "inbox" ? (
          <label className="grid gap-1 text-[11px] font-medium text-foreground/70">
            Filename
            <input
              ref={fileNameRef}
              value={fileName}
              aria-invalid={Boolean(error && !quickCaptureInboxPath("", fileName))}
              aria-describedby={error ? "quick-capture-error" : undefined}
              onChange={(event) => {
                setFileName(event.target.value);
                setError("");
              }}
              placeholder="Quick note.md"
              className="h-8 rounded-md border bg-popover px-2 text-xs font-normal text-foreground outline-none placeholder:text-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
            />
          </label>
        ) : null}

        <label className="flex min-h-0 flex-1 flex-col gap-1 text-[11px] font-medium text-foreground/70">
          Note
          <textarea
            ref={contentRef}
            autoFocus
            value={content}
            aria-invalid={Boolean(error && !content.trim())}
            aria-describedby={error ? "quick-capture-error" : undefined}
            onChange={(event) => {
              setContent(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void save();
            }}
            placeholder="Write a note…"
            className="min-h-0 flex-1 resize-none rounded-lg border bg-background p-3 text-sm font-normal leading-6 text-foreground outline-none placeholder:text-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar [border-color:var(--layout-separator)]"
          />
        </label>

        <div className="flex min-h-8 items-center justify-between gap-3">
          <p id="quick-capture-error" role="status" className="min-w-0 text-xs leading-4 text-destructive">
            {error}
          </p>
          <Button
            size="sm"
            loading={saving}
            onClick={() => void save()}
            className="shadow-none before:shadow-none"
          >
            Save note
          </Button>
        </div>
      </div>
    </main>
  );
}

function FluxAppContent({ runtime, windowControlsInset }: FluxAppProps) {
  const { settings } = useFluxSettings();
  const { plugins, general } = settings;
  const lifecycle = useAppStore((state) => state.lifecycle);
  const indexing = useAppStore((state) => state.indexing);
  const hydrateAppState = useAppStore((state) => state.hydrate);
  const setAppVault = useAppStore((state) => state.setVault);
  const setLifecycle = useAppStore((state) => state.setLifecycle);
  const setStoredWorkspace = useAppStore((state) => state.setWorkspace);
  const statePersistence = runtime.statePersistence ?? browserStatePersistence;
  const [status, setStatus] = useState("Connecting…");
  const [initializationPhase, setInitializationPhase] = useState<InitializationPhase>("starting");
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [performanceStats, setPerformanceStats] = useState<FluxPerformanceStats | null>(null);

  useEffect(() => {
    if (!settingsHydrated) return;
    void statePersistence.saveAppSetting(APP_STATE_KEY, settings).catch(() => undefined);
  }, [settings, settingsHydrated, statePersistence]);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    createWorkspaceTab(1, documentFromLocation()),
  ]);
  const [activeTabId, setActiveTabId] = useState(1);

  const navHistoryRef = useRef<number[]>([]);
  const navHistoryIndexRef = useRef<number>(-1);
  const [navHistoryTick, setNavHistoryTick] = useState(0);
  const isNavigatingHistory = useRef(false);
  const lastActiveTabIdRef = useRef<number>(-1);

  const pushHistory = useCallback((tabId: number) => {
    const history = navHistoryRef.current;
    const index = navHistoryIndexRef.current;
    if (history[index] === tabId) return;
    const newHistory = history.slice(0, index + 1);
    newHistory.push(tabId);
    navHistoryRef.current = newHistory;
    navHistoryIndexRef.current = newHistory.length - 1;
    setNavHistoryTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (activeTabId === lastActiveTabIdRef.current) return;
    lastActiveTabIdRef.current = activeTabId;
    if (isNavigatingHistory.current) {
      isNavigatingHistory.current = false;
      return;
    }
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (!tab.document && !tab.pdf && !tab.preview && !tab.deferred && !tab.kind) return;
    pushHistory(activeTabId);
  }, [activeTabId, tabs, pushHistory]);

  const [activeVaultId, setActiveVaultId] = useState("");
  const [sessionVaultId, setSessionVaultId] = useState("");
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [vaultGraph, setVaultGraph] = useState<VaultGraph | null>(null);
  const [vaultDocuments, setVaultDocuments] = useState<DemoDocument[]>([]);
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalogEntry[]>([]);
  const [marketplacePlugins, setMarketplacePlugins] = useState<MarketplacePlugin[]>([]);
  const [marketplaceError, setMarketplaceError] = useState("");
  const [pluginSection, setPluginSection] = useState<"marketplace" | "installed">("marketplace");
  const [pluginSettings, setPluginSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [vaultPlugins, setVaultPlugins] = useState<VaultPlugin[]>([]);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [pluginRuntimeRevision, setPluginRuntimeRevision] = useState(0);
  const [pluginView, setPluginView] = useState<OpenPluginView>();
  const [pluginQuery, setPluginQuery] = useState("");
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const [availableVaults, setAvailableVaults] = useState<VaultLocation[]>([]);
  const [vaultQuery, setVaultQuery] = useState("");
  const [renameRequest, setRenameRequest] = useState<{ path: string; value: string }>();
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [trashQuery, setTrashQuery] = useState("");
  const [permanentDeleteRequest, setPermanentDeleteRequest] = useState<TrashEntry>();
  const [emptyTrashRequest, setEmptyTrashRequest] = useState(false);
  const [pdfExportDocument, setPdfExportDocument] = useState<DemoDocument | null>(null);
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState(localDateKey);
  const [dailyNoteConfig, setDailyNoteConfig] = useState(defaultDailyNoteConfig);
  const calendarDays = useMemo(() => calendarGrid(calendarDate), [calendarDate]);
  const calendarMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
        dateFromKey(calendarDate)
      ),
    [calendarDate]
  );
  useEffect(() => {
    if (!calendarOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [calendarOpen]);
  useEffect(() => {
    let active = true;
    if (!vault || !runtime.client) return;
    void loadDailyNoteConfig(runtime.client, vault.id)
      .then((config) => {
        if (active) {
          setDailyNoteConfig(config);
          setCalendarDate(dateKeyInTimeZone(new Date(), config.timeZone));
        }
      })
      .catch((cause) => {
        if (active) setStatus(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [runtime.client, vault]);
  const [sidebarRevealPath, setSidebarRevealPath] = useState<string | undefined>();
  const [sidebarSelectedPath, setSidebarSelectedPath] = useState<string | undefined>();
  const revealPathTimerRef = useRef<number | undefined>(undefined);
  const appSettings = useAppStore((state) => state.settings);
  const bookmarkVaultId = vault?.id ?? "default";
  const bookmarks =
    useAppStore((state) => state.bookmarksByVault[bookmarkVaultId]) ?? EMPTY_BOOKMARKS;
  const bookmarkGroups =
    useAppStore((state) => state.bookmarkGroupsByVault[bookmarkVaultId]) ?? DEFAULT_BOOKMARK_GROUPS;
  const setStoredBookmarks = useAppStore((state) => state.setBookmarks);
  const setStoredBookmarkGroups = useAppStore((state) => state.setBookmarkGroups);
  const [addBookmarkDialogOpen, setAddBookmarkDialogOpen] = useState(false);
  const [bookmarkTarget, setBookmarkTarget] = useState<{ title: string; path?: string } | null>(
    null
  );
  const [leftSidebarPane, setLeftSidebarPane] = useState<LeftPane>("files");
  const [rightSidebarPane, setRightSidebarPane] = useState<RightPane>("backlinks");
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [sidebarIndexRevision, setSidebarIndexRevision] = useState(0);
  const [headingReveal, setHeadingReveal] = useState<{
    path: string;
    heading: string;
    line: number;
    request: number;
    absolute?: boolean;
  }>();
  const effectiveLeftSidebarPane: LeftPane =
    plugins[leftSidebarPane === "files" ? "file-explorer" : leftSidebarPane] !== false
      ? leftSidebarPane
      : plugins["file-explorer"] !== false
        ? "files"
        : plugins.search !== false
          ? "search"
          : "bookmarks";
  const [layoutState, setLayoutState] = useState<FluxLayoutState>();
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [workspaceFileDrop, setWorkspaceFileDrop] = useState<{
    leafId: number;
    zone: "center" | "left" | "right" | "top" | "bottom";
  }>();
  const nextTabIdRef = useRef(2);
  const [workspaceRoot, setWorkspaceRoot] = useState<WorkspaceNode>({
    kind: "leaf",
    id: 1,
    view: "editor",
    tabIds: [1],
    activeTabId: 1,
  });
  const [activeLeafId, setActiveLeafId] = useState(1);
  const nextLeafIdRef = useRef(2);
  const windowIdRef = useRef("main");
  const sessionSaveTimerRef = useRef<number | undefined>(undefined);
  const sessionSaveChainRef = useRef(Promise.resolve());
  const latestSessionRef = useRef<PersistedWorkspaceSession | undefined>(undefined);
  const savedSessionSignatureRef = useRef("");
  const flushWorkspaceSessionRef = useRef<() => Promise<void>>(async () => undefined);
  const flushPendingSavesRef = useRef<(vaultId?: string) => Promise<void>>(async () => undefined);
  const savedDocumentsRef = useRef(new Map<string, DemoDocument>());
  const tabsRef = useRef(tabs);
  const fileEntriesRef = useRef<FileEntry[]>([]);
  const loadedFoldersRef = useRef(new Set<string>());
  const vaultFileVersionsRef = useRef(new Map<string, string>());
  const vaultLoadRef = useRef(0);
  const vaultOpenIntentRef = useRef(0);
  const activeVaultIdRef = useRef("");
  const graphVisibleRef = useRef(false);
  const referenceRequestsRef = useRef(new Map<string, Promise<DocumentReferences>>());
  const navigationIntentRef = useRef(0);
  const saveTimersRef = useRef(new Map<string, number>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const saveBasesRef = useRef(new Map<string, DemoDocument>());
  const pendingSavesRef = useRef(new Map<string, PendingDocumentSave>());
  const deferredTabLoadsRef = useRef(new Map<string, Promise<void>>());
  const indexingToastVaultRef = useRef<string | null>(null);
  const pluginHostRef = useRef<VaultPluginHost | null>(null);
  const lastIndexingProgressRef = useRef<IndexingProgress | null>(null);

  useEffect(() => {
    if (plugins["graph-view"] !== false) return;
    const timer = window.setTimeout(() => {
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaves(root, (leaf) =>
          leaf.view === "graph" ? { ...leaf, view: "editor" } : leaf
        )
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [plugins]);

  const activeLeaf = findWorkspaceLeaf(workspaceRoot, activeLeafId);
  const graphVisible = workspaceLeaves(workspaceRoot).some((leaf) => leaf.view === "graph");
  const visibleActiveTab = (() => {
    if (activeLeaf?.view !== "editor") return undefined;
    const leafTabs = activeLeaf.tabIds
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t) => t !== undefined);
    return leafTabs.find((tab) => tab.id === activeLeaf.activeTabId) ?? leafTabs[0];
  })();

  const activeFilePath =
    visibleActiveTab?.document?.path ??
    visibleActiveTab?.pdf?.path ??
    visibleActiveTab?.preview?.path;

  const documents = useMemo(() => {
    const library = vault ? vaultDocuments : DOCUMENT_LIBRARY;
    const byPath = new Map(library.map((document) => [document.path ?? document.title, document]));
    for (const tab of tabs)
      if (tab.document) byPath.set(tab.document.path ?? tab.document.title, tab.document);

    // Include all non-ignored markdown files as stubs for autocomplete and linking
    if (vault) {
      for (const entry of fileEntries) {
        if (
          (entry.kind === "markdown" || entry.kind === "text") &&
          !isIgnoredPath(entry.path) &&
          !byPath.has(entry.path)
        ) {
          byPath.set(entry.path, {
            path: entry.path,
            title: titleFromPath(entry.path),
            content: "",
            contentHash: "",
          });
        }
      }
    }

    return [...byPath.values()];
  }, [tabs, vault, vaultDocuments, fileEntries]);
  const selectableVaults = useMemo(() => {
    const byPath = new Map<string, { key: string; name: string; path: string }>();
    for (const location of availableVaults) {
      byPath.set(location.path, {
        key: location.vaultId || location.path,
        name: location.name,
        path: location.path,
      });
    }
    for (const recent of recentVaults) {
      if (!byPath.has(recent.path)) {
        byPath.set(recent.path, {
          key: recent.vaultId,
          name: recent.displayName,
          path: recent.path,
        });
      }
    }
    return [...byPath.values()];
  }, [availableVaults, recentVaults]);
  const filteredSelectableVaults = useMemo(() => {
    const query = vaultQuery.trim().toLocaleLowerCase();
    return query
      ? selectableVaults.filter(({ name, path }) =>
          `${name}\n${path}`.toLocaleLowerCase().includes(query)
        )
      : selectableVaults;
  }, [selectableVaults, vaultQuery]);
  const filteredMarketplacePlugins = useMemo(() => {
    const query = pluginQuery.trim().toLocaleLowerCase();
    return query
      ? marketplacePlugins.filter((plugin) =>
          `${plugin.manifest.name}\n${plugin.manifest.description}\n${plugin.publisher}`
            .toLocaleLowerCase()
            .includes(query)
        )
      : marketplacePlugins;
  }, [marketplacePlugins, pluginQuery]);
  const filteredPluginCatalog = useMemo(() => {
    const query = pluginQuery.trim().toLocaleLowerCase();
    return query
      ? pluginCatalog.filter((entry) =>
          `${entry.manifest.name}\n${entry.manifest.description}\n${entry.manifest.id}`
            .toLocaleLowerCase()
            .includes(query)
        )
      : pluginCatalog;
  }, [pluginCatalog, pluginQuery]);
  const filteredTrashEntries = useMemo(() => {
    const query = trashQuery.trim().toLocaleLowerCase();
    return query
      ? trashEntries.filter((entry) => entry.originalPath.toLocaleLowerCase().includes(query))
      : trashEntries;
  }, [trashEntries, trashQuery]);
  const leftEdgeLeafIds = useMemo(
    () => new Set(workspaceEdgeLeafIds(workspaceRoot, "left")),
    [workspaceRoot]
  );
  const rightEdgeLeafIds = useMemo(
    () => new Set(workspaceEdgeLeafIds(workspaceRoot, "right")),
    [workspaceRoot]
  );
  const searchVaultIndex = useCallback(
    (query: string, offset = 0, matchCase = false) => {
      void sidebarIndexRevision;
      if (!runtime.client || !vault) return Promise.resolve([]);
      return runtime.client.searchVault(vault.id, query, 100, offset, matchCase);
    },
    [runtime.client, sidebarIndexRevision, vault]
  );
  const loadDocumentReferences = useCallback(
    (path: string, includeUnlinked = false) => {
      void sidebarIndexRevision;
      if (!runtime.client || !vault) {
        return Promise.resolve({ linked: [], unlinked: [], outgoing: [] });
      }
      const key = `${vault.id}:${sidebarIndexRevision}:${path}:${includeUnlinked}`;
      const cached = referenceRequestsRef.current.get(key);
      if (cached) return cached;
      if (referenceRequestsRef.current.size >= 32) referenceRequestsRef.current.clear();
      const request = runtime.client
        .getDocumentReferences(vault.id, path, includeUnlinked)
        .catch((error) => {
          referenceRequestsRef.current.delete(key);
          throw error;
        });
      referenceRequestsRef.current.set(key, request);
      return request;
    },
    [runtime.client, sidebarIndexRevision, vault]
  );
  const loadVaultFacets = useCallback(() => {
    void sidebarIndexRevision;
    if (!runtime.client || !vault) return Promise.resolve({ tags: [], properties: [] });
    return runtime.client.getVaultFacets(vault.id);
  }, [runtime.client, sidebarIndexRevision, vault]);

  useEffect(() => {
    const itemsKey = bookmarkItemsKey(vault?.id);
    const groupsKey = bookmarkGroupsKey(vault?.id);
    const remoteItems = appSettings[itemsKey];
    const remoteGroups = appSettings[groupsKey];

    if (runtime.statePersistence && Array.isArray(remoteItems)) {
      setStoredBookmarks(bookmarkVaultId, remoteItems as BookmarkItem[]);
    } else {
      setStoredBookmarks(bookmarkVaultId, loadBookmarks(vault?.id));
    }

    if (runtime.statePersistence && Array.isArray(remoteGroups)) {
      setStoredBookmarkGroups(bookmarkVaultId, remoteGroups as string[]);
    } else {
      setStoredBookmarkGroups(bookmarkVaultId, loadBookmarkGroups(vault?.id));
    }
  }, [
    appSettings,
    bookmarkVaultId,
    runtime.statePersistence,
    setStoredBookmarkGroups,
    setStoredBookmarks,
    vault?.id,
  ]);

  const updateBookmarks = (updater: (current: BookmarkItem[]) => BookmarkItem[]) => {
    const current = useAppStore.getState().bookmarksByVault[bookmarkVaultId] ?? EMPTY_BOOKMARKS;
    const next = updater(current);
    setStoredBookmarks(bookmarkVaultId, next);
    if (runtime.statePersistence) {
      void runtime.statePersistence
        .saveAppSetting(bookmarkItemsKey(vault?.id), next)
        .catch(() => undefined);
    } else {
      saveBookmarks(next, vault?.id);
    }
  };

  const updateBookmarkGroups = (updater: (current: string[]) => string[]) => {
    const current =
      useAppStore.getState().bookmarkGroupsByVault[bookmarkVaultId] ?? DEFAULT_BOOKMARK_GROUPS;
    const next = updater(current);
    setStoredBookmarkGroups(bookmarkVaultId, next);
    if (runtime.statePersistence) {
      void runtime.statePersistence
        .saveAppSetting(bookmarkGroupsKey(vault?.id), next)
        .catch(() => undefined);
    } else {
      saveBookmarkGroups(next, vault?.id);
    }
  };

  const handleOpenAddBookmark = (target?: { title: string; path?: string } | null) => {
    const defaultTarget =
      target ||
      (visibleActiveTab
        ? {
            title: visibleActiveTab.title,
            path: visibleActiveTab.document?.path || visibleActiveTab.pdf?.path,
          }
        : null);
    if (!defaultTarget) return;
    setBookmarkTarget(defaultTarget);
    setAddBookmarkDialogOpen(true);
  };

  const handleSaveBookmark = (data: {
    id?: string;
    title: string;
    path: string;
    group?: string | null;
  }) => {
    if (data.id) {
      updateBookmarks((prev) =>
        prev.map((item) =>
          item.id === data.id ? { ...item, title: data.title, group: data.group } : item
        )
      );
      setStatus(`Updated bookmark ${data.title}`);
    } else {
      const newItem: BookmarkItem = {
        id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: data.title,
        path: data.path,
        group: data.group,
        createdAt: Date.now(),
      };
      updateBookmarks((prev) => [...prev, newItem]);
      setStatus(`Bookmarked ${data.title}`);
    }
  };

  const handleRemoveBookmark = (id: string) => {
    updateBookmarks((prev) => prev.filter((item) => item.id !== id));
  };

  const handleCreateBookmarkGroup = (name: string) => {
    if (name && !bookmarkGroups.includes(name)) {
      updateBookmarkGroups((prev) => [...prev, name]);
    }
  };

  const isTabBookmarked = (tab: WorkspaceTab) => {
    const targetPath = tab.document?.path || tab.pdf?.path || tab.title;
    return bookmarks.some(
      (b) =>
        b.path.toLowerCase() === targetPath.toLowerCase() ||
        b.title.toLowerCase() === tab.title.toLowerCase()
    );
  };

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    graphVisibleRef.current = graphVisible;
  }, [graphVisible]);

  useEffect(() => {
    const toastId = "vault-indexing-progress";
    if (!vault) {
      if (indexingToastVaultRef.current) toast.dismiss(toastId);
      indexingToastVaultRef.current = null;
      lastIndexingProgressRef.current = null;
      return;
    }
    if (indexingToastVaultRef.current && indexingToastVaultRef.current !== vault.id) {
      toast.dismiss(toastId);
      indexingToastVaultRef.current = null;
      lastIndexingProgressRef.current = null;
    }
    if (lifecycle === "indexing" && indexing) {
      const total = Math.max(0, indexing.total);
      const processed = total
        ? Math.min(Math.max(0, indexing.processed), total)
        : Math.max(0, indexing.processed);
      const percent = total ? Math.round((processed / total) * 100) : 0;
      const progress = total
        ? `${processed.toLocaleString()} / ${total.toLocaleString()} files · ${percent}%`
        : "Scanning files…";
      const failures = indexing.failed ? ` · ${indexing.failed} failed` : "";
      indexingToastVaultRef.current = vault.id;
      lastIndexingProgressRef.current = indexing;
      toast.loading(`Indexing ${vault.name}`, {
        id: toastId,
        description: `${progress}${failures} · Search and backlinks may be incomplete.`,
        duration: Infinity,
      });
      return;
    }
    if (indexingToastVaultRef.current !== vault.id) return;
    const finalProgress = lastIndexingProgressRef.current;
    indexingToastVaultRef.current = null;
    lastIndexingProgressRef.current = null;
    if (lifecycle === "active") {
      toast.success(`${vault.name} indexed`, {
        id: toastId,
        description: finalProgress?.total
          ? `${finalProgress.total.toLocaleString()} files are ready.`
          : "Search, backlinks, and graph are ready.",
        duration: 4_000,
      });
    } else if (lifecycle === "degraded") {
      toast.error(`Indexing ${vault.name} needs attention`, {
        id: toastId,
        description: "Editing remains available. Rebuild the index from the warning banner.",
        duration: 8_000,
      });
    }
  }, [indexing, lifecycle, vault]);

  useEffect(() => {
    if (!runtime.getPerformanceStats) return;

    let active = true;
    const refreshPerformanceStats = async () => {
      try {
        const nextStats = await runtime.getPerformanceStats?.();
        if (active && nextStats) setPerformanceStats(nextStats);
      } catch {
        if (active) setPerformanceStats(null);
      }
    };

    void refreshPerformanceStats();
    const interval = window.setInterval(() => void refreshPerformanceStats(), 10_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [runtime]);

  const addTab = () => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const id = nextTabIdRef.current++;
    setTabs((current) => [...current, createWorkspaceTab(id)]);
    setActiveTabId(id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [...leaf.tabIds, id],
        activeTabId: id,
      }))
    );
    revealSidebarPath(undefined);
  };

  const closeOtherTabs = (leafId: number, id: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    const nextRoot = mapWorkspaceLeaf(
      closeOtherWorkspaceTabs(workspaceRoot, leafId, id),
      leafId,
      (leaf) => ({ ...leaf, view: workspaceTabView(tab) })
    );
    setTabs((current) => current.filter((candidate) => workspaceHasTab(nextRoot, candidate.id)));
    setActiveTabId(id);
    setActiveLeafId(leafId);
    setWorkspaceRoot(nextRoot);
    revealSidebarPath(tab?.document?.path ?? tab?.pdf?.path ?? tab?.preview?.path);
  };

  const closeTabsAfter = (leafId: number, id: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const closedRoot = closeWorkspaceTabsAfter(workspaceRoot, leafId, id);
    if (closedRoot === workspaceRoot) return;
    const nextLeaf = findWorkspaceLeaf(closedRoot, leafId);
    if (!nextLeaf) return;
    const nextActiveTab = tabs.find((candidate) => candidate.id === nextLeaf.activeTabId);
    const nextRoot = mapWorkspaceLeaf(closedRoot, leafId, (leaf) => ({
      ...leaf,
      view: workspaceTabView(nextActiveTab),
    }));
    setTabs((current) => current.filter((candidate) => workspaceHasTab(nextRoot, candidate.id)));
    setWorkspaceRoot(nextRoot);
    if (activeLeafId === leafId) {
      setActiveTabId(nextLeaf.activeTabId);
      revealSidebarPath(
        nextActiveTab?.document?.path ?? nextActiveTab?.pdf?.path ?? nextActiveTab?.preview?.path
      );
    }
  };

  const closeAllTabs = (leafId: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    if (!leaf) return;
    if (workspaceLeaves(workspaceRoot).length > 1) {
      const nextRoot = removeWorkspaceLeaf(workspaceRoot, leafId);
      if (!nextRoot) return;
      const nextLeaf = findWorkspaceLeaf(nextRoot, activeLeafId) ?? workspaceLeaves(nextRoot)[0];
      setTabs((current) => current.filter((candidate) => workspaceHasTab(nextRoot, candidate.id)));
      setWorkspaceRoot(nextRoot);
      setActiveLeafId(nextLeaf.id);
      setActiveTabId(nextLeaf.activeTabId);
      const nextActiveTab = tabs.find((candidate) => candidate.id === nextLeaf.activeTabId);
      revealSidebarPath(
        nextActiveTab?.document?.path ?? nextActiveTab?.pdf?.path ?? nextActiveTab?.preview?.path
      );
      return;
    }
    const replacement = createWorkspaceTab(nextTabIdRef.current++);
    setTabs([replacement]);
    setActiveTabId(replacement.id);
    setWorkspaceRoot({
      ...leaf,
      view: "editor",
      tabIds: [replacement.id],
      activeTabId: replacement.id,
    });
    revealSidebarPath(undefined);
  };

  const togglePinned = (id: number) => {
    setTabs((current) =>
      current.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab))
    );
  };

  const updateTab = (id: number, update: (tab: WorkspaceTab) => WorkspaceTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? update(tab) : tab)));
  };

  const setLeafView = (id: number, view: WorkspaceLeafView) => {
    navigationIntentRef.current += 1;
    setWorkspaceRoot((root) => mapWorkspaceLeaf(root, id, (leaf) => ({ ...leaf, view })));
    setActiveLeafId(id);
  };

  const splitLeaf = (id: number, direction: "horizontal" | "vertical") => {
    navigationIntentRef.current += 1;
    const secondLeafId = nextLeafIdRef.current++;
    const splitId = nextLeafIdRef.current++;
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, id, (leaf) => ({
        kind: "split",
        id: splitId,
        direction,
        children: [leaf, { ...leaf, id: secondLeafId, tabIds: [leaf.activeTabId] }],
      }))
    );
    setActiveLeafId(secondLeafId);
  };

  const closeLeafTab = (leafId: number, tabId: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!leaf || !tab) return;

    const leaves = workspaceLeaves(workspaceRoot);
    if (leaves.length === 1 && leaf.tabIds.length === 1) {
      if (!tab.kind && !tab.document && !tab.pdf && !tab.preview) return;
      const replacement = createWorkspaceTab(nextTabIdRef.current++);
      setTabs((current) => [...current.filter((candidate) => candidate.id !== tabId), replacement]);
      setWorkspaceRoot({
        ...leaf,
        view: "editor",
        tabIds: [replacement.id],
        activeTabId: replacement.id,
      });
      setActiveTabId(replacement.id);
      revealSidebarPath(undefined);
      return;
    }

    if (leaf.tabIds.length === 1) {
      const nextRoot = removeWorkspaceLeaf(workspaceRoot, leafId);
      if (!nextRoot) return;
      const nextLeaf = workspaceLeaves(nextRoot)[0];
      setWorkspaceRoot(nextRoot);
      setActiveLeafId(nextLeaf.id);
      setActiveTabId(nextLeaf.activeTabId);
      if (!workspaceHasTab(nextRoot, tabId)) {
        setTabs((current) => current.filter((candidate) => candidate.id !== tabId));
      }
      const activeTab = tabs.find((candidate) => candidate.id === nextLeaf.activeTabId);
      revealSidebarPath(
        activeTab?.document?.path ?? activeTab?.pdf?.path ?? activeTab?.preview?.path
      );
      return;
    }

    const index = leaf.tabIds.indexOf(tabId);
    const tabIds = leaf.tabIds.filter((id) => id !== tabId);
    const nextActiveId =
      leaf.activeTabId === tabId
        ? index > 0
          ? leaf.tabIds[index - 1]
          : tabIds[0]
        : leaf.activeTabId;
    const nextActiveTab = tabs.find((candidate) => candidate.id === nextActiveId);
    const nextRoot = mapWorkspaceLeaf(workspaceRoot, leafId, (current) => ({
      ...current,
      view: workspaceTabView(nextActiveTab),
      tabIds,
      activeTabId: nextActiveId,
    }));
    setWorkspaceRoot(nextRoot);
    setActiveTabId(nextActiveId);
    if (!workspaceHasTab(nextRoot, tabId)) {
      setTabs((current) => current.filter((candidate) => candidate.id !== tabId));
    }
    revealSidebarPath(
      nextActiveTab?.document?.path ?? nextActiveTab?.pdf?.path ?? nextActiveTab?.preview?.path
    );
  };

  const replaceWorkspaceDocument = (document: DemoDocument | null) => {
    navigationIntentRef.current += 1;
    const replacement = createWorkspaceTab(1, document);
    setTabs([replacement]);
    setActiveTabId(1);
    nextTabIdRef.current = 2;
    setWorkspaceRoot({ kind: "leaf", id: 1, view: "editor", tabIds: [1], activeTabId: 1 });
    setActiveLeafId(1);
    revealSidebarPath(document?.path);
  };

  const fetchFileChildren = async (vaultId: string, parent: string) => {
    const entries: FileEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await runtime.client!.listFileChildren(vaultId, parent, cursor);
      entries.push(...page.entries);
      cursor = page.nextCursor || undefined;
    } while (cursor);
    return entries;
  };

  const refreshFiles = async (
    vaultId = vault?.id,
    isCurrent = () => activeVaultIdRef.current === vaultId
  ) => {
    if (!runtime.client || !vaultId) return [];
    const parents = ["", ...loadedFoldersRef.current];
    const entries = (
      await mapWithConcurrency(parents, 4, (parent) => fetchFileChildren(vaultId, parent))
    ).flat();
    if (!isCurrent()) return entries;
    fileEntriesRef.current = entries;
    setFileEntries(entries);
    return entries;
  };

  const loadFolderChildren = async (parent: string) => {
    if (!runtime.client || !vault || loadedFoldersRef.current.has(parent)) return;
    const vaultId = vault.id;
    const children = await fetchFileChildren(vaultId, parent);
    if (activeVaultIdRef.current !== vaultId) return;
    loadedFoldersRef.current.add(parent);
    const byPath = new Map(fileEntriesRef.current.map((entry) => [entry.path, entry]));
    for (const entry of children) byPath.set(entry.path, entry);
    const entries = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
    fileEntriesRef.current = entries;
    setFileEntries(entries);
  };

  const refreshPlugins = async () => {
    if (!runtime.client) return;
    const [catalog, enabled] = await Promise.all([
      runtime.client.listPlugins(),
      vault ? runtime.client.listVaultPlugins(vault.id) : Promise.resolve([]),
    ]);
    setPluginCatalog(catalog);
    setVaultPlugins(enabled);
    if (vault) {
      const settings = await Promise.all(
        catalog
          .filter((entry) => entry.active && entry.manifest.contributes?.settings?.length)
          .map(
            async (entry) =>
              [
                entry.manifest.id,
                await runtime.client!.getPluginSettings(vault.id, entry.manifest.id),
              ] as const
          )
      );
      setPluginSettings(Object.fromEntries(settings));
    } else {
      setPluginSettings({});
    }
    try {
      const marketplace = await runtime.client.getMarketplace();
      setMarketplacePlugins(marketplace.plugins);
      setMarketplaceError("");
    } catch (error) {
      setMarketplacePlugins([]);
      setMarketplaceError(error instanceof Error ? error.message : String(error));
    }
  };

  const pluginVaultId = vault?.id;
  useEffect(() => {
    if (!runtime.client) return;
    let active = true;
    const loadPluginContributions = async () => {
      const [catalog, enabled] = await Promise.all([
        runtime.client!.listPlugins(),
        pluginVaultId
          ? runtime.client!.listVaultPlugins(pluginVaultId)
          : Promise.resolve([]),
      ]);
      if (!active) return;
      setPluginCatalog(catalog);
      setVaultPlugins(enabled);
    };
    void loadPluginContributions().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pluginVaultId, runtime.client]);

  const openPluginManager = () => {
    setPluginManagerOpen(true);
    void refreshPlugins().catch((error) =>
      toast.error("Could not load plugins", {
        description: error instanceof Error ? error.message : String(error),
      })
    );
  };

  const openPluginId = pluginView?.pluginId;
  const openPluginViewId = pluginView?.viewId;
  const openPluginIsDevelopment = pluginCatalog.some(
    (entry) =>
      entry.active &&
      entry.manifest.id === openPluginId &&
      entry.plugin.development
  );
  const shouldPollDevelopmentPlugins = openPluginIsDevelopment;
  useEffect(() => {
    if (
      !shouldPollDevelopmentPlugins ||
      !runtime.client ||
      !vault ||
      !openPluginId ||
      !openPluginViewId
    )
      return;
    let active = true;
    const refreshDevelopmentBuilds = async () => {
      const next = await runtime.client!.getPluginView(
        vault.id,
        openPluginId,
        openPluginViewId
      );
      if (!active) return;
      setPluginView((current) => {
        if (
          !current ||
          current.pluginId !== openPluginId ||
          current.viewId !== openPluginViewId ||
          current.html === next.html
        )
          return current;
        setPluginRuntimeRevision((revision) => revision + 1);
        return { ...current, ...next };
      });
    };
    void refreshDevelopmentBuilds().catch(() => undefined);
    const timer = window.setInterval(
      () => void refreshDevelopmentBuilds().catch(() => undefined),
      1_000
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    openPluginId,
    openPluginViewId,
    runtime.client,
    shouldPollDevelopmentPlugins,
    vault,
  ]);

  const openPluginSurface = useCallback(
    async (
      pluginId: string,
      view: {
        id: string;
        title: string;
        location?: PluginViewLocation;
      }
    ) => {
      if (!runtime.client || !vault) return;
      try {
        const result = await runtime.client.getPluginView(vault.id, pluginId, view.id);
        setPluginView({
          ...result,
          pluginId,
          viewId: view.id,
        });
        setPluginManagerOpen(false);
      } catch (error) {
        toast.error(`${view.title} failed`, {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [runtime.client, vault]
  );

  const pluginRibbonItems = useMemo(
    () =>
      pluginCatalog.flatMap((entry) => {
        const vaultState = vaultPlugins.find(
          (candidate) => candidate.pluginId === entry.manifest.id
        );
        if (!entry.active || !vaultState?.enabled) return [];
        return (entry.manifest.contributes?.views ?? []).map((view) => {
          const active =
            pluginView?.pluginId === entry.manifest.id && pluginView.viewId === view.id;
          return {
            id: `${entry.manifest.id}:${view.id}`,
            label: view.title,
            icon: view.icon,
            iconSrc: entry.viewIcons?.[view.id],
            active,
            onClick: () =>
              active ? setPluginView(undefined) : void openPluginSurface(entry.manifest.id, view),
          };
        });
      }),
    [openPluginSurface, pluginCatalog, pluginView, vaultPlugins]
  );
  const pluginViewLocation = useMemo<PluginViewLocation>(() => {
    if (!pluginView) return "modal";
    return (
      pluginCatalog
        .find((entry) => entry.manifest.id === pluginView.pluginId)
        ?.manifest.contributes?.views?.find((view) => view.id === pluginView.viewId)
        ?.location ?? "modal"
    );
  }, [pluginCatalog, pluginView]);

  const installPlugin = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !runtime.client) return;
    setPluginBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const installed = await runtime.client.installPlugin(bytes, sha256);
      const reloaded = installed.plugin.status === "active";
      toast.success(`${installed.manifest.name} ${reloaded ? "reloaded" : "staged"}`, {
        description: reloaded
          ? installed.plugin.development
            ? "Development build is live."
            : "Installed build is live."
          : "Review permissions, then activate it.",
      });
      await refreshPlugins();
      if (reloaded) setPluginRuntimeRevision((current) => current + 1);
    } catch (error) {
      toast.error("Plugin install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPluginBusy(false);
    }
  };

  const installMarketplacePlugin = async (plugin: MarketplacePlugin) => {
    if (!runtime.client) return;
    setPluginBusy(true);
    try {
      await runtime.client.installMarketplacePlugin(plugin.manifest.id);
      await refreshPlugins();
      setPluginSection("installed");
      toast.success(`${plugin.manifest.name} staged`, {
        description: "Review permissions, then activate it.",
      });
    } catch (error) {
      toast.error("Marketplace install failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPluginBusy(false);
    }
  };

  const savePluginSetting = async (pluginId: string, settingId: string, value: unknown) => {
    if (!runtime.client || !vault) return;
    const values = { ...(pluginSettings[pluginId] ?? {}), [settingId]: value };
    setPluginSettings((current) => ({ ...current, [pluginId]: values }));
    try {
      await runtime.client.putPluginSettings(vault.id, pluginId, values);
      setPluginRuntimeRevision((current) => current + 1);
    } catch (error) {
      toast.error("Setting was not saved", {
        description: error instanceof Error ? error.message : String(error),
      });
      await refreshPlugins();
    }
  };

  const updatePlugin = async (operation: () => Promise<void>) => {
    setPluginBusy(true);
    try {
      await operation();
      await refreshPlugins();
      setPluginRuntimeRevision((current) => current + 1);
    } catch (error) {
      toast.error("Plugin action failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPluginBusy(false);
    }
  };

  const refreshVaultGraph = async (vaultId = vault?.id) => {
    if (!runtime.client || !vaultId) return null;
    const graph = await runtime.client.getGraph(vaultId);
    if (activeVaultIdRef.current !== vaultId) return null;
    setVaultGraph(graph);
    return graph;
  };

  const refreshVaultDocuments = async (vaultId: string, entries: FileEntry[]) => {
    if (!runtime.client) return [];
    const previousDocuments = new Map(savedDocumentsRef.current);
    const markdownEntries = entries.filter(
      (entry) =>
        (entry.kind === "markdown" || entry.kind === "text") &&
        savedDocumentsRef.current.has(entry.path)
    );
    const loaded = await Promise.all(
      markdownEntries.map(async (entry) => {
        const version = `${entry.modifiedAt}:${entry.sizeBytes}`;
        const cached = savedDocumentsRef.current.get(entry.path);
        if (cached && vaultFileVersionsRef.current.get(entry.path) === version) return cached;
        const file = await runtime.client!.readFile(vaultId, entry.path);
        return {
          title: titleFromPath(file.path),
          path: file.path,
          content: file.content,
          contentHash: file.contentHash,
        } satisfies DemoDocument;
      })
    );
    if (activeVaultIdRef.current !== vaultId) return [];
    const visiblePaths = new Set(entries.map((entry) => entry.path));
    for (const path of savedDocumentsRef.current.keys()) {
      if (!visiblePaths.has(path)) savedDocumentsRef.current.delete(path);
    }
    for (const path of vaultFileVersionsRef.current.keys()) {
      if (!visiblePaths.has(path)) vaultFileVersionsRef.current.delete(path);
    }
    const resolved = [...loaded];
    const cleanUpdates = new Map<string, DemoDocument>();
    for (let index = 0; index < loaded.length; index += 1) {
      const document = loaded[index];
      const entry = markdownEntries[index];
      if (document?.path && entry) {
        const previous = previousDocuments.get(document.path);
        const locallyEdited = Boolean(
          previous &&
          tabsRef.current.some(
            (tab) =>
              tab.document?.path === document.path && tab.document?.content !== previous.content
          )
        );
        if (locallyEdited && previous && document.contentHash !== previous.contentHash) {
          resolved[index] = previous;
          continue;
        }
        savedDocumentsRef.current.set(document.path, document);
        vaultFileVersionsRef.current.set(entry.path, `${entry.modifiedAt}:${entry.sizeBytes}`);
        if (document.contentHash !== previous?.contentHash)
          cleanUpdates.set(document.path, document);
      }
    }
    if (cleanUpdates.size) {
      setTabs((current) =>
        current.map((tab) => {
          const document = tab.document?.path ? cleanUpdates.get(tab.document.path) : undefined;
          return document ? { ...tab, title: document.title, document } : tab;
        })
      );
    }
    setVaultDocuments(resolved);

    return resolved;
  };

  const loadVault = async (info: VaultInfo, openIntent: number) => {
    if (!runtime.client || vaultOpenIntentRef.current !== openIntent) return false;
    navigationIntentRef.current += 1;
    const load = ++vaultLoadRef.current;
    const isCurrent = () =>
      vaultLoadRef.current === load && vaultOpenIntentRef.current === openIntent;
    setInitializationPhase("cache");
    setStatus(`Loading ${info.name} cache…`);
    let entries = await fetchFileChildren(info.id, "");
    if (!isCurrent()) return false;
    const persisted = await statePersistence.loadWorkspaceSession(windowIdRef.current, info.id);
    if (!isCurrent()) return false;
    activeVaultIdRef.current = info.id;
    setAppVault(info, "initializing", null);
    setSessionVaultId("");
    setVault(info);
    setActiveVaultId(info.id);
    setVaultDocuments([]);
    setVaultGraph(null);
    setExpandedFolders([]);
    setLayoutState(undefined);
    savedDocumentsRef.current.clear();
    saveBasesRef.current.clear();
    vaultFileVersionsRef.current.clear();
    loadedFoldersRef.current.clear();
    fileEntriesRef.current = entries;
    setFileEntries(entries);
    void refreshVaultGraph(info.id).catch(() => undefined);
    setInitializationPhase("workspace");
    setStatus(`Restoring ${info.name} workspace…`);
    if (persisted?.expandedFolders?.length) {
      const restoredChildren = (
        await mapWithConcurrency(persisted.expandedFolders, 4, async (parent) => {
          try {
            return await fetchFileChildren(info.id, parent);
          } catch {
            return [];
          }
        })
      ).flat();
      if (!isCurrent()) return false;
      for (const parent of persisted.expandedFolders) loadedFoldersRef.current.add(parent);
      entries = [
        ...new Map([...entries, ...restoredChildren].map((entry) => [entry.path, entry])).values(),
      ];
      fileEntriesRef.current = entries;
      setFileEntries(entries);
    }
    const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
    const requestedTabs = persisted?.tabs ?? [];
    const eagerTabIds = new Set<number>();
    if (persisted?.activeTabId) eagerTabIds.add(persisted.activeTabId);
    if (persisted?.workspaceRoot) {
      for (const leaf of workspaceLeaves(persisted.workspaceRoot))
        eagerTabIds.add(leaf.activeTabId);
    }
    const restored = await Promise.all(
      requestedTabs.map(async ({ id, path, kind, graphRootPath, mode, pinned }, index) => {
        try {
          if (kind === "graph") {
            return {
              ...createGraphWorkspaceTab(id || index + 1, graphRootPath),
              mode,
              pinned,
            };
          }
          if (!path) return null;
          if (!eagerTabIds.has(id)) {
            return {
              ...createWorkspaceTab(id || index + 1),
              title: fileTitleFromPath(path),
              deferred: { path },
              mode,
              pinned,
            };
          }
          let entry = entryByPath.get(path);
          if (!entry) entry = (await runtime.client!.getFileMetadata(info.id, path)) ?? undefined;
          // Workspace state may outlive a format-policy change or an external delete.
          // Only restore files that are still part of the Obsidian-compatible vault view.
          if (!entry || entry.kind === "directory") return null;
          if (entry?.kind === "binary") {
            const data = await runtime.client!.readBinaryFile(info.id, path);
            if (/\.pdf$/i.test(path)) {
              return {
                ...createWorkspaceTab(id || index + 1),
                title: fileTitleFromPath(path),
                pdf: { path, data },
                mode,
                pinned,
              };
            }
            const mimeType = mimeTypeForPath(path);
            if (/^(image|audio|video)\//.test(mimeType) || decodedText(data) === null) {
              return {
                ...createWorkspaceTab(id || index + 1),
                title: fileTitleFromPath(path),
                preview: { path, data, mimeType },
                mode,
                pinned,
              };
            }
          }
          const file = await runtime.client!.readFile(info.id, path);
          if (!isCurrent()) return null;
          const document: DemoDocument = {
            title: titleFromPath(file.path),
            path: file.path,
            content: file.content,
            contentHash: file.contentHash,
          };
          savedDocumentsRef.current.set(path, document);
          if (entry)
            vaultFileVersionsRef.current.set(path, `${entry.modifiedAt}:${entry.sizeBytes}`);
          return { ...createWorkspaceTab(id || index + 1, document), mode, pinned };
        } catch {
          return null;
        }
      })
    );
    if (!isCurrent()) return false;
    const loaded = restored.flatMap((tab) => (tab ? [tab] : []));
    setVaultDocuments(loaded.flatMap((tab) => (tab.document ? [tab.document] : [])));
    if (!loaded.length) {
      replaceWorkspaceDocument(null);
    } else {
      const active =
        loaded.find((tab) => tab.id === persisted?.activeTabId) ??
        loaded.find((tab) => workspaceTabPath(tab) === persisted?.activePath) ??
        loaded[0];
      const tabIds = loaded.map((tab) => tab.id);
      const restoredRoot = restoreWorkspaceRoot(persisted?.workspaceRoot, new Set(tabIds));
      const baseRoot: WorkspaceNode = restoredRoot ?? {
        kind: "leaf",
        id: 1,
        view: workspaceTabView(active),
        tabIds,
        activeTabId: active.id,
      };
      const tabById = new Map(loaded.map((tab) => [tab.id, tab]));
      const nextRoot = mapWorkspaceLeaves(baseRoot, (leaf) => {
        const tab = tabById.get(leaf.activeTabId);
        return {
          ...leaf,
          view: tab?.kind === "graph" ? "graph" : leaf.view === "graph" ? "editor" : leaf.view,
        };
      });
      setTabs(loaded);
      nextTabIdRef.current = Math.max(...tabIds) + 1;
      setWorkspaceRoot(nextRoot);
      const restoredActiveLeaf = persisted?.activeLeafId
        ? findWorkspaceLeaf(nextRoot, persisted.activeLeafId)
        : null;
      const nextActiveLeaf = restoredActiveLeaf ?? workspaceLeaves(nextRoot)[0];
      setActiveLeafId(nextActiveLeaf.id);
      setActiveTabId(nextActiveLeaf.activeTabId);
      nextLeafIdRef.current = maxWorkspaceNodeId(nextRoot) + 1;
    }
    if (persisted?.leftSidebarPane) setLeftSidebarPane(persisted.leftSidebarPane);
    if (persisted?.rightSidebarPane) {
      setRightSidebarPane(
        persisted.rightSidebarPane === "outline" ||
          persisted.rightSidebarPane === "source-control"
          ? "backlinks"
          : persisted.rightSidebarPane
      );
    } else {
      setRightSidebarPane("backlinks");
    }
    if (persisted?.layout) setLayoutState(persisted.layout);
    if (persisted?.expandedFolders) setExpandedFolders(persisted.expandedFolders);
    setSessionVaultId(info.id);
    setVaultPickerOpen(false);
    setStatus(`Go backend connected · ${info.name}`);
    const nextIndexing = (info as IndexedVaultInfo).indexing ?? null;
    setLifecycle(nextIndexing ? "indexing" : lifecycleFromVault(info), nextIndexing);
    return true;
  };

  useEffect(() => {
    if (!vault || sessionVaultId !== vault.id) return;
    const persisted: PersistedWorkspaceSession = {
      version: 1,
      vaultId: vault.id,
      tabs: tabs.flatMap((tab): PersistedWorkspaceTab[] =>
        tab.kind === "graph"
          ? [
              {
                id: tab.id,
                kind: tab.kind,
                graphRootPath: tab.graphRootPath,
                mode: tab.mode,
                pinned: Boolean(tab.pinned),
              },
            ]
          : workspaceTabPath(tab)
            ? [
                {
                  id: tab.id,
                  path: workspaceTabPath(tab),
                  mode: tab.mode,
                  pinned: Boolean(tab.pinned),
                },
              ]
            : []
      ),
      activePath: (() => {
        const tab = tabs.find((candidate) => candidate.id === activeTabId);
        return tab ? workspaceTabPath(tab) : undefined;
      })(),
      activeTabId,
      workspaceRoot,
      activeLeafId,
      leftSidebarPane: effectiveLeftSidebarPane,
      rightSidebarPane,
      layout: layoutState,
      expandedFolders,
    };
    latestSessionRef.current = persisted;
    setStoredWorkspace(persisted);
    window.clearTimeout(sessionSaveTimerRef.current);
    const signature = JSON.stringify(persisted);
    if (signature === savedSessionSignatureRef.current) return;
    sessionSaveTimerRef.current = window.setTimeout(() => {
      sessionSaveChainRef.current = sessionSaveChainRef.current
        .catch(() => undefined)
        .then(() => statePersistence.saveWorkspaceSession(windowIdRef.current, persisted))
        .then(() => {
          savedSessionSignatureRef.current = signature;
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(sessionSaveTimerRef.current);
  }, [
    activeLeafId,
    activeTabId,
    effectiveLeftSidebarPane,
    layoutState,
    expandedFolders,
    rightSidebarPane,
    sessionVaultId,
    setStoredWorkspace,
    statePersistence,
    tabs,
    vault,
    workspaceRoot,
  ]);

  const flushWorkspaceSession = async () => {
    const persisted = latestSessionRef.current;
    window.clearTimeout(sessionSaveTimerRef.current);
    if (persisted && JSON.stringify(persisted) !== savedSessionSignatureRef.current) {
      sessionSaveChainRef.current = sessionSaveChainRef.current
        .catch(() => undefined)
        .then(() => statePersistence.saveWorkspaceSession(windowIdRef.current, persisted))
        .then(() => {
          savedSessionSignatureRef.current = JSON.stringify(persisted);
        });
    }
    await sessionSaveChainRef.current;
  };
  useEffect(() => {
    flushWorkspaceSessionRef.current = flushWorkspaceSession;
  });

  useEffect(() => {
    const flushSession = () => void flushWorkspaceSessionRef.current().catch(() => undefined);
    window.addEventListener("pagehide", flushSession);
    return () => window.removeEventListener("pagehide", flushSession);
  }, []);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    let active = true;
    let applying = Promise.resolve();
    const reconcile = async () => {
      const parents = ["", ...loadedFoldersRef.current];
      const entries = (
        await mapWithConcurrency(parents, 4, (parent) => fetchFileChildren(vault.id, parent))
      ).flat();
      if (!active) return;
      fileEntriesRef.current = entries;
      setFileEntries(entries);
      await refreshVaultDocuments(vault.id, entries);
      if (graphVisibleRef.current) await refreshVaultGraph(vault.id);
    };

    const applyChange = async (change: VaultChange) => {
      const nextProgress = change.vault.indexing ?? null;
      setLifecycle(nextProgress ? "indexing" : lifecycleFromVault(change.vault), nextProgress);
      const events = change.events ?? [];
      if (change.reconcile || events.some((event) => event.op === "reconcile")) {
        await reconcile();
        return;
      }
      if (!events.length) return;

      const byPath = new Map(fileEntriesRef.current.map((entry) => [entry.path, entry]));
      for (const event of events) {
        if (!event.path) continue;
        if (event.op === "remove") {
          for (const path of byPath.keys()) {
            if (path === event.path || path.startsWith(`${event.path}/`)) byPath.delete(path);
          }
          continue;
        }
        const entry = await runtime.client!.getFileMetadata(vault.id, event.path);
        if (entry?.kind === "directory" && event.op === "create") {
          await reconcile();
          return;
        }
        if (entry) byPath.set(entry.path, entry);
        else byPath.delete(event.path);
      }
      if (!active) return;
      const entries = [...byPath.values()].sort((left, right) =>
        left.path.localeCompare(right.path)
      );
      fileEntriesRef.current = entries;
      setFileEntries(entries);
      await refreshVaultDocuments(vault.id, entries);
      if (graphVisibleRef.current) await refreshVaultGraph(vault.id);
    };

    const stop = runtime.client.watchVaultChanges(
      vault.id,
      (change) => {
        if (!active) return;
        setSidebarIndexRevision(change.revision);
        applying = applying.then(() => applyChange(change)).catch(() => reconcile());
      },
      () => {
        // Browser EventSource and the desktop bridge reconnect automatically.
      }
    );
    return () => {
      active = false;
      stop();
    };
    // runtime client is shell-owned; vault id selects watcher stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.client, vault?.id]);

  useEffect(() => {
    if (!graphVisible || !runtime.client || !vault) return;
    void refreshVaultGraph(vault.id).catch(() => undefined);
    // Graph data stays unloaded until a graph pane exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphVisible, runtime.client, vault?.id]);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    let disposed = false;
    const host = new VaultPluginHost({
      vaultId: vault.id,
      capabilityHandler: (pluginId, capability, input) =>
        runtime.client!.invokePluginCapability(vault.id, pluginId, capability, input),
      onDisabled: ({ pluginId, reason }) => {
        void runtime.client!.disableVaultPlugin(vault.id, pluginId);
        toast.error(`${pluginId} disabled`, { description: reason });
      },
    });
    pluginHostRef.current?.dispose();
    pluginHostRef.current = host;
    void runtime.client
      .listPluginBundles(vault.id)
      .then(async (bundles) => {
        for (const bundle of bundles) {
          if (disposed) return;
          try {
            await host.activate({
              ...bundle,
              manifest: bundle.manifest as PluginBundle["manifest"],
              grantedCapabilities: bundle.grantedCapabilities as PluginCapability[],
            });
          } catch (error) {
            toast.error(`${bundle.manifest.name} failed to start`, {
              description: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })
      .catch((error) =>
        toast.error("Plugins unavailable", {
          description: error instanceof Error ? error.message : String(error),
        })
      );
    return () => {
      disposed = true;
      host.dispose();
      if (pluginHostRef.current === host) pluginHostRef.current = null;
    };
  }, [pluginRuntimeRevision, runtime.client, vault]);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    let active = true;
    let timer: number | undefined;

    const refreshLifecycle = async () => {
      try {
        const info = (await runtime.client!.getVaultInfo(vault.id)) as IndexedVaultInfo;
        if (!active) return;
        const nextLifecycle = info.indexing ? "indexing" : lifecycleFromVault(info);
        setLifecycle(nextLifecycle, info.indexing ?? null);
        if (
          nextLifecycle === "initializing" ||
          nextLifecycle === "read_only_ready" ||
          nextLifecycle === "writable" ||
          nextLifecycle === "indexing"
        ) {
          timer = window.setTimeout(() => void refreshLifecycle(), 500);
        }
      } catch {
        if (active) timer = window.setTimeout(() => void refreshLifecycle(), 1_500);
      }
    };

    if (lifecycle !== "active" && lifecycle !== "degraded") void refreshLifecycle();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [lifecycle, runtime.client, setLifecycle, vault]);

  const chooseVault = async (mode: "open" | "create") => {
    if (!runtime.client || !runtime.selectVaultDirectory) return;
    const path = await runtime.selectVaultDirectory(mode);
    if (!path) return;
    const openIntent = ++vaultOpenIntentRef.current;
    try {
      if (vault) await flushPendingSaves(vault.id);
    } catch (error) {
      toast.error("Could not switch vault", {
        description: `Save the current note first. ${errorMessage(error)}`,
      });
      return;
    }
    if (vaultOpenIntentRef.current !== openIntent) return;
    const previousLifecycle = lifecycle;
    const previousProgress = indexing;
    setLifecycle("initializing", null);
    setInitializationPhase("vault");
    setStatus(mode === "create" ? "Creating vault…" : "Initializing vault…");
    try {
      await runWithToast(
        (async () => {
          const info =
            mode === "create"
              ? await runtime.client!.createVault({ path })
              : await runtime.client!.openVault({ path });
          if (!(await loadVault(info, openIntent))) return;
          if (runtime.vaultAccess !== "registry") {
            await statePersistence.rememberVault({ id: info.id, name: info.name, path });
          }
          const [recent, available] = await Promise.all([
            runtime.client!.listRecentVaults(),
            runtime.client!.listAvailableVaults(),
          ]);
          setRecentVaults(recent);
          setAvailableVaults(available);
        })(),
        {
          loading: mode === "create" ? "Creating vault…" : "Opening vault…",
          success: mode === "create" ? "Vault created" : "Vault opened",
          error: mode === "create" ? "Could not create vault" : "Could not open vault",
        }
      );
    } catch (error) {
      if (vaultOpenIntentRef.current !== openIntent) return;
      setLifecycle(previousLifecycle, previousProgress);
      setStatus(error instanceof Error ? error.message : "Vault operation failed");
    }
  };

  const openRegisteredVault = async (registered: { name: string; path: string }) => {
    if (!runtime.client) return;
    const openIntent = ++vaultOpenIntentRef.current;
    try {
      if (vault) await flushPendingSaves(vault.id);
    } catch (error) {
      toast.error("Could not switch vault", {
        description: `Save the current note first. ${errorMessage(error)}`,
      });
      return;
    }
    if (vaultOpenIntentRef.current !== openIntent) return;
    const previousLifecycle = lifecycle;
    const previousProgress = indexing;
    setLifecycle("initializing", null);
    setInitializationPhase("vault");
    setStatus(`Initializing ${registered.name}…`);
    try {
      await runWithToast(
        (async () => {
          const info = await runtime.client!.openVault({ path: registered.path });
          if (!(await loadVault(info, openIntent))) return;
          if (runtime.vaultAccess !== "registry") {
            await statePersistence.rememberVault({
              id: info.id,
              name: info.name,
              path: registered.path,
            });
          }
          const [recent, available] = await Promise.all([
            runtime.client!.listRecentVaults(),
            runtime.client!.listAvailableVaults(),
          ]);
          setRecentVaults(recent);
          setAvailableVaults(available);
        })(),
        {
          loading: `Opening ${registered.name}…`,
          success: "Vault opened",
          error: "Could not open vault",
        }
      );
    } catch (error) {
      if (vaultOpenIntentRef.current !== openIntent) return;
      setLifecycle(previousLifecycle, previousProgress);
      setStatus(error instanceof Error ? error.message : "Vault operation failed");
    }
  };

  const forgetRegisteredVault = async (vaultId: string) => {
    if (!runtime.client) return;
    try {
      await runtime.client.forgetVault(vaultId);
      setRecentVaults((current) => current.filter((item) => item.vaultId !== vaultId));
      toast.success("Vault removed from recent list");
    } catch (error) {
      toast.error("Could not forget vault", { description: errorMessage(error) });
    }
  };

  const rebuildIndex = async () => {
    if (!runtime.client || !vault) return;
    try {
      await runtime.client.rebuildIndex(vault.id);
      setLifecycle("indexing", { phase: "scanning", processed: 0, total: 0, failed: 0 });
      toast.success("Index rebuild started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rebuild index");
    }
  };

  const documentSaveKey = (vaultId: string, path: string) => `${vaultId}:${path}`;

  const persistDocument = async (request: PendingDocumentSave) => {
    const path = request.document.path;
    if (!runtime.client || !path) return;
    const { vaultId, tabId, document, content } = request;
    const key = documentSaveKey(vaultId, path);
    const saved = saveBasesRef.current.get(key) ?? document;
    if (!saved.contentHash || saved.content === content) return;
    const result = await runtime.client.patchFile({
      vaultId,
      path,
      expectedHash: saved.contentHash,
      edits: [singleTextEdit(saved.content, content)],
    });
    const next = { ...saved, content, contentHash: result.contentHash };
    saveBasesRef.current.set(key, next);
    if (activeVaultIdRef.current !== vaultId) return;
    savedDocumentsRef.current.set(path, next);
    setVaultDocuments((current) =>
      current.map((item) =>
        item.path === path ? { ...item, content, contentHash: result.contentHash } : item
      )
    );
    updateTab(tabId, (tab) => {
      const tabDocument = tab.document;
      return tabDocument?.path === path && tabDocument.content === content
        ? { ...tab, document: { ...tabDocument, contentHash: result.contentHash } }
        : tab;
    });
  };

  const enqueueSave = (request: PendingDocumentSave) => {
    if (!request.document.path) return Promise.resolve();
    const key = documentSaveKey(request.vaultId, request.document.path);
    const previous = saveChainsRef.current.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => persistDocument(request));
    saveChainsRef.current.set(key, next);
    void next
      .finally(() => {
        if (saveChainsRef.current.get(key) === next) saveChainsRef.current.delete(key);
      })
      .catch(() => undefined);
    return next;
  };

  const scheduleSave = (tabId: number, document: DemoDocument, content: string) => {
    if (!vault || !document.path || !document.contentHash) return;
    const request = { vaultId: vault.id, tabId, document, content };
    const key = documentSaveKey(vault.id, document.path);
    if (!saveBasesRef.current.has(key)) {
      saveBasesRef.current.set(key, savedDocumentsRef.current.get(document.path) ?? document);
    }
    pendingSavesRef.current.set(key, request);
    const existing = saveTimersRef.current.get(key);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(key);
      pendingSavesRef.current.delete(key);
      void enqueueSave(request).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown save error";
        setStatus(`Save failed · ${message}`);
        toast.error(`Could not save ${titleFromPath(document.path!)}`, { description: message });
      });
    }, 500);
    saveTimersRef.current.set(key, timer);
  };

  const flushPendingSaves = async (vaultId?: string) => {
    const saves = new Set<Promise<void>>();
    for (const [key, request] of pendingSavesRef.current) {
      if (vaultId && request.vaultId !== vaultId) continue;
      const timer = saveTimersRef.current.get(key);
      if (timer) window.clearTimeout(timer);
      saveTimersRef.current.delete(key);
      pendingSavesRef.current.delete(key);
      saves.add(enqueueSave(request));
    }
    for (const [key, save] of saveChainsRef.current) {
      if (!vaultId || key.startsWith(`${vaultId}:`)) saves.add(save);
    }
    await Promise.all(saves);
  };
  useEffect(() => {
    flushPendingSavesRef.current = flushPendingSaves;
  });

  const invokePluginViewCapability = async (
    pluginId: string,
    capability: PluginCapability,
    input: unknown
  ) => {
      if (!runtime.client || !vault) throw new Error("No vault is open");
      const permissions = vaultPlugins.find((item) => item.pluginId === pluginId)?.grantedPermissions;
      if (!permissions?.includes(capability)) throw new Error(`capability not granted: ${capability}`);
      if (capability === "ui.external") {
        const url = new URL(String((input as { url?: unknown })?.url ?? ""));
        if (url.protocol !== "https:") throw new Error("only HTTPS links can be opened");
        if (!runtime.openWindow) throw new Error("external links are unavailable");
        await runtime.openWindow(url.href);
        return { opened: true };
      }
      if (["git.pull", "git.checkout", "git.branch.create", "git.discard", "git.resolve"].includes(capability)) {
        await flushPendingSaves(vault.id);
      }
    return runtime.client.invokePluginCapability(vault.id, pluginId, capability, input);
  };

  useEffect(() => {
    const flushCurrentVault = () => {
      if (vault) void flushPendingSavesRef.current(vault.id);
    };
    const flushAll = () => void flushPendingSavesRef.current();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushCurrentVault();
    };
    window.addEventListener("blur", flushCurrentVault);
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("blur", flushCurrentVault);
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [vault]);

  useEffect(() => {
    if (!runtime.onBeforeShutdown) return;
    return runtime.onBeforeShutdown(async () => {
      await Promise.allSettled([
        flushWorkspaceSessionRef.current(),
        flushPendingSavesRef.current(),
      ]);
    });
  }, [runtime]);

  const movePath = async (
    sourcePath: string,
    destinationPath: string,
    feedback: AsyncFeedback | null = {
      loading: `Moving ${sourcePath}…`,
      success: `Moved to ${destinationPath}`,
      error: `Could not move ${sourcePath}`,
    }
  ) => {
    if (!runtime.client || !vault || sourcePath === destinationPath) return false;
    try {
      const operation = (async () => {
        await flushPendingSaves(vault.id);
        const movedEntry = await runtime.client!.moveFile({
          vaultId: vault.id,
          sourcePath,
          destinationPath,
        });
        setTabs((current) =>
          current.map((tab) => {
            if (tab.deferred) {
              const path = movedDocumentPath(tab.deferred.path, sourcePath, destinationPath);
              return path === tab.deferred.path
                ? tab
                : { ...tab, title: fileTitleFromPath(path), deferred: { path } };
            }
            if (tab.pdf) {
              const path = movedDocumentPath(tab.pdf.path, sourcePath, destinationPath);
              return path === tab.pdf.path
                ? tab
                : { ...tab, title: fileTitleFromPath(path), pdf: { ...tab.pdf, path } };
            }
            if (tab.preview) {
              const path = movedDocumentPath(tab.preview.path, sourcePath, destinationPath);
              return path === tab.preview.path
                ? tab
                : {
                    ...tab,
                    title: fileTitleFromPath(path),
                    preview: { ...tab.preview, path, mimeType: mimeTypeForPath(path) },
                  };
            }
            if (!tab.document?.path) return tab;
            const path = movedDocumentPath(tab.document.path, sourcePath, destinationPath);
            return path === tab.document.path
              ? tab
              : {
                  ...tab,
                  title: titleFromPath(path),
                  document: { ...tab.document, path, title: titleFromPath(path) },
                };
          })
        );
        setVaultDocuments((current) =>
          current.map((document) => {
            if (!document.path) return document;
            const path = movedDocumentPath(document.path, sourcePath, destinationPath);
            return path === document.path
              ? document
              : { ...document, path, title: titleFromPath(path) };
          })
        );
        for (const [path, document] of savedDocumentsRef.current) {
          const nextPath = movedDocumentPath(path, sourcePath, destinationPath);
          if (nextPath !== path) {
            savedDocumentsRef.current.delete(path);
            savedDocumentsRef.current.set(nextPath, {
              ...document,
              path: nextPath,
              title: titleFromPath(nextPath),
            });
          }
        }
        for (const [key, document] of saveBasesRef.current) {
          const prefix = `${vault.id}:`;
          if (!key.startsWith(prefix)) continue;
          const path = key.slice(prefix.length);
          const nextPath = movedDocumentPath(path, sourcePath, destinationPath);
          if (nextPath !== path) {
            saveBasesRef.current.delete(key);
            saveBasesRef.current.set(documentSaveKey(vault.id, nextPath), {
              ...document,
              path: nextPath,
              title: titleFromPath(nextPath),
            });
          }
        }
        for (const [path, version] of vaultFileVersionsRef.current) {
          const nextPath = movedDocumentPath(path, sourcePath, destinationPath);
          if (nextPath !== path) {
            vaultFileVersionsRef.current.delete(path);
            vaultFileVersionsRef.current.set(nextPath, version);
          }
        }
        setFileEntries((current) => {
          const next = current.map((item) => {
            const path = movedDocumentPath(item.path, sourcePath, destinationPath);
            if (path === item.path) return item;
            return item.path === sourcePath
              ? movedEntry
              : { ...item, path, name: path.split("/").at(-1) ?? item.name };
          });
          fileEntriesRef.current = next;
          return next;
        });
        setExpandedFolders((current) =>
          current.map((path) => movedDocumentPath(path, sourcePath, destinationPath))
        );
        loadedFoldersRef.current = new Set(
          [...loadedFoldersRef.current].map((path) =>
            movedDocumentPath(path, sourcePath, destinationPath)
          )
        );
        setStatus(`Moved · ${destinationPath}`);
      })();
      if (feedback) await runWithToast(operation, feedback);
      else await operation;
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Move failed");
      return false;
    }
  };

  const renamePath = (sourcePath: string, requestedName?: string) => {
    const name = requestedName?.trim();
    if (!name) return;
    const parent = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    const sourceEntry = fileEntries.find((entry) => entry.path === sourcePath);
    const extension =
      sourceEntry?.kind === "directory" ? "" : (sourcePath.match(/\.[^./]+$/)?.[0] ?? "");
    const finalName =
      extension && !name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
        ? `${name}${extension}`
        : name;
    const destinationPath = parent ? `${parent}/${finalName}` : finalName;
    void movePath(sourcePath, destinationPath, {
      loading: `Renaming ${sourcePath}…`,
      success: `Renamed to ${finalName}`,
      error: `Could not rename ${sourcePath}`,
    });
  };

  const deletePath = async (path: string) => {
    if (!runtime.client || !vault) return;
    if (general.confirmDeleteNote && !window.confirm(`Are you sure you want to delete "${path}"?`))
      return;
    try {
      await runWithToast(
        (async () => {
          for (const document of tabs.map((tab) => tab.document)) {
            if (
              !document?.path ||
              (document.path !== path && !document.path.startsWith(`${path}/`))
            )
              continue;
            const key = documentSaveKey(vault.id, document.path);
            const timer = saveTimersRef.current.get(key);
            if (timer) window.clearTimeout(timer);
            saveTimersRef.current.delete(key);
            pendingSavesRef.current.delete(key);
            const inFlight = saveChainsRef.current.get(key);
            if (inFlight) await inFlight;
            saveBasesRef.current.delete(key);
            savedDocumentsRef.current.delete(document.path);
          }
          await runtime.client!.deleteFile(vault.id, path);
          let nextTabs = tabs.filter((tab) => {
            const candidate = workspaceTabPath(tab);
            return !candidate || (candidate !== path && !candidate.startsWith(`${path}/`));
          });
          let nextRoot = restoreWorkspaceRoot(
            workspaceRoot,
            new Set(nextTabs.map((tab) => tab.id))
          );
          if (!nextRoot) {
            const replacement = createWorkspaceTab(nextTabIdRef.current++);
            nextTabs = [...nextTabs, replacement];
            nextRoot = {
              kind: "leaf",
              id: nextLeafIdRef.current++,
              view: "editor",
              tabIds: [replacement.id],
              activeTabId: replacement.id,
            };
          }
          const nextLeaf =
            findWorkspaceLeaf(nextRoot, activeLeafId) ?? workspaceLeaves(nextRoot)[0];
          setTabs(nextTabs);
          setWorkspaceRoot(nextRoot);
          setActiveLeafId(nextLeaf.id);
          setActiveTabId(nextLeaf.activeTabId);
          setVaultDocuments((current) =>
            current.filter(
              (document) =>
                !document.path || (document.path !== path && !document.path.startsWith(`${path}/`))
            )
          );
          setFileEntries((current) => {
            const next = current.filter(
              (entry) => entry.path !== path && !entry.path.startsWith(`${path}/`)
            );
            fileEntriesRef.current = next;
            return next;
          });
          setExpandedFolders((current) =>
            current.filter((entry) => entry !== path && !entry.startsWith(`${path}/`))
          );
          for (const loaded of [...loadedFoldersRef.current]) {
            if (loaded === path || loaded.startsWith(`${path}/`)) {
              loadedFoldersRef.current.delete(loaded);
            }
          }
          if (trashOpen) await refreshTrash();
          setStatus(`Moved to trash · ${path}`);
        })(),
        {
          loading: `Moving ${path} to trash…`,
          success: `Moved ${path} to trash`,
          error: `Could not move ${path} to trash`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const archivePath = async (path: string) => {
    if (!runtime.client || !vault || path === "archive" || path.startsWith("archive/")) return;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const archiveParent = parent ? `archive/${parent}` : "archive";
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.createDirectory(vault.id, archiveParent);
          if (!(await movePath(path, `archive/${path}`, null))) throw new Error("Move failed");
          setStatus(`Archived · ${path}`);
        })(),
        {
          loading: `Archiving ${path}…`,
          success: `Archived ${path}`,
          error: `Could not archive ${path}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Archive failed");
    }
  };

  const refreshTrash = async () => {
    if (!runtime.client || !vault) return [];
    const entries = await runtime.client.listTrash(vault.id);
    setTrashEntries(entries);
    return entries;
  };

  const openTrash = async () => {
    setTrashOpen(true);
    try {
      await refreshTrash();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load trash");
    }
  };

  const restoreTrashEntry = async (entry: TrashEntry) => {
    if (!runtime.client || !vault) return;
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.restoreFile(vault.id, entry.id);
          await Promise.all([refreshFiles(), refreshTrash()]);
          setStatus(`Restored · ${entry.originalPath}`);
        })(),
        {
          loading: `Restoring ${entry.originalPath}…`,
          success: `Restored ${entry.originalPath}`,
          error: `Could not restore ${entry.originalPath}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Restore failed");
    }
  };

  const permanentlyDeleteTrashEntry = async (entry: TrashEntry) => {
    if (!runtime.client || !vault) return;
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.permanentlyDelete(vault.id, entry.id);
          await refreshTrash();
          setPermanentDeleteRequest(undefined);
          setStatus(`Permanently deleted · ${entry.originalPath}`);
        })(),
        {
          loading: `Permanently deleting ${entry.originalPath}…`,
          success: `Permanently deleted ${entry.originalPath}`,
          error: `Could not permanently delete ${entry.originalPath}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Permanent deletion failed");
    }
  };

  const emptyTrash = async () => {
    if (!runtime.client || !vault || !trashEntries.length) return;
    try {
      await runWithToast(
        Promise.all(
          trashEntries.map((entry) => runtime.client!.permanentlyDelete(vault.id, entry.id))
        ),
        {
          loading: `Deleting ${trashEntries.length} trash items…`,
          success: "Trash emptied",
          error: "Could not empty trash",
        }
      );
      setTrashEntries([]);
      setEmptyTrashRequest(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not empty trash");
    }
  };

  const createFolder = async (parent: string, requestedName: string) => {
    if (!runtime.client || !vault) return;
    const name = requestedName.trim();
    if (!name) return;
    try {
      const path = parent ? `${parent}/${name}` : name;
      await runWithToast(
        (async () => {
          await runtime.client!.createDirectory(vault.id, path);
          await refreshFiles();
          setStatus(`Created folder · ${name}`);
        })(),
        {
          loading: `Creating folder ${name}…`,
          success: `Created folder ${name}`,
          error: `Could not create folder ${name}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Create folder failed");
    }
  };

  const editorFor = (tab: WorkspaceTab) => {
    if (!tab.document) return null;

    return (
      <MarkdownEditor
        document={tab.document}
        mode={plugins["live-preview"] === false ? "source" : tab.mode}
        onChange={(content) => {
          if (tab.document) scheduleSave(tab.id, tab.document, content);
          updateTab(tab.id, (current) =>
            current.document ? { ...current, document: { ...current.document, content } } : current
          );
        }}
        onTitleChange={(title) =>
          updateTab(tab.id, (current) =>
            current.document
              ? {
                  ...current,
                  title: title || "Untitled",
                  document: { ...current.document, title },
                }
              : current
          )
        }
        onTitleCommit={(title) => {
          if (tab.document?.path && title.trim() && title !== titleFromPath(tab.document.path)) {
            renamePath(tab.document.path, title.trim());
          }
        }}
        showBacklinks={tab.showBacklinks}
        findRequest={tab.findRequest}
        revealRequest={
          headingReveal && headingReveal.path === tab.document.path ? headingReveal : undefined
        }
        onDropDocument={openDocument}
        onOpenDocument={(identifier, inPlace) =>
          openDocument(identifier, inPlace ? tab.id : undefined)
        }
        documents={documents}
      />
    );
  };

  const renameFile = (id: number) => {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab?.document) return;
    if (tab.document.path) {
      setRenameRequest({ path: tab.document.path, value: tab.document.title });
      return;
    }
    const title = window.prompt("Rename file", tab.document.title)?.trim();
    if (!title) return;
    updateTab(id, (current) =>
      current.document ? { ...current, title, document: { ...current.document, title } } : current
    );
  };

  const addProperty = (id: number) => {
    const name = window.prompt("Property name")?.trim();
    if (!name) return;
    const value = window.prompt(`Value for ${name}`)?.trim() ?? "";
    updateTab(id, (current) =>
      current.document
        ? {
            ...current,
            document: {
              ...current.document,
              content: setFrontmatterProperty(current.document.content, name, value),
            },
          }
        : current
    );
  };

  const openFind = (id: number) => {
    updateTab(id, (current) => ({
      ...current,
      mode: "live",
      findRequest: current.findRequest + 1,
    }));
  };

  const isProtectedNewTab = (tab: WorkspaceTab, leafId: number) => {
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    return (
      !tab.document &&
      !tab.pdf &&
      !tab.preview &&
      !tab.deferred &&
      !tab.kind &&
      workspaceLeaves(workspaceRoot).length === 1 &&
      leaf?.tabIds.length === 1
    );
  };

  const revealEditorPath = (path: string, file: boolean) => {
    const folder = file && path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path;
    const parts = folder.split("/").filter(Boolean);
    setExpandedFolders((current) => {
      const next = new Set(current);
      for (let index = 0; index < parts.length; index++) {
        next.add(parts.slice(0, index + 1).join("/"));
      }
      return [...next].sort();
    });
    setLeftSidebarPane("files");
    setSidebarRevealPath(folder);
    setSidebarSelectedPath(folder);
    if (revealPathTimerRef.current) window.clearTimeout(revealPathTimerRef.current);
    revealPathTimerRef.current = window.setTimeout(() => {
      setSidebarRevealPath(undefined);
      revealPathTimerRef.current = undefined;
    }, 1800);
  };

  const openBrowserTab = useCallback(
    (url: string) => {
      const id = nextTabIdRef.current++;
      setTabs((current) => [...current, createBrowserWorkspaceTab(id, url)]);
      setActiveTabId(id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
          ...leaf,
          view: "browser",
          tabIds: [...leaf.tabIds, id],
          activeTabId: id,
        }))
      );
    },
    [activeLeafId]
  );

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (link) {
        const hrefAttr = link.getAttribute("href");
        if (hrefAttr && (hrefAttr.startsWith("http://") || hrefAttr.startsWith("https://"))) {
          event.preventDefault();
          event.stopPropagation();
          openBrowserTab(link.href);
        }
      }
    };
    document.addEventListener("click", handleGlobalClick, { capture: true });
    return () => document.removeEventListener("click", handleGlobalClick, { capture: true });
  }, [openBrowserTab]);

  const commandsFor = (tab: WorkspaceTab, leafId = activeLeafId): FluxTabCommands => {
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    const tabIndex = leaf?.tabIds.indexOf(tab.id) ?? -1;
    const protectedNewTab = isProtectedNewTab(tab, leafId);

    return {
      pinned: tab.pinned,
      canCloseOthers: (leaf?.tabIds.length ?? 0) > 1,
      canCloseAfter: tabIndex >= 0 && tabIndex < (leaf?.tabIds.length ?? 0) - 1,
      onClose: protectedNewTab ? undefined : () => closeLeafTab(leafId, tab.id),
      onCloseOthers: () => closeOtherTabs(leafId, tab.id),
      onCloseAfter: () => closeTabsAfter(leafId, tab.id),
      onCloseAll: () => closeAllTabs(leafId),
      onTogglePin: () => togglePinned(tab.id),
      onMoveToNewWindow: () => popOutTab(tab),
      onSplitRight: () => splitLeaf(leafId, "horizontal"),
      onSplitDown: () => splitLeaf(leafId, "vertical"),
    };
  };

  const markDraggedTab = (
    event: DragEvent<HTMLDivElement>,
    title: string,
    tabId: number,
    leafId: number
  ) => {
    event.dataTransfer.setData("text/plain", title);
    event.dataTransfer.setData("application/x-flux-tab", JSON.stringify({ tabId, leafId }));
    event.dataTransfer.effectAllowed = "move";
  };

  const hydrateDeferredTab = (tab: WorkspaceTab) => {
    if (!runtime.client || !vault || !tab.deferred) return Promise.resolve();
    const vaultId = vault.id;
    const path = tab.deferred.path;
    const key = `${vaultId}:${tab.id}`;
    const existing = deferredTabLoadsRef.current.get(key);
    if (existing) return existing;
    const load = (async () => {
      try {
        const entry = await runtime.client!.getFileMetadata(vaultId, path);
        if (!entry || entry.kind === "directory" || activeVaultIdRef.current !== vaultId) return;
        let replacement: WorkspaceTab;
        if (entry.kind === "binary") {
          const data = await runtime.client!.readBinaryFile(vaultId, path);
          if (activeVaultIdRef.current !== vaultId) return;
          if (/\.pdf$/i.test(path)) {
            replacement = {
              ...tab,
              deferred: undefined,
              title: fileTitleFromPath(path),
              pdf: { path, data },
            };
          } else {
            const mimeType = mimeTypeForPath(path);
            const text = decodedText(data);
            if (/^(image|audio|video)\//.test(mimeType) || text === null) {
              replacement = {
                ...tab,
                deferred: undefined,
                title: fileTitleFromPath(path),
                preview: { path, data, mimeType },
              };
            } else {
              const file = await runtime.client!.readFile(vaultId, path);
              const document = {
                title: titleFromPath(file.path),
                path: file.path,
                content: file.content,
                contentHash: file.contentHash,
              };
              replacement = { ...tab, deferred: undefined, title: document.title, document };
              savedDocumentsRef.current.set(path, document);
              setVaultDocuments((current) => [
                ...current.filter((item) => item.path !== path),
                document,
              ]);
            }
          }
        } else {
          const file = await runtime.client!.readFile(vaultId, path);
          if (activeVaultIdRef.current !== vaultId) return;
          const document = {
            title: titleFromPath(file.path),
            path: file.path,
            content: file.content,
            contentHash: file.contentHash,
          };
          replacement = { ...tab, deferred: undefined, title: document.title, document };
          savedDocumentsRef.current.set(path, document);
          setVaultDocuments((current) => [
            ...current.filter((item) => item.path !== path),
            document,
          ]);
        }
        vaultFileVersionsRef.current.set(path, `${entry.modifiedAt}:${entry.sizeBytes}`);
        setTabs((current) =>
          current.map((candidate) =>
            candidate.id === tab.id && candidate.deferred?.path === path ? replacement : candidate
          )
        );
      } catch (error) {
        if (activeVaultIdRef.current === vaultId)
          setStatus(error instanceof Error ? error.message : `Could not restore ${path}`);
      } finally {
        deferredTabLoadsRef.current.delete(key);
      }
    })();
    deferredTabLoadsRef.current.set(key, load);
    return load;
  };

  const revealSidebarPath = (targetPath?: string) => {
    setSidebarRevealPath(undefined);
    setSidebarSelectedPath(undefined);
    if (revealPathTimerRef.current) {
      window.clearTimeout(revealPathTimerRef.current);
      revealPathTimerRef.current = undefined;
    }
    if (!targetPath) return;
    const parts = targetPath.split("/").filter(Boolean).slice(0, -1);
    if (parts.length === 0) return;
    const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    setExpandedFolders((current) => [...new Set([...current, ...ancestors])].sort());
    for (const path of ancestors) void loadFolderChildren(path);
  };

  const activateLeafTab = (leafId: number, tabId: number) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const tab = tabs.find((candidate) => candidate.id === tabId);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, leafId, (leaf) => ({
        ...leaf,
        view: workspaceTabView(tab),
        activeTabId: tabId,
      }))
    );
    setActiveLeafId(leafId);
    setActiveTabId(tabId);
    if (tab?.deferred) void hydrateDeferredTab(tab);
    revealSidebarPath(tab?.document?.path ?? tab?.pdf?.path ?? tab?.preview?.path);
  };

  const openGraphTab = (leafId = activeLeafId, graphRootPath?: string) => {
    navigationIntentRef.current += 1;
    if (vault) void flushPendingSaves(vault.id);
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    if (!leaf) return;
    const existing = tabs.find(
      (tab) =>
        leaf.tabIds.includes(tab.id) && tab.kind === "graph" && tab.graphRootPath === graphRootPath
    );
    if (existing) {
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, leafId, (current) => ({
          ...current,
          view: "graph",
          activeTabId: existing.id,
        }))
      );
      setActiveLeafId(leafId);
      setActiveTabId(existing.id);
      return;
    }

    const activeTab = tabs.find((tab) => tab.id === leaf.activeTabId);
    const replaceable =
      activeTab &&
      !activeTab.pinned &&
      !activeTab.kind &&
      !activeTab.document &&
      !activeTab.pdf &&
      !activeTab.preview
        ? activeTab
        : undefined;
    const id = replaceable?.id ?? nextTabIdRef.current++;
    const graphTab = createGraphWorkspaceTab(id, graphRootPath);
    setTabs((current) =>
      replaceable ? current.map((tab) => (tab.id === id ? graphTab : tab)) : [...current, graphTab]
    );
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, leafId, (current) => ({
        ...current,
        view: "graph",
        tabIds: replaceable ? current.tabIds : [...current.tabIds, id],
        activeTabId: id,
      }))
    );
    setActiveLeafId(leafId);
    setActiveTabId(id);
  };

  const moveTabToLeaf = (event: DragEvent, targetLeafId: number) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/x-flux-tab");
    if (!payload) return;
    let parsed: { tabId: number; leafId: number };
    try {
      parsed = JSON.parse(payload) as { tabId: number; leafId: number };
    } catch {
      return;
    }
    if (!Number.isInteger(parsed.tabId) || !Number.isInteger(parsed.leafId)) return;
    if (parsed.leafId === targetLeafId) return;
    const tab = tabs.find((candidate) => candidate.id === parsed.tabId);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(
        moveWorkspaceTab(root, parsed.tabId, parsed.leafId, targetLeafId),
        targetLeafId,
        (leaf) => ({ ...leaf, view: workspaceTabView(tab) })
      )
    );
    setActiveLeafId(targetLeafId);
    setActiveTabId(parsed.tabId);
  };

  const moveTabBefore = (event: DragEvent, targetLeafId: number, targetTabId: number) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = event.dataTransfer.getData("application/x-flux-tab");
    if (!payload) return;
    let parsed: { tabId: number; leafId: number };
    try {
      parsed = JSON.parse(payload) as { tabId: number; leafId: number };
    } catch {
      return;
    }
    if (
      !Number.isInteger(parsed.tabId) ||
      !Number.isInteger(parsed.leafId) ||
      parsed.tabId === targetTabId
    )
      return;
    const tab = tabs.find((candidate) => candidate.id === parsed.tabId);
    setWorkspaceRoot((root) => {
      const moved =
        parsed.leafId === targetLeafId
          ? root
          : moveWorkspaceTab(root, parsed.tabId, parsed.leafId, targetLeafId);
      return mapWorkspaceLeaf(moved, targetLeafId, (leaf) => {
        const tabIds = leaf.tabIds.filter((id) => id !== parsed.tabId);
        const targetIndex = tabIds.indexOf(targetTabId);
        tabIds.splice(targetIndex < 0 ? tabIds.length : targetIndex, 0, parsed.tabId);
        return {
          ...leaf,
          view: workspaceTabView(tab),
          tabIds,
          activeTabId: parsed.tabId,
        };
      });
    });
    setActiveLeafId(targetLeafId);
    setActiveTabId(parsed.tabId);
  };

  const workspaceDropZone = (
    event: DragEvent,
    element: HTMLDivElement
  ): "center" | "left" | "right" | "top" | "bottom" => {
    const bounds = element.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (x < 0.22) return "left";
    if (x > 0.78) return "right";
    if (y < 0.22) return "top";
    if (y > 0.78) return "bottom";
    return "center";
  };

  const dropFileIntoWorkspace = (
    event: DragEvent<HTMLDivElement>,
    leaf: Extract<WorkspaceNode, { kind: "leaf" }>
  ) => {
    const path =
      event.dataTransfer.getData("application/x-flux-path") ||
      event.dataTransfer.getData("application/x-flux-file") ||
      event.dataTransfer.getData("text/plain");
    if (!path.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    const zone =
      workspaceFileDrop?.leafId === leaf.id
        ? workspaceFileDrop.zone
        : workspaceDropZone(event, event.currentTarget);
    setWorkspaceFileDrop(undefined);
    if (zone === "center") {
      setActiveLeafId(leaf.id);
      void openDocument(path.trim(), undefined, false, leaf.id);
      return;
    }
    const tab = createWorkspaceTab(nextTabIdRef.current++);
    const newLeafId = nextLeafIdRef.current++;
    const splitId = nextLeafIdRef.current++;
    const newLeaf: Extract<WorkspaceNode, { kind: "leaf" }> = {
      kind: "leaf",
      id: newLeafId,
      view: "editor",
      tabIds: [tab.id],
      activeTabId: tab.id,
    };
    setTabs((current) => [...current, tab]);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, leaf.id, (current) => ({
        kind: "split",
        id: splitId,
        direction: zone === "left" || zone === "right" ? "horizontal" : "vertical",
        children: zone === "left" || zone === "top" ? [newLeaf, current] : [current, newLeaf],
      }))
    );
    setActiveLeafId(newLeafId);
    setActiveTabId(tab.id);
    void openDocument(path.trim(), tab.id, false, newLeafId);
  };

  const wasDroppedAtWindowEdge = (event: DragEvent<HTMLDivElement>) =>
    event.clientX === 0 && event.clientY === 0;

  const openNewNote = (id: number) => {
    updateTab(id, (tab) => ({
      ...tab,
      title: "Untitled",
      document: { title: "Untitled", content: "" },
      mode: "live",
      showBacklinks: false,
      bookmarked: false,
    }));
  };

  const openDemoNote = (id: number) => {
    updateTab(id, (tab) => ({
      ...tab,
      title: DEMO_DOCUMENT.title,
      document: DEMO_DOCUMENT,
      mode: "live",
      showBacklinks: false,
      bookmarked: false,
    }));
  };

  const mergeFile = (id: number, leafId: number) => {
    const source = tabs.find((tab) => tab.id === id)?.document;
    if (!source) return;
    const choices = tabs
      .filter((tab) => tab.id !== id && tab.document)
      .map((tab) => tab.document?.title)
      .filter(Boolean)
      .join(", ");
    const targetTitle = window.prompt(`Merge into file${choices ? ` (${choices})` : ""}`)?.trim();
    if (!targetTitle) return;
    const target = tabs.find((tab) => tab.document?.title === targetTitle);
    if (!target) return;
    updateTab(target.id, (tab) =>
      tab.document
        ? {
            ...tab,
            document: {
              ...tab.document,
              content: `${tab.document.content.trimEnd()}\n\n${source.content.trimStart()}`,
            },
          }
        : tab
    );
    closeLeafTab(leafId, id);
    setActiveTabId(target.id);
  };

  const getNextValidHistoryIndex = (direction: -1 | 1) => {
    const history = navHistoryRef.current;
    // We want to return if navHistoryTick changes (which forces render)
    // so we can use navHistoryTick to ensure React knows this depends on state
    void navHistoryTick;
    let index = navHistoryIndexRef.current + direction;
    while (index >= 0 && index < history.length) {
      const tabId = history[index];
      if (tabs.some((t) => t.id === tabId)) {
        return index;
      }
      index += direction;
    }
    return -1;
  };

  const handleGoBack = () => {
    const prevIndex = getNextValidHistoryIndex(-1);
    if (prevIndex !== -1) {
      isNavigatingHistory.current = true;
      navHistoryIndexRef.current = prevIndex;
      setNavHistoryTick((t) => t + 1);
      const tabId = navHistoryRef.current[prevIndex];
      let targetLeafId = activeLeafId;
      const leafMatch = workspaceLeaves(workspaceRoot).find((l) => l.tabIds.includes(tabId));
      if (leafMatch) {
        targetLeafId = leafMatch.id;
      }
      activateLeafTab(targetLeafId, tabId);
    }
  };

  const handleGoForward = () => {
    const nextIndex = getNextValidHistoryIndex(1);
    if (nextIndex !== -1) {
      isNavigatingHistory.current = true;
      navHistoryIndexRef.current = nextIndex;
      setNavHistoryTick((t) => t + 1);
      const tabId = navHistoryRef.current[nextIndex];
      let targetLeafId = activeLeafId;
      const leafMatch = workspaceLeaves(workspaceRoot).find((l) => l.tabIds.includes(tabId));
      if (leafMatch) {
        targetLeafId = leafMatch.id;
      }
      activateLeafTab(targetLeafId, tabId);
    }
  };

  const paneFor = (tab: WorkspaceTab, leafId = activeLeafId) => (
    <FluxEditorPane
      title={
        tab.kind === "browser" ? (
          <span className="truncate">{tab.title}</span>
        ) : workspaceTabPath(tab) ? (
          <EditorPathBreadcrumb
            key={workspaceTabPath(tab)!}
            path={workspaceTabPath(tab)!}
            onReveal={revealEditorPath}
            onRename={renamePath}
            onClearReveal={() => {
              setSidebarRevealPath(undefined);
              setSidebarSelectedPath(undefined);
            }}
          />
        ) : (
          tab.title
        )
      }
      canGoBack={getNextValidHistoryIndex(-1) !== -1}
      canGoForward={getNextValidHistoryIndex(1) !== -1}
      onGoBack={handleGoBack}
      onGoForward={handleGoForward}
      headerAction={
        tab.document ? (
          <div className="flex items-center gap-0.5">
            {isTabBookmarked(tab) && (
              <button
                type="button"
                aria-label="Edit bookmark"
                title="Edit bookmark"
                onClick={() =>
                  handleOpenAddBookmark({
                    title: tab.title,
                    path: tab.document?.path,
                  })
                }
                className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50"
              >
                <Bookmark className="size-4 fill-primary text-primary" />
              </button>
            )}
            <MarkdownViewToggle
              mode={tab.mode}
              onModeChange={(mode) => updateTab(tab.id, (current) => ({ ...current, mode }))}
            />
          </div>
        ) : null
      }
      menuContent={
        tab.document ? (
          <MarkdownDocumentMenu
            title={tab.document.title}
            mode={tab.mode}
            showBacklinks={tab.showBacklinks}
            bookmarked={isTabBookmarked(tab)}
            onModeChange={(mode) => updateTab(tab.id, (current) => ({ ...current, mode }))}
            onBacklinksChange={(showBacklinks) => {
              updateTab(tab.id, (current) => ({ ...current, showBacklinks }));
              if (showBacklinks) {
                setRightSidebarPane("backlinks");
              }
            }}
            onBookmarkChange={() =>
              handleOpenAddBookmark({
                title: tab.title,
                path: tab.document?.path,
              })
            }
            onRename={() => renameFile(tab.id)}
            onAddProperty={() => addProperty(tab.id)}
            onFind={() => openFind(tab.id)}
            onDelete={() => {
              if (tab.document?.path) void deletePath(tab.document.path);
              else closeLeafTab(leafId, tab.id);
            }}
            onMerge={() => mergeFile(tab.id, leafId)}
            onVersionHistory={() =>
              window.alert("Version history will appear after this note has saved revisions.")
            }
            onRevealInNavigation={() => setLeftSidebarPane("files")}
            onOpenLinkedView={(view) => {
              if (view === "graph") openGraphTab(leafId, tab.document?.path);
              else setRightSidebarPane(view);
            }}
            onMoveToNewWindow={() => popOutTab(tab)}
            onSplitRight={() => splitLeaf(leafId, "horizontal")}
            onSplitDown={() => splitLeaf(leafId, "vertical")}
            onExportPdf={() => {
              setPdfExportDocument(tab.document ?? null);
              setPdfExportOpen(true);
            }}
          />
        ) : undefined
      }
      {...commandsFor(tab, leafId)}
    >
      {tab.deferred ? (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Loading {tab.title}…
        </div>
      ) : tab.pdf ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              Loading PDF…
            </div>
          }
        >
          <PdfViewer key={tab.pdf.path} title={tab.title} data={tab.pdf.data} />
        </Suspense>
      ) : tab.preview ? (
        <FilePreview
          key={tab.preview.path}
          title={tab.title}
          path={tab.preview.path}
          data={tab.preview.data}
          mimeType={tab.preview.mimeType}
        />
      ) : tab.kind === "browser" ? (
        <BrowserView tab={tab} onClose={() => closeLeafTab(leafId, tab.id)} />
      ) : tab.document ? (
        editorFor(tab)
      ) : (
        <div className="grid h-full place-items-center">
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => openNewNote(tab.id)}
            >
              Create new note (⌘ N)
            </button>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => openDemoNote(tab.id)}
            >
              Go to file (⌘ O)
            </button>
            {!isProtectedNewTab(tab, leafId) ? (
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => closeLeafTab(leafId, tab.id)}
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      )}
    </FluxEditorPane>
  );

  const [loadedBacklinksCount, setLoadedBacklinksCount] = useState(0);
  const backlinkPath = visibleActiveTab?.document?.path;
  const backlinksCount = backlinkPath ? loadedBacklinksCount : 0;
  useEffect(() => {
    let active = true;
    if (!backlinkPath) return;
    void loadDocumentReferences(backlinkPath)
      .then((references) => {
        if (active)
          setLoadedBacklinksCount(new Set(references.linked.map((mention) => mention.source)).size);
      })
      .catch(() => {
        if (active) setLoadedBacklinksCount(0);
      });
    return () => {
      active = false;
    };
  }, [backlinkPath, loadDocumentReferences]);

  const openDocument = async (
    identifier: string,
    targetTabId?: number,
    historyNavigation = false,
    targetLeafId = activeLeafId
  ) => {
    const navigationIntent = ++navigationIntentRef.current;
    if (vault) void flushPendingSaves(vault.id);
    const exactEntry = vault ? fileEntries.find((entry) => entry.path === identifier) : undefined;
    const titleMatches = vault
      ? fileEntries.filter(
          (entry) => entry.kind === "markdown" && titleFromPath(entry.path) === identifier
        )
      : [];
    const requestedEntry = exactEntry ?? (titleMatches.length === 1 ? titleMatches[0] : undefined);
    const requestedPath = vault
      ? (requestedEntry?.path ??
        vaultDocuments.find((document) => document.title === identifier)?.path ??
        (/\.(md|markdown)$/i.test(identifier) ? identifier : undefined))
      : undefined;
    const existing =
      targetTabId === undefined
        ? tabs.find((tab) =>
            requestedPath
              ? tab.document?.path === requestedPath ||
                tab.pdf?.path === requestedPath ||
                tab.preview?.path === requestedPath ||
                tab.deferred?.path === requestedPath
              : tab.document?.title === identifier
          )
        : undefined;
    if (existing) {
      setActiveTabId(existing.id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, targetLeafId, (leaf) => ({
          ...leaf,
          view: "editor",
          tabIds: leaf.tabIds.includes(existing.id) ? leaf.tabIds : [...leaf.tabIds, existing.id],
          activeTabId: existing.id,
        }))
      );
      if (existing.deferred) void hydrateDeferredTab(existing);
      revealSidebarPath(existing.document?.path ?? existing.pdf?.path ?? existing.preview?.path);
      return;
    }

    const placeTab = (create: (id: number) => WorkspaceTab) => {
      if (navigationIntentRef.current !== navigationIntent) return;
      if (targetTabId !== undefined) {
        setTabs((current) =>
          current.map((tab) => {
            if (tab.id === targetTabId) {
              const replacement = create(targetTabId);
              let newHistory = tab.history || [];
              let newIndex = tab.historyIndex ?? -1;
              if (!historyNavigation) {
                newHistory = newHistory.slice(0, newIndex + 1);
                const newPath =
                  replacement.document?.path ??
                  replacement.pdf?.path ??
                  replacement.preview?.path ??
                  replacement.title;
                if (newHistory[newHistory.length - 1] !== newPath) {
                  newHistory.push(newPath);
                }
                newIndex = newHistory.length - 1;
              }
              return {
                ...tab,
                title: replacement.title,
                document: replacement.document,
                pdf: replacement.pdf,
                preview: replacement.preview,
                history: historyNavigation ? tab.history : newHistory,
                historyIndex: historyNavigation ? tab.historyIndex : newIndex,
              };
            }
            return tab;
          })
        );
        return;
      }
      const leaf = findWorkspaceLeaf(workspaceRoot, targetLeafId);
      const emptyTab = leaf
        ? tabs.find(
            (tab) =>
              tab.id === leaf.activeTabId &&
              !tab.kind &&
              !tab.document &&
              !tab.pdf &&
              !tab.preview &&
              !tab.deferred &&
              !tab.pinned
          )
        : undefined;
      if (emptyTab) {
        const replacement = create(emptyTab.id);
        setTabs((current) => current.map((tab) => (tab.id === emptyTab.id ? replacement : tab)));
        setActiveTabId(emptyTab.id);
        setWorkspaceRoot((root) =>
          mapWorkspaceLeaf(root, targetLeafId, (current) => ({
            ...current,
            view: "editor",
            activeTabId: emptyTab.id,
          }))
        );
        return;
      }
      const id = nextTabIdRef.current++;
      setTabs((current) => [...current, create(id)]);
      setActiveTabId(id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, targetLeafId, (leaf) => ({
          ...leaf,
          view: "editor",
          tabIds: [...leaf.tabIds, id],
          activeTabId: id,
        }))
      );
    };

    if (requestedEntry?.kind === "binary") {
      if (!runtime.client || !vault) return;
      try {
        const data = await runWithToast(
          runtime.client.readBinaryFile(vault.id, requestedEntry.path),
          {
            loading: `Opening ${requestedEntry.name}…`,
            success: `Opened ${requestedEntry.name}`,
            error: `Could not open ${requestedEntry.name}`,
          }
        );
        if (/\.pdf$/i.test(requestedEntry.path)) {
          placeTab((id) => ({
            ...createWorkspaceTab(id),
            title: fileTitleFromPath(requestedEntry.path),
            pdf: { path: requestedEntry.path, data },
          }));
          return;
        }
        const mimeType = mimeTypeForPath(requestedEntry.path);
        const text = decodedText(data);
        if (!/^(image|audio|video)\//.test(mimeType) && text !== null) {
          const file = await runtime.client.readFile(vault.id, requestedEntry.path);
          const document: DemoDocument = {
            title: titleFromPath(file.path),
            path: file.path,
            content: file.content,
            contentHash: file.contentHash,
          };
          savedDocumentsRef.current.set(file.path, document);
          setVaultDocuments((current) => [
            ...current.filter((item) => item.path !== file.path),
            document,
          ]);
          placeTab((id) => createWorkspaceTab(id, document));
          revealSidebarPath(document.path);
          return;
        }
        placeTab((id) => ({
          ...createWorkspaceTab(id),
          title: fileTitleFromPath(requestedEntry.path),
          preview: { path: requestedEntry.path, data, mimeType },
        }));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Open file failed");
      }
      return;
    }

    let document = requestedPath
      ? vaultDocuments.find((candidate) => candidate.path === requestedPath)
      : documents.find((candidate) => candidate.title === identifier);
    if (!document && requestedPath && runtime.client && vault) {
      try {
        const file = await runtime.client.readFile(vault.id, requestedPath);
        document = {
          title: titleFromPath(file.path),
          path: file.path,
          content: file.content,
          contentHash: file.contentHash,
        };
        savedDocumentsRef.current.set(file.path, document);
        const entry = fileEntries.find((candidate) => candidate.path === file.path);
        if (entry)
          vaultFileVersionsRef.current.set(file.path, `${entry.modifiedAt}:${entry.sizeBytes}`);
        setVaultDocuments((current) => [
          ...current.filter((item) => item.path !== file.path),
          document!,
        ]);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Open file failed");
        return;
      }
    }
    if (!document) return;
    placeTab((id) => createWorkspaceTab(id, document));
    revealSidebarPath(document.path);
  };

  const createNote = async (parent = "", requestedName = "Untitled") => {
    if (vault && runtime.client) {
      const navigationIntent = ++navigationIntentRef.current;
      const titles = new Set(fileEntries.map((entry) => entry.path.toLocaleLowerCase()));
      let suffix = 0;
      const base = requestedName.replace(/\.(md|markdown)$/i, "") || "Untitled";
      let path = markdownPath(parent, base);
      while (titles.has(path.toLocaleLowerCase()))
        path = markdownPath(parent, `${base} ${++suffix}`);
      try {
        await runWithToast(
          (async () => {
            const file = await runtime.client!.createFile({
              vaultId: vault.id,
              path,
              content: "---\ntags: []\n---\n\n",
            });
            await refreshFiles();
            if (navigationIntentRef.current === navigationIntent) await openDocument(file.path);
            setStatus(`Created note · ${file.path}`);
          })(),
          {
            loading: `Creating ${titleFromPath(path)}…`,
            success: `Created ${titleFromPath(path)}`,
            error: `Could not create ${titleFromPath(path)}`,
          }
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Create note failed");
      }
      return;
    }
    const base = "Untitled";
    let suffix = 0;
    let title = base;
    const titles = new Set(documents.map((document) => document.title));
    while (titles.has(title)) title = `${base} ${++suffix}`;
    const document = { title, content: "---\ntags: []\n---\n\n" };
    const id = nextTabIdRef.current++;
    setTabs((current) => [...current, createWorkspaceTab(id, document)]);
    setActiveTabId(id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [...leaf.tabIds, id],
        activeTabId: id,
      }))
    );
  };

  const openDailyNote = async (date: string) => {
    if (!vault || !runtime.client) return;
    const path = `${dailyNoteConfig.dailyFolder}/${noteFileName(
      date,
      dailyNoteConfig.dailyFormat
    )}`;
    try {
      await runtime.client.createDirectory(vault.id, dailyNoteConfig.dailyFolder);
      const existing = await runtime.client.getFileMetadata(vault.id, path);
      if (!existing) {
        try {
          const content = await noteTemplate(
            runtime.client,
            vault.id,
            dailyNoteConfig.dailyTemplate,
            `# ${date}\n\n`,
            { date }
          );
          await runtime.client.createFile({
            vaultId: vault.id,
            path,
            content,
          });
          await refreshFiles();
        } catch {
          // A simultaneous capture may have created today's note.
        }
      }
      setCalendarOpen(false);
      await openDocument(path);
    } catch (cause) {
      setStatus(errorMessage(cause));
    }
  };

  const openWeeklyNote = async (date: string) => {
    if (!vault || !runtime.client) return;
    const week = isoWeekKey(dateFromKey(date));
    const path = `${dailyNoteConfig.weeklyFolder}/${noteFileName(
      date,
      dailyNoteConfig.weeklyFormat,
      true
    )}`;
    try {
      await runtime.client.createDirectory(vault.id, dailyNoteConfig.weeklyFolder);
      if (!(await runtime.client.getFileMetadata(vault.id, path))) {
        try {
          const content = await noteTemplate(
            runtime.client,
            vault.id,
            dailyNoteConfig.weeklyTemplate,
            `# ${week}\n\n`,
            { date, week }
          );
          await runtime.client.createFile({
            vaultId: vault.id,
            path,
            content,
          });
          await refreshFiles();
        } catch {
          // Another window won create race.
        }
      }
      setCalendarOpen(false);
      await openDocument(path);
    } catch (cause) {
      setStatus(errorMessage(cause));
    }
  };

  const handleRuntimeCommand = useEffectEvent(
    (command: "search" | "daily-today" | "calendar" | "settings") => {
      if (command === "search") setLeftSidebarPane("search");
      if (command === "daily-today") void openDailyNote(localDateKey());
      if (command === "calendar") setCalendarOpen(true);
      if (command === "settings") setSettingsOpen(true);
    }
  );
  useEffect(() => runtime.onCommand?.(handleRuntimeCommand), [runtime]);

  const popOutTab = (tab: WorkspaceTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("popout", tab.title);
    if (runtime.openWindow) void runtime.openWindow(url.toString());
    else window.open(url.toString(), "_blank", "popup,width=960,height=720");
  };

  useEffect(() => {
    let active = true;
    const connect = async () => {
      try {
        windowIdRef.current = (await runtime.getWindowId?.()) || "main";
        const [appBootstrap, settings] = await Promise.all([
          statePersistence.loadBootstrap(windowIdRef.current),
          statePersistence.loadAppSettings(),
        ]);
        if (!active) return;
        hydrateAppState(settings);
        setSettingsHydrated(true);
        if (runtime.client) {
          const [recent, available] = await Promise.all([
            runtime.client.listRecentVaults(),
            runtime.client.listAvailableVaults(),
          ]);
          setRecentVaults(recent);
          setAvailableVaults(available);
          const server = await getBootstrapStatus(runtime.client);
          if (!active) return;
          const lastPath = appBootstrap.lastVaultPath;
          if (lastPath) {
            const openIntent = ++vaultOpenIntentRef.current;
            try {
              setInitializationPhase("vault");
              setStatus("Loading vault…");
              const info = await runtime.client.openVault({ path: lastPath });
              if (!(await loadVault(info, openIntent))) return;
              return;
            } catch {
              if (vaultOpenIntentRef.current === openIntent)
                await statePersistence.forgetLastVault();
            }
          }
          setAppVault(null, "active", null);
          setStatus(`Go backend ${server.version} connected · no vault open`);
          setVaultPickerOpen(true);
        } else {
          const message = await runtime.connect();
          if (active) setStatus(message);
        }
      } catch (error) {
        if (active) {
          setLifecycle("degraded", null);
          setStatus(error instanceof Error ? error.message : "Runtime unavailable");
        }
      }
    };
    void connect();

    return () => {
      active = false;
    };
    // Runtime object is shell-owned and stable; reconnect only when shell changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  const renderWorkspaceLeaf = (leaf: Extract<WorkspaceNode, { kind: "leaf" }>) => {
    const leafTabs = leaf.tabIds
      .map((id) => tabs.find((tab) => tab.id === id))
      .filter((tab): tab is WorkspaceTab => Boolean(tab));
    const leafActiveTab = leafTabs.find((tab) => tab.id === leaf.activeTabId) ?? leafTabs[0];
    const leafTitle =
      leaf.view === "graph"
        ? "Graph view"
        : leaf.view === "pdf"
          ? "PDF viewer"
          : leafActiveTab?.title;
    const soleProtectedNewTab = leafActiveTab ? isProtectedNewTab(leafActiveTab, leaf.id) : false;

    return (
      <div
        data-workspace-active={leaf.id === activeLeafId}
        className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent"
        onPointerDownCapture={() => {
          setActiveLeafId(leaf.id);
          if (leafActiveTab) setActiveTabId(leafActiveTab.id);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-flux-tab")) {
            event.preventDefault();
            return;
          }
          if (
            event.dataTransfer.types.includes("application/x-flux-path") ||
            event.dataTransfer.types.includes("application/x-flux-file")
          ) {
            event.preventDefault();
            setWorkspaceFileDrop({
              leafId: leaf.id,
              zone: workspaceDropZone(event, event.currentTarget),
            });
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setWorkspaceFileDrop(undefined);
        }}
        onDropCapture={(event) => {
          if (event.dataTransfer.types.includes("application/x-flux-tab")) {
            if ((event.target as HTMLElement).closest('[role="tab"]')) return;
            event.stopPropagation();
            moveTabToLeaf(event, leaf.id);
            return;
          }
          dropFileIntoWorkspace(event, leaf);
        }}
      >
        {workspaceFileDrop?.leafId === leaf.id ? (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute z-40 rounded-md border-2 border-primary/55 bg-primary/15 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_18%,transparent)] ${
              workspaceFileDrop.zone === "left"
                ? "inset-y-2 left-2 w-[38%]"
                : workspaceFileDrop.zone === "right"
                  ? "inset-y-2 right-2 w-[38%]"
                  : workspaceFileDrop.zone === "top"
                    ? "inset-x-2 top-2 h-[38%]"
                    : workspaceFileDrop.zone === "bottom"
                      ? "inset-x-2 bottom-2 h-[38%]"
                      : "inset-3"
            }`}
          />
        ) : null}
        <div
          className={`h-11 shrink-0 bg-[var(--window-chrome-active)] group-data-[window-active=false]/layout:bg-sidebar ${
            leftEdgeLeafIds.has(leaf.id) ? "pl-[var(--flux-titlebar-left-inset)]" : ""
          } ${rightEdgeLeafIds.has(leaf.id) ? "pr-[var(--flux-titlebar-right-inset)]" : ""}`}
        >
          <FluxTabBar
            className="px-2"
            inlineAction={<FluxTabAddButton onClick={addTab} />}
            actions={
              <FluxTabMenu
                tabs={leafTabs.map((tab) => ({
                  id: tab.id,
                  label: tab.title,
                  active: tab.id === leafActiveTab?.id,
                }))}
                stacked={Boolean(leaf.stacked)}
                onStackedChange={(stacked) =>
                  setWorkspaceRoot((root) =>
                    mapWorkspaceLeaf(root, leaf.id, (current) => ({
                      ...current,
                      view: "editor",
                      stacked,
                    }))
                  )
                }
                onCloseAll={() => closeAllTabs(leaf.id)}
                onSelect={(id) => activateLeafTab(leaf.id, Number(id))}
              />
            }
          >
            <LayoutGroup id={`flux-leaf-tabs-${leaf.id}`}>
              <AnimatePresence initial={false}>
                {!leaf.stacked &&
                  leafTabs.map((tab) => (
                    <FluxTabContextMenu key={tab.id} {...commandsFor(tab, leaf.id)}>
                      <FluxTab
                        active={tab.id === leafActiveTab?.id}
                        closeable={
                          !tab.pinned && !(soleProtectedNewTab && tab.id === leafActiveTab?.id)
                        }
                        pinned={tab.pinned}
                        draggable
                        onNativeDragStart={(event) =>
                          markDraggedTab(event, tab.title, tab.id, leaf.id)
                        }
                        onNativeDragEnd={(event) => {
                          if (wasDroppedAtWindowEdge(event)) popOutTab(tab);
                        }}
                        onDragOver={(event) => {
                          if (event.dataTransfer.types.includes("application/x-flux-tab"))
                            event.preventDefault();
                        }}
                        onDrop={(event) => moveTabBefore(event, leaf.id, tab.id)}
                        onClick={() => activateLeafTab(leaf.id, tab.id)}
                        onClose={(event) => {
                          event.stopPropagation();
                          closeLeafTab(leaf.id, tab.id);
                        }}
                      >
                        {tab.id === leafActiveTab?.id ? leafTitle : tab.title}
                      </FluxTab>
                    </FluxTabContextMenu>
                  ))}
              </AnimatePresence>
            </LayoutGroup>
          </FluxTabBar>
        </div>
        <div className="flux-surface m-1 min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-sidebar">
          {leaf.view === "editor" && leaf.stacked && leafTabs.length > 0 ? (
            <div className="flux-stacked-viewport h-full min-h-0 min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_45%,transparent)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:block [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-corner]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_oklab,var(--muted-foreground)_45%,transparent)] [&::-webkit-scrollbar-thumb]:bg-clip-padding [&::-webkit-scrollbar-track]:bg-transparent">
              <LayoutGroup id={`flux-stacked-tabs-${leaf.id}`}>
                <div className="flex h-full w-max min-w-full">
                  <AnimatePresence initial={false}>
                    {leafTabs.map((tab) =>
                      tab.id === leafActiveTab?.id ? (
                        <m.div
                          key={tab.id}
                          layout
                          className="flex h-full min-w-64 flex-1"
                          transition={{
                            layout: { type: "spring", visualDuration: 0.24, bounce: 0 },
                          }}
                        >
                          <FluxTabContextMenu {...commandsFor(tab, leaf.id)}>
                            <FluxStackedTab
                              active
                              closeable={!tab.pinned && !isProtectedNewTab(tab, leaf.id)}
                              pinned={tab.pinned}
                              draggable
                              onNativeDragStart={(event) =>
                                markDraggedTab(event, tab.title, tab.id, leaf.id)
                              }
                              onNativeDragEnd={(event) => {
                                if (wasDroppedAtWindowEdge(event)) popOutTab(tab);
                              }}
                              onDragOver={(event) => {
                                if (event.dataTransfer.types.includes("application/x-flux-tab"))
                                  event.preventDefault();
                              }}
                              onDrop={(event) => moveTabBefore(event, leaf.id, tab.id)}
                              onClick={() => activateLeafTab(leaf.id, tab.id)}
                              onClose={(event) => {
                                event.stopPropagation();
                                closeLeafTab(leaf.id, tab.id);
                              }}
                            >
                              {tab.title}
                            </FluxStackedTab>
                          </FluxTabContextMenu>
                          <div className="min-w-[28rem] flex-1 overflow-hidden">
                            {paneFor(tab, leaf.id)}
                          </div>
                        </m.div>
                      ) : (
                        <FluxTabContextMenu key={tab.id} {...commandsFor(tab, leaf.id)}>
                          <FluxStackedTab
                            closeable={!tab.pinned}
                            pinned={tab.pinned}
                            draggable
                            onNativeDragStart={(event) =>
                              markDraggedTab(event, tab.title, tab.id, leaf.id)
                            }
                            onNativeDragEnd={(event) => {
                              if (wasDroppedAtWindowEdge(event)) popOutTab(tab);
                            }}
                            onDragOver={(event) => {
                              if (event.dataTransfer.types.includes("application/x-flux-tab"))
                                event.preventDefault();
                            }}
                            onDrop={(event) => moveTabBefore(event, leaf.id, tab.id)}
                            onClick={() => activateLeafTab(leaf.id, tab.id)}
                            onClose={(event) => {
                              event.stopPropagation();
                              closeLeafTab(leaf.id, tab.id);
                            }}
                          >
                            {tab.title}
                          </FluxStackedTab>
                        </FluxTabContextMenu>
                      )
                    )}
                  </AnimatePresence>
                </div>
              </LayoutGroup>
            </div>
          ) : leaf.view === "graph" ? (
            <Suspense
              fallback={
                <div className="grid h-full place-items-center text-xs text-muted-foreground">
                  Loading graph…
                </div>
              }
            >
              <GraphView
                documents={documents}
                vaultGraph={vaultGraph}
                activePath={leafActiveTab?.graphRootPath}
                bookmarked={leafActiveTab ? isTabBookmarked(leafActiveTab) : false}
                onBookmarkChange={() => {
                  if (leafActiveTab) {
                    handleOpenAddBookmark({
                      title: leafActiveTab.title,
                      path: leafActiveTab.document?.path,
                    });
                  }
                }}
                onOpenDocument={openDocument}
                onSplitRight={() => splitLeaf(leaf.id, "horizontal")}
                onSplitDown={() => splitLeaf(leaf.id, "vertical")}
              />
            </Suspense>
          ) : leaf.view === "pdf" ? (
            <FluxEditorPane
              title="PDF viewer"
              {...(leafActiveTab ? commandsFor(leafActiveTab, leaf.id) : {})}
            >
              <Suspense
                fallback={
                  <div className="grid h-full place-items-center text-xs text-muted-foreground">
                    Loading PDF…
                  </div>
                }
              >
                {leafActiveTab?.pdf ? (
                  <PdfViewer
                    key={leafActiveTab.pdf.path}
                    title={leafActiveTab.title}
                    data={leafActiveTab.pdf.data}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-muted-foreground">
                    No PDF selected
                  </div>
                )}
              </Suspense>
            </FluxEditorPane>
          ) : leafActiveTab ? (
            paneFor(leafActiveTab, leaf.id)
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Main area
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <FluxLayout
            key={sessionVaultId || "initial"}
            windowControlsInset={windowControlsInset}
            mainExtendsIntoTitlebar
            leftSidebarHeader={
              <WorkspaceSidebarHeader
                side="left"
                active={effectiveLeftSidebarPane}
                onChange={setLeftSidebarPane}
                plugins={plugins}
              />
            }
            rightSidebarHeader={
              <WorkspaceSidebarHeader
                side="right"
                active={rightSidebarPane}
                onChange={setRightSidebarPane}
                plugins={plugins}
              />
            }
            stickySidebar={
              <WorkspaceRibbon
                onGraph={() => {
                  if (plugins["graph-view"] !== false) openGraphTab(activeLeafId);
                }}
                onFiles={() => {
                  if (plugins["file-explorer"] !== false) setLeafView(activeLeafId, "editor");
                }}
                onPlugins={openPluginManager}
                onCanvas={() => {
                  if (plugins["canvas"] !== false) openDocument("Canvas");
                }}
                onCalendar={() => setCalendarOpen(true)}
                plugins={plugins}
                pluginItems={pluginRibbonItems}
              />
            }
            leftSidebar={
              pluginView && pluginViewLocation === "left-sidebar" ? (
                <PluginSurface
                  view={pluginView}
                  revision={pluginRuntimeRevision}
                  onClose={() => setPluginView(undefined)}
                  invokeCapability={invokePluginViewCapability}
                  showHeader={false}
                />
              ) : (
                <WorkspaceLeftSidebar
                  activeTitle={visibleActiveTab?.title ?? ""}
                  activePath={activeFilePath}
                  revealPath={sidebarRevealPath}
                  onClearRevealPath={() => setSidebarRevealPath(undefined)}
                  pane={effectiveLeftSidebarPane}
                  documents={documents}
                  onOpenDocument={(path) => void openDocument(path)}
                  onOpenPdf={() => setLeafView(activeLeafId, "pdf")}
                  onCreateNote={(parent, name) => void createNote(parent, name)}
                  vaultEntries={vault ? fileEntries : undefined}
                  onCreateFolder={(parent, name) => void createFolder(parent, name)}
                  onMovePath={(source, destination) => {
                    if (
                      window.confirm(
                        `Move "${source}" to "${destination}"?\n\nLinks and backlinks will be updated.`
                      )
                    )
                      void movePath(source, destination);
                  }}
                  onRenamePath={renamePath}
                  onDeletePath={(path) => void deletePath(path)}
                  onArchivePath={(path) => void archivePath(path)}
                  onOpenTrash={() => void openTrash()}
                  onPreviewPath={async (path) => {
                    if (!runtime.client || !vault) return null;
                    return (await runtime.client.readFile(vault.id, path)).content;
                  }}
                  bookmarks={bookmarks}
                  bookmarkGroups={bookmarkGroups}
                  onRemoveBookmark={handleRemoveBookmark}
                  onOpenAddBookmark={() => handleOpenAddBookmark()}
                  onCreateBookmarkGroup={handleCreateBookmarkGroup}
                  expandedFolders={expandedFolders}
                  onExpandedFoldersChange={setExpandedFolders}
                  onExpandFolder={(path) => void loadFolderChildren(path)}
                  searchVault={searchVaultIndex}
                  searchQuery={sidebarSearchQuery}
                  onSearchQueryChange={setSidebarSearchQuery}
                  selectedPath={sidebarSelectedPath}
                  onSelectPath={setSidebarSelectedPath}
                />
              )
            }
            main={
              pluginView && pluginViewLocation === "workspace" ? (
                <PluginSurface
                  view={pluginView}
                  revision={pluginRuntimeRevision}
                  onClose={() => setPluginView(undefined)}
                  invokeCapability={invokePluginViewCapability}
                />
              ) : (
                <div className="relative flex h-full min-h-0 min-w-0 flex-col">
                  {lifecycle === "degraded" ? (
                    <DegradedBanner onRebuild={() => void rebuildIndex()} />
                  ) : null}
                  <div className="min-h-0 flex-1">
                    <WorkspaceTree node={workspaceRoot} renderLeaf={renderWorkspaceLeaf} />
                  </div>
                </div>
              )
            }
            rightSidebar={
              pluginView && pluginViewLocation === "right-sidebar" ? (
                <PluginSurface
                  view={pluginView}
                  revision={pluginRuntimeRevision}
                  onClose={() => setPluginView(undefined)}
                  invokeCapability={invokePluginViewCapability}
                  showHeader={false}
                />
              ) : (
                <WorkspaceRightSidebar
                  pane={rightSidebarPane}
                  activeDocument={visibleActiveTab?.document ?? null}
                  documents={documents}
                  onOpenDocument={openDocument}
                  loadReferences={loadDocumentReferences}
                  loadFacets={loadVaultFacets}
                  onSearchTag={(tag) => {
                    setSidebarSearchQuery(`tag:${tag}`);
                    setLeftSidebarPane("search");
                  }}
                  onNavigateHeading={(heading, line) => {
                    const path = visibleActiveTab?.document?.path;
                    if (!path) return;
                    setHeadingReveal({ path, heading, line, request: Date.now() });
                  }}
                  onOpenReference={(path, line) => {
                    void openDocument(path).then(() =>
                      setHeadingReveal({
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
                activeVaultId={activeVaultId}
                vaults={
                  selectableVaults.length
                    ? selectableVaults.map((candidate) => ({
                        id: candidate.key,
                        label: candidate.name,
                      }))
                    : [{ id: "", label: "No vault" }]
                }
                onVaultChange={(id) => {
                  if (id === activeVaultId) return;
                  const candidate = selectableVaults.find((item) => item.key === id);
                  if (candidate) void openRegisteredVault(candidate);
                }}
                onManageVaults={() => setVaultPickerOpen(true)}
                version="FLUX 0.0.1"
                updateStatus="Up to date"
                connectionStatus={status}
                characters={visibleActiveTab?.document?.content.length ?? 0}
                words={
                  visibleActiveTab?.document?.content.trim().split(/\s+/).filter(Boolean).length ??
                  0
                }
                backlinks={backlinksCount}
                cpuPercent={performanceStats?.cpuPercent}
                memoryMB={performanceStats?.memoryMB}
                themeControl={
                  <div className="flex items-center gap-0 -mr-1">
                    <button
                      type="button"
                      aria-label="Settings"
                      title="Settings"
                      onClick={() => setSettingsOpen(true)}
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
            layoutState={layoutState}
            onLayoutChange={setLayoutState}
          />
          {lifecycle === "initializing" || (vault && sessionVaultId !== vault.id) ? (
            <InitializationOverlay phase={initializationPhase} label={status} />
          ) : null}
          {pluginView && pluginViewLocation === "modal" ? (
            <div className="fixed inset-0 z-[210] grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
              <section className="flex h-[min(44rem,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl [border-color:var(--layout-separator)]">
                <header className="flex h-12 shrink-0 items-center justify-between border-b px-4 [border-color:var(--layout-separator)]">
                  <h2 className="text-sm font-semibold">{pluginView.title}</h2>
                  <button
                    type="button"
                    onClick={() => setPluginView(undefined)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                  >
                    Close
                  </button>
                </header>
                <iframe
                  key={`${pluginView.pluginId}:${pluginView.viewId}:${pluginRuntimeRevision}`}
                  title={pluginView.title}
                  sandbox="allow-scripts"
                  srcDoc={sandboxedPluginDocument(pluginView.html)}
                  className="min-h-0 flex-1 bg-background"
                />
              </section>
            </div>
          ) : null}

          {pluginManagerOpen ? (
            <div className="fixed inset-0 z-[190] grid place-items-center bg-black/45 p-4 backdrop-blur-sm">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="plugin-manager-title"
                className="flex h-[min(46rem,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl [border-color:var(--layout-separator)]"
              >
                <header className="flex items-start justify-between border-b px-5 py-4 [border-color:var(--layout-separator)]">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Vault extensions
                    </p>
                    <h2 id="plugin-manager-title" className="mt-1 text-lg font-semibold">
                      Plugins
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Packages stay global. Permissions and state stay with each vault.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPluginManagerOpen(false)}
                    className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
                  >
                    Close
                  </button>
                </header>
                <div className="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)]">
                  <aside className="flex min-h-0 flex-col border-r bg-muted/20 p-3 [border-color:var(--layout-separator)]">
                    <nav aria-label="Plugin sections" className="space-y-1">
                      {(["marketplace", "installed"] as const).map((section) => (
                        <button
                          key={section}
                          type="button"
                          onClick={() => setPluginSection(section)}
                          className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs capitalize ${
                            pluginSection === section
                              ? "bg-accent font-medium text-accent-foreground"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          }`}
                        >
                          <span>{section}</span>
                          <span className="font-mono text-[9px] opacity-60">
                            {section === "marketplace"
                              ? marketplacePlugins.length
                              : pluginCatalog.length}
                          </span>
                        </button>
                      ))}
                    </nav>
                    <div className="mt-3 border-t pt-3 [border-color:var(--layout-separator)]">
                      <label className="block cursor-pointer rounded-md border px-2.5 py-2 text-center text-xs font-medium hover:bg-accent [border-color:var(--layout-separator)]">
                        {pluginBusy ? "Working…" : "Install from file…"}
                        <input
                          type="file"
                          accept=".flux-plugin,.zip"
                          disabled={pluginBusy}
                          onChange={(event) => void installPlugin(event)}
                          className="sr-only"
                        />
                      </label>
                    </div>
                    <p className="mt-auto border-t pt-3 text-[10px] leading-4 text-muted-foreground [border-color:var(--layout-separator)]">
                      Verified package. Per-vault permissions. Isolated runtime.
                    </p>
                  </aside>
                  <div className="flex min-h-0 min-w-0 flex-col">
                    <div className="border-b p-3 [border-color:var(--layout-separator)]">
                      <label className="flex h-8 items-center rounded-md border bg-background px-3 [border-color:var(--layout-separator)]">
                        <input
                          aria-label="Search plugins"
                          value={pluginQuery}
                          onChange={(event) => setPluginQuery(event.target.value)}
                          placeholder={`Search ${pluginSection} plugins`}
                          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                        />
                      </label>
                    </div>
                    <div className="flux-editor-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                      {pluginSection === "marketplace" ? (
                        filteredMarketplacePlugins.length ? (
                          filteredMarketplacePlugins.map((plugin) => {
                            const installed = pluginCatalog.some(
                              (entry) =>
                                entry.manifest.id === plugin.manifest.id &&
                                entry.manifest.version === plugin.manifest.version
                            );
                            return (
                              <article
                                key={plugin.manifest.id}
                                className="rounded-lg border bg-card px-4 py-3 [border-color:var(--layout-separator)]"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="text-sm font-semibold">
                                        {plugin.manifest.name}
                                      </h3>
                                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                        {plugin.manifest.version}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {plugin.manifest.description || plugin.manifest.id}
                                    </p>
                                    <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                                      {plugin.publisher} · signed registry
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={pluginBusy || installed}
                                    onClick={() => void installMarketplacePlugin(plugin)}
                                    className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                                  >
                                    {installed ? "Installed" : "Install"}
                                  </button>
                                </div>
                                {plugin.readme ? (
                                  <details className="mt-3 border-t pt-2 [border-color:var(--layout-separator)]">
                                    <summary className="cursor-pointer text-xs font-medium">
                                      README
                                    </summary>
                                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-sans text-xs leading-5 text-muted-foreground">
                                      {plugin.readme}
                                    </pre>
                                  </details>
                                ) : null}
                                <a
                                  href={plugin.repository}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-block text-[10px] text-muted-foreground underline underline-offset-2"
                                >
                                  Publisher repository
                                </a>
                              </article>
                            );
                          })
                        ) : (
                          <div className="grid min-h-48 place-items-center rounded-lg border border-dashed px-6 text-center [border-color:var(--layout-separator)]">
                            <div>
                              <p className="text-sm font-medium">Marketplace unavailable</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {marketplaceError || "No plugins published yet."}
                              </p>
                            </div>
                          </div>
                        )
                      ) : filteredPluginCatalog.length ? (
                        filteredPluginCatalog.map((entry) => {
                          const vaultState = vaultPlugins.find(
                            (item) => item.pluginId === entry.manifest.id
                          );
                          const hasPrevious = pluginCatalog.some(
                            (candidate) =>
                              candidate.manifest.id === entry.manifest.id &&
                              candidate.plugin.status === "previous"
                          );
                          const permissions = [
                            ...(entry.manifest.requiredPermissions ?? []),
                            ...(entry.manifest.optionalPermissions ?? []),
                          ];
                          const settings = entry.manifest.contributes?.settings ?? [];
                          return (
                            <article
                              key={`${entry.manifest.id}@${entry.manifest.version}`}
                              className="rounded-lg border bg-card px-4 py-3 [border-color:var(--layout-separator)]"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="truncate text-sm font-semibold">
                                      {entry.manifest.name}
                                    </h3>
                                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                      {entry.manifest.version}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {entry.active ? "Active" : entry.plugin.status}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {entry.manifest.description || entry.manifest.id}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {permissions.length ? (
                                      permissions.map((permission) => (
                                        <span
                                          key={permission}
                                          className="rounded-full border px-2 py-0.5 font-mono text-[9px] text-muted-foreground [border-color:var(--layout-separator)]"
                                        >
                                          {permission}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-[10px] text-muted-foreground">
                                        No vault permissions
                                      </span>
                                    )}
                                  </div>
                                  {entry.active && vaultState?.enabled ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {(entry.manifest.contributes?.commands ?? []).map(
                                        (command) => (
                                          <button
                                            key={command.id}
                                            type="button"
                                            onClick={() =>
                                              void pluginHostRef.current
                                                ?.emit(entry.manifest.id, `command:${command.id}`, {
                                                  commandId: command.id,
                                                })
                                                .then(() =>
                                                  toast.success(`${command.title} finished`)
                                                )
                                                .catch((error) =>
                                                  toast.error(`${command.title} failed`, {
                                                    description:
                                                      error instanceof Error
                                                        ? error.message
                                                        : String(error),
                                                  })
                                                )
                                            }
                                            className="rounded-md border px-2 py-1 text-[10px] [border-color:var(--layout-separator)]"
                                          >
                                            Run {command.title}
                                          </button>
                                        )
                                      )}
                                      {(entry.manifest.contributes?.views ?? []).map((view) => (
                                        <button
                                          key={view.id}
                                          type="button"
                                          onClick={() =>
                                            void openPluginSurface(entry.manifest.id, view)
                                          }
                                          className="rounded-md border px-2 py-1 text-[10px] [border-color:var(--layout-separator)]"
                                        >
                                          Open {view.title}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                  {entry.active && vault && settings.length ? (
                                    <div className="mt-3 space-y-2 border-t pt-3 [border-color:var(--layout-separator)]">
                                      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                                        Vault settings
                                      </p>
                                      {settings.map((setting) => {
                                        const value =
                                          pluginSettings[entry.manifest.id]?.[setting.id] ??
                                          setting.default;
                                        return (
                                          <label
                                            key={`${setting.id}:${String(value)}`}
                                            className="grid gap-1 text-xs"
                                          >
                                            <span className="font-medium">{setting.title}</span>
                                            {setting.type === "boolean" ? (
                                              <input
                                                type="checkbox"
                                                checked={Boolean(value)}
                                                onChange={(event) =>
                                                  void savePluginSetting(
                                                    entry.manifest.id,
                                                    setting.id,
                                                    event.target.checked
                                                  )
                                                }
                                                className="h-4 w-4 accent-foreground"
                                              />
                                            ) : (
                                              <input
                                                type={setting.type === "number" ? "number" : "text"}
                                                defaultValue={value == null ? "" : String(value)}
                                                onBlur={(event) => {
                                                  const nextValue =
                                                    setting.type === "number"
                                                      ? Number(event.target.value)
                                                      : event.target.value;
                                                  if (
                                                    typeof nextValue !== "number" ||
                                                    Number.isFinite(nextValue)
                                                  ) {
                                                    void savePluginSetting(
                                                      entry.manifest.id,
                                                      setting.id,
                                                      nextValue
                                                    );
                                                  }
                                                }}
                                                className="h-8 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring [border-color:var(--layout-separator)]"
                                              />
                                            )}
                                            {setting.description ? (
                                              <span className="text-[10px] text-muted-foreground">
                                                {setting.description}
                                              </span>
                                            ) : null}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                  {!entry.active && entry.plugin.status === "staged" ? (
                                    <button
                                      type="button"
                                      disabled={pluginBusy}
                                      onClick={() =>
                                        void updatePlugin(async () => {
                                          if (vault && vaultState?.enabled) {
                                            await runtime.client!.approvePluginUpdate(
                                              vault.id,
                                              entry.manifest.id,
                                              entry.manifest.version,
                                              permissions
                                            );
                                          }
                                          await runtime.client!.activatePlugin(
                                            entry.manifest.id,
                                            entry.manifest.version
                                          );
                                        })
                                      }
                                      className="rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background disabled:opacity-50"
                                    >
                                      Activate
                                    </button>
                                  ) : null}
                                  {entry.active && vault ? (
                                    vaultState?.enabled ? (
                                      <button
                                        type="button"
                                        disabled={pluginBusy}
                                        onClick={() =>
                                          void updatePlugin(() =>
                                            runtime.client!.disableVaultPlugin(
                                              vault.id,
                                              entry.manifest.id
                                            )
                                          )
                                        }
                                        className="rounded-md border px-2.5 py-1.5 text-xs [border-color:var(--layout-separator)]"
                                      >
                                        Disable
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={pluginBusy}
                                        onClick={() =>
                                          void updatePlugin(() =>
                                            runtime.client!.enableVaultPlugin(
                                              vault.id,
                                              entry.manifest.id,
                                              entry.manifest.requiredPermissions ?? []
                                            )
                                          )
                                        }
                                        className="rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground"
                                      >
                                        Enable here
                                      </button>
                                    )
                                  ) : null}
                                  {entry.active && hasPrevious ? (
                                    <button
                                      type="button"
                                      disabled={pluginBusy}
                                      onClick={() =>
                                        void updatePlugin(() =>
                                          runtime.client!.rollbackPlugin(entry.manifest.id)
                                        )
                                      }
                                      className="rounded-md border px-2.5 py-1.5 text-xs [border-color:var(--layout-separator)]"
                                    >
                                      Roll back
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    disabled={pluginBusy}
                                    onClick={() => {
                                      if (
                                        !window.confirm(
                                          `Remove ${entry.manifest.name}? Plugin files will be removed; vault settings stay recoverable.`
                                        )
                                      )
                                        return;
                                      void updatePlugin(() =>
                                        runtime.client!.uninstallPlugin(
                                          entry.manifest.id,
                                          entry.manifest.version
                                        )
                                      );
                                    }}
                                    className="rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })
                      ) : (
                        <div className="grid min-h-48 place-items-center rounded-lg border border-dashed text-center [border-color:var(--layout-separator)]">
                          <div>
                            <p className="text-sm font-medium">No plugins installed</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Install a verified .flux-plugin package to begin.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {vaultPickerOpen ? (
            <div className="fixed inset-0 z-[180] grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="vault-manager-title"
                className="relative grid h-[min(38rem,calc(100vh-2rem))] w-full max-w-4xl overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl [border-color:var(--layout-separator)] md:grid-cols-[minmax(18rem,0.85fr)_minmax(24rem,1.15fr)]"
              >
                {vault ? (
                  <button
                    type="button"
                    aria-label="Close vault manager"
                    onClick={() => setVaultPickerOpen(false)}
                    className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    Close
                  </button>
                ) : null}
                <div className="flex min-h-0 flex-col border-b bg-muted/20 p-4 md:border-b-0 md:border-r [border-color:var(--layout-separator)]">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Recent vaults
                  </p>
                  <label className="mt-3 flex h-8 items-center rounded-md border bg-background px-2.5 [border-color:var(--layout-separator)]">
                    <input
                      aria-label="Search vaults"
                      value={vaultQuery}
                      onChange={(event) => setVaultQuery(event.target.value)}
                      placeholder="Find a vault"
                      className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    />
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {filteredSelectableVaults.length}
                    </span>
                  </label>
                  <div
                    className="flux-editor-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto"
                    role="list"
                    aria-label="Recent vaults"
                  >
                    {filteredSelectableVaults.map((registered) => {
                      const selected = activeVaultId === registered.key;
                      const recent = recentVaults.find(
                        (candidate) => candidate.path === registered.path
                      );
                      return (
                        <div
                          key={registered.key}
                          role="listitem"
                          className={`group flex items-center rounded-md pr-1 transition-colors ${
                            selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                          }`}
                        >
                          <button
                            type="button"
                            title={registered.path}
                            onClick={() => void openRegisteredVault(registered)}
                            className="min-w-0 flex-1 px-3 py-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className={`size-1.5 rounded-full ${selected ? "bg-primary" : "bg-muted-foreground/35"}`}
                              />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {registered.name}
                              </span>
                              {selected ? (
                                <span className="text-[10px] text-muted-foreground">Open</span>
                              ) : null}
                            </span>
                            <span className="mt-1 block truncate pl-3.5 font-mono text-[10px] text-muted-foreground">
                              {registered.path}
                            </span>
                          </button>
                          {recent && !selected ? (
                            <button
                              type="button"
                              aria-label={`Forget ${registered.name}`}
                              title="Remove from recent vaults"
                              onClick={() => void forgetRegisteredVault(recent.vaultId)}
                              className="rounded px-2 py-1 text-xs text-muted-foreground opacity-0 hover:bg-background/70 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                    {!filteredSelectableVaults.length ? (
                      <p className="rounded-md border border-dashed px-3 py-4 text-xs leading-5 text-muted-foreground [border-color:var(--layout-separator)]">
                        {vaultQuery
                          ? "No vault matches this search."
                          : "Open a folder once and it will remain available here."}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col justify-center p-8">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Flux workspace
                    </p>
                    <div className="mt-5 grid size-14 rotate-3 place-items-center rounded-2xl border bg-muted/40 font-mono text-sm font-semibold shadow-sm [border-color:var(--layout-separator)]">
                      FX
                    </div>
                    <h2
                      id="vault-manager-title"
                      className="mt-5 text-xl font-semibold tracking-tight"
                    >
                      Choose where knowledge lives
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {runtime.vaultAccess === "registry"
                        ? "Open a vault registered on this Flux server. Access remains limited to its configured storage root."
                        : "Open any notes folder, Obsidian vault, Git repository, or empty directory. Derived data stays in its hidden .flux folder."}
                    </p>
                  </div>
                  <div className="mt-8 grid gap-2">
                    {runtime.vaultAccess !== "registry" ? (
                      <button
                        type="button"
                        onClick={() => void chooseVault("open")}
                        className="rounded-md bg-primary px-3 py-3 text-left text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open folder as vault…
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void chooseVault("create")}
                      disabled={!runtime.selectVaultDirectory}
                      className="rounded-md border px-3 py-3 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [border-color:var(--layout-separator)]"
                    >
                      Create new vault…
                    </button>
                    {renameRequest ? (
                      <div className="fixed inset-0 z-[190] grid place-items-center bg-black/35 p-4">
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            renamePath(renameRequest.path, renameRequest.value);
                            setRenameRequest(undefined);
                          }}
                          className="w-full max-w-sm rounded-xl border bg-popover p-5 shadow-2xl [border-color:var(--layout-separator)]"
                        >
                          <label htmlFor="document-rename" className="text-sm font-semibold">
                            Rename file
                          </label>
                          <input
                            id="document-rename"
                            autoFocus
                            value={renameRequest.value}
                            onChange={(event) =>
                              setRenameRequest({ ...renameRequest, value: event.target.value })
                            }
                            className="mt-3 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50 [border-color:var(--layout-separator)]"
                          />
                          <div className="mt-4 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setRenameRequest(undefined)}
                              className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                            >
                              Rename
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {trashOpen ? (
            <div className="fixed inset-0 z-[180] grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="trash-title"
                className="flex h-[min(38rem,82vh)] w-full max-w-3xl flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]"
              >
                <div className="flex items-start justify-between gap-4 border-b px-5 py-4 [border-color:var(--layout-separator)]">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {vault?.name ?? "Vault"} · {trashEntries.length} items
                    </p>
                    <h2 id="trash-title" className="mt-1 text-lg font-semibold">
                      Vault trash
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Items remain recoverable until permanently deleted.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {trashEntries.length ? (
                      <button
                        type="button"
                        onClick={() => setEmptyTrashRequest(true)}
                        className="rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Empty trash
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setTrashOpen(false)}
                      className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="border-b p-3 [border-color:var(--layout-separator)]">
                  <label className="flex h-8 items-center rounded-md border bg-background px-3 [border-color:var(--layout-separator)]">
                    <input
                      aria-label="Search trash"
                      value={trashQuery}
                      onChange={(event) => setTrashQuery(event.target.value)}
                      placeholder="Filter by original path"
                      className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    />
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {filteredTrashEntries.length}
                    </span>
                  </label>
                </div>
                <div className="flux-editor-scroll min-h-0 flex-1 overflow-y-auto p-3">
                  {filteredTrashEntries.length ? (
                    <div className="space-y-1">
                      {filteredTrashEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-[var(--layout-separator)] hover:bg-accent/35"
                        >
                          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted font-mono text-[10px] text-muted-foreground">
                            {entry.originalPath.split(".").pop()?.slice(0, 3).toUpperCase() ||
                              "FILE"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{entry.originalPath}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              Deleted {new Date(entry.deletedAt).toLocaleString()} ·{" "}
                              {entry.sizeBytes.toLocaleString()} bytes
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void restoreTrashEntry(entry)}
                            className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent [border-color:var(--layout-separator)]"
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => setPermanentDeleteRequest(entry)}
                            className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            Delete permanently
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-h-48 place-items-center text-center text-sm text-muted-foreground">
                      <div>
                        <p className="font-medium text-foreground">
                          {trashQuery ? "No matching trash items" : "Trash is empty"}
                        </p>
                        <p className="mt-1 text-xs">
                          {trashQuery
                            ? "Try another path."
                            : "Deleted notes will appear here for recovery."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="border-t px-5 py-3 text-[10px] text-muted-foreground [border-color:var(--layout-separator)]">
                  Flux removes trash older than 30 days when vault opens.
                </div>
              </div>
            </div>
          ) : null}
          {permanentDeleteRequest ? (
            <div className="fixed inset-0 z-[200] grid place-items-center bg-black/55 p-4">
              <div className="w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
                <h2 className="text-base font-semibold">Permanently delete?</h2>
                <p className="mt-3 text-sm leading-5 text-muted-foreground">
                  This permanently deletes{" "}
                  <span className="font-medium text-foreground">
                    {permanentDeleteRequest.originalPath}
                  </span>
                  . This cannot be undone.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPermanentDeleteRequest(undefined)}
                    className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void permanentlyDeleteTrashEntry(permanentDeleteRequest)}
                    className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground"
                  >
                    Delete permanently
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {emptyTrashRequest ? (
            <div className="fixed inset-0 z-[205] grid place-items-center bg-black/60 p-4">
              <div className="w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
                <h2 className="text-base font-semibold">Empty vault trash?</h2>
                <p className="mt-3 text-sm leading-5 text-muted-foreground">
                  This permanently deletes all {trashEntries.length} items. This cannot be undone.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEmptyTrashRequest(false)}
                    className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void emptyTrash()}
                    className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground"
                  >
                    Empty trash
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <PdfExportDialog
            document={pdfExportDocument}
            documents={documents}
            open={pdfExportOpen}
            onOpenChange={setPdfExportOpen}
            onExport={runtime.exportPdf}
          />
          {calendarOpen ? (
            <div className="fixed inset-0 z-[205] grid place-items-center bg-black/50 p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="calendar-title"
                className="w-full max-w-sm rounded-xl border bg-popover p-5 shadow-2xl [border-color:var(--layout-separator)]"
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => {
                      const date = dateFromKey(calendarDate);
                      date.setMonth(date.getMonth() - 1, 1);
                      setCalendarDate(localDateKey(date));
                    }}
                    className="grid size-8 place-items-center rounded-md hover:bg-accent"
                  >
                    ‹
                  </button>
                  <div className="text-center">
                    <h2 id="calendar-title" className="text-sm font-semibold">
                      {calendarMonthLabel}
                    </h2>
                    <p className="text-[10px] text-muted-foreground">
                      Week {isoWeekKey(dateFromKey(calendarDate))}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => {
                      const date = dateFromKey(calendarDate);
                      date.setMonth(date.getMonth() + 1, 1);
                      setCalendarDate(localDateKey(date));
                    }}
                    className="grid size-8 place-items-center rounded-md hover:bg-accent"
                  >
                    ›
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-7 text-center text-[10px] font-medium text-muted-foreground">
                  {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                    <span key={`${day}-${index}`} className="py-1">
                      {day}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {calendarDays.map((day) => {
                    const key = localDateKey(day);
                    const selected = key === calendarDate;
                    const currentMonth = day.getMonth() === dateFromKey(calendarDate).getMonth();
                    const exists = fileEntries.some(
                      (entry) =>
                        entry.path ===
                        `${dailyNoteConfig.dailyFolder}/${noteFileName(
                          key,
                          dailyNoteConfig.dailyFormat
                        )}`
                    );
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-label={key}
                        onClick={() => setCalendarDate(key)}
                        onDoubleClick={() => void openDailyNote(key)}
                        className={`relative grid aspect-square place-items-center rounded-md text-xs ${
                          selected
                            ? "bg-primary text-primary-foreground"
                            : currentMonth
                              ? "hover:bg-accent"
                              : "text-muted-foreground/45 hover:bg-accent"
                        }`}
                      >
                        {day.getDate()}
                        {exists ? (
                          <span
                            aria-hidden="true"
                            className={`absolute bottom-1 size-1 rounded-full ${
                              selected ? "bg-primary-foreground" : "bg-primary"
                            }`}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {fileEntries.some(
                    (entry) =>
                      entry.path ===
                      `${dailyNoteConfig.dailyFolder}/${noteFileName(
                        calendarDate,
                        dailyNoteConfig.dailyFormat
                      )}`
                  )
                    ? "A note exists for this date."
                    : "A new note will be created."}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCalendarOpen(false)}
                    className="rounded-md px-3 py-2 text-sm hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void openWeeklyNote(calendarDate)}
                    className="rounded-md border px-3 py-2 text-sm [border-color:var(--layout-separator)]"
                  >
                    Open week
                  </button>
                  <button
                    type="button"
                    disabled={!calendarDate}
                    onClick={() => void openDailyNote(calendarDate)}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                  >
                    Open daily note
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            onOpenPlugins={() => {
              setSettingsOpen(false);
              openPluginManager();
            }}
            vaultName={vault?.name}
            client={runtime.client}
            vaults={recentVaults}
            vaultId={vault?.id}
            onVaultConfigChange={() => {
              if (!runtime.client || !vault) return;
              void loadDailyNoteConfig(runtime.client, vault.id)
                .then(setDailyNoteConfig)
                .catch((cause) => setStatus(errorMessage(cause)));
            }}
            getMCPServerCommand={runtime.getMCPServerCommand}
            onMenuBarIconChange={runtime.setMenuBarIconEnabled}
            openPublicationPreview={runtime.openPublicationPreview}
          />
          <AddBookmarkDialog
            key={`${bookmarkTarget?.path ?? bookmarkTarget?.title ?? "none"}:${addBookmarkDialogOpen}`}
            open={addBookmarkDialogOpen}
            onOpenChange={setAddBookmarkDialogOpen}
            target={bookmarkTarget}
            existingBookmarks={bookmarks}
            existingGroups={bookmarkGroups}
            onSave={handleSaveBookmark}
            onRemove={handleRemoveBookmark}
            onCreateGroup={handleCreateBookmarkGroup}
          />
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </LazyMotion>
  );
}
