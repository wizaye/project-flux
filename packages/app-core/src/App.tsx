import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
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
import { FluxStatusBar } from "@flux/shared-ui/components/status-bar";
import { TooltipProvider } from "@flux/shared-ui/components/tooltip";
import { Toaster, toast } from "@flux/shared-ui/components/sonner";
import { Bookmark, Settings } from "lucide-react";
import type {
  FileEntry,
  FluxClient,
  RecentVault,
  ServerStatus,
  TrashEntry,
  VaultChange,
  VaultInfo,
  VaultLocation,
  VaultGraph,
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
import { isIgnoredPath, globalBacklinkStore } from "./link-index";
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
  loadBookmarks,
  saveBookmarks,
  loadBookmarkGroups,
  saveBookmarkGroups,
  type BookmarkItem,
} from "./bookmark-store";
import { GraphView } from "./graph-view";
import { PdfExportDialog } from "./pdf-export";
import { SettingsDialog } from "./settings-dialog";
import { useFluxSettings } from "./settings-store";
import { FilePreview } from "./file-preview";
import {
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
import { createWorkspaceTab, type WorkspaceTab } from "./workspace-tabs";
import {
  browserStatePersistence,
  useAppStore,
  type FluxStatePersistence,
  type IndexingProgress,
  type PersistedWorkspaceSession,
  type VaultLifecycleState,
} from "./app-state";

export interface FluxRuntime {
  label: string;
  connect: () => Promise<string>;
  client: FluxClient | null;
  selectVaultDirectory?: (mode: "open" | "create") => Promise<string | null>;
  getPerformanceStats?: () => Promise<FluxPerformanceStats | null>;
  openWindow?: (url: string) => Promise<void>;
  exportPdf?: (options: PdfExportOptions) => Promise<string | null>;
  getWindowId?: () => Promise<string>;
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

function InitializationOverlay({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[190] grid place-items-center bg-background/85 backdrop-blur-sm">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 text-center"
      >
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none"
        />
        <div>
          <p className="text-sm font-medium">Preparing Flux</p>
          <p className="mt-1 max-w-72 truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}

function DegradedBanner({ onRebuild }: { onRebuild: () => void }) {
  return (
    <div
      role="status"
      className="absolute inset-x-3 top-12 z-40 flex items-center gap-3 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur [border-color:var(--layout-separator)]"
    >
      <span className="min-w-0 flex-1 truncate">
        Vault services degraded. Notes remain editable.
      </span>
      <button
        type="button"
        onClick={onRebuild}
        className="shrink-0 rounded-md border px-2 py-1 font-medium hover:bg-accent [border-color:var(--layout-separator)]"
      >
        Rebuild index
      </button>
    </div>
  );
}
const PdfViewer = lazy(() =>
  import("./pdf-viewer").then((module) => ({ default: module.PdfViewer }))
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
  return tab.document?.path ?? tab.pdf?.path ?? tab.preview?.path;
}

function EditorPathBreadcrumb({
  path,
  onReveal,
  onRename,
}: {
  path: string;
  onReveal: (path: string, file: boolean) => void;
  onRename?: (path: string, name: string) => void;
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
                      {index ? <span className="select-none text-muted-foreground/35 mx-[3px] font-normal text-xs">/</span> : null}
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

export function FluxApp({ runtime, windowControlsInset }: FluxAppProps) {
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
  const [performanceStats, setPerformanceStats] = useState<FluxPerformanceStats | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    createWorkspaceTab(1, documentFromLocation()),
  ]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [activeVaultId, setActiveVaultId] = useState("");
  const [sessionVaultId, setSessionVaultId] = useState("");
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [vaultGraph, setVaultGraph] = useState<VaultGraph | null>(null);
  const [vaultDocuments, setVaultDocuments] = useState<DemoDocument[]>([]);
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const [availableVaults, setAvailableVaults] = useState<VaultLocation[]>([]);
  const [renameRequest, setRenameRequest] = useState<{ path: string; value: string }>();
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [permanentDeleteRequest, setPermanentDeleteRequest] = useState<TrashEntry>();
  const [pdfExportDocument, setPdfExportDocument] = useState<DemoDocument | null>(null);
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarSelectedPath, setSidebarSelectedPath] = useState<string | undefined>();
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => loadBookmarks());
  const [bookmarkGroups, setBookmarkGroups] = useState<string[]>(() => loadBookmarkGroups());
  const [addBookmarkDialogOpen, setAddBookmarkDialogOpen] = useState(false);
  const [bookmarkTarget, setBookmarkTarget] = useState<{ title: string; path?: string } | null>(null);
  const [leftSidebarPane, setLeftSidebarPane] = useState<LeftPane>("files");
  const [rightSidebarPane, setRightSidebarPane] = useState<RightPane>("backlinks");
  const [layoutState, setLayoutState] = useState<FluxLayoutState>();
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [nextTabId, setNextTabId] = useState(2);
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
  const savedDocumentsRef = useRef(new Map<string, DemoDocument>());
  const tabsRef = useRef(tabs);
  const fileEntriesRef = useRef<FileEntry[]>([]);
  const vaultFileVersionsRef = useRef(new Map<string, string>());
  const saveTimersRef = useRef(new Map<string, number>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const indexingToastVaultRef = useRef<string | null>(null);
  const lastIndexingProgressRef = useRef<IndexingProgress | null>(null);

  useEffect(() => {
    if (plugins["file-explorer"] === false && leftSidebarPane === "files") {
      if (plugins["search"] !== false) setLeftSidebarPane("search");
      else if (plugins["bookmarks"] !== false) setLeftSidebarPane("bookmarks");
    } else if (plugins["search"] === false && leftSidebarPane === "search") {
      if (plugins["file-explorer"] !== false) setLeftSidebarPane("files");
      else if (plugins["bookmarks"] !== false) setLeftSidebarPane("bookmarks");
    } else if (plugins["bookmarks"] === false && leftSidebarPane === "bookmarks") {
      if (plugins["file-explorer"] !== false) setLeftSidebarPane("files");
      else if (plugins["search"] !== false) setLeftSidebarPane("search");
    }

    if (plugins["graph-view"] === false) {
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaves(root, (leaf) =>
          leaf.view === "graph" ? { ...leaf, view: "editor" } : leaf
        )
      );
    }
  }, [plugins, leftSidebarPane, rightSidebarPane]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeLeaf = findWorkspaceLeaf(workspaceRoot, activeLeafId);
  const visibleActiveTab =
    activeLeaf?.view === "editor"
      ? tabs.find((tab) => tab.id === activeLeaf.activeTabId)
      : undefined;

  const activeFilePath =
    visibleActiveTab?.document?.path ??
    visibleActiveTab?.pdf?.path ??
    visibleActiveTab?.preview?.path;

  useEffect(() => {
    if (activeFilePath) {
      setSidebarSelectedPath(activeFilePath);
      const separator = activeFilePath.lastIndexOf("/");
      if (separator > 0) {
        const folder = activeFilePath.slice(0, separator);
        const parts = folder.split("/").filter(Boolean);
        setExpandedFolders((current) => {
          const next = new Set(current);
          for (let index = 0; index < parts.length; index++) {
            next.add(parts.slice(0, index + 1).join("/"));
          }
          return [...next].sort();
        });
      }
    } else {
      setSidebarSelectedPath(undefined);
    }
  }, [activeFilePath]);
  const documents = useMemo(() => {
    const library = vault ? vaultDocuments : DOCUMENT_LIBRARY;
    const byPath = new Map(library.map((document) => [document.path ?? document.title, document]));
    for (const tab of tabs)
      if (tab.document) byPath.set(tab.document.path ?? tab.document.title, tab.document);
      
    // Include all non-ignored markdown files as stubs for autocomplete and linking
    if (vault) {
      for (const entry of fileEntries) {
        if ((entry.kind === "markdown" || entry.kind === "text") && !isIgnoredPath(entry.path) && !byPath.has(entry.path)) {
          byPath.set(entry.path, { path: entry.path, title: titleFromPath(entry.path), content: "", contentHash: "" });
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
  const leftEdgeLeafIds = useMemo(
    () => new Set(workspaceEdgeLeafIds(workspaceRoot, "left")),
    [workspaceRoot]
  );
  const rightEdgeLeafIds = useMemo(
    () => new Set(workspaceEdgeLeafIds(workspaceRoot, "right")),
    [workspaceRoot]
  );

  useEffect(() => {
    setBookmarks(loadBookmarks(vault?.id));
    setBookmarkGroups(loadBookmarkGroups(vault?.id));
  }, [vault?.id]);

  useEffect(() => {
    saveBookmarks(bookmarks, vault?.id);
  }, [bookmarks, vault?.id]);

  useEffect(() => {
    saveBookmarkGroups(bookmarkGroups, vault?.id);
  }, [bookmarkGroups, vault?.id]);

  const handleOpenAddBookmark = (target?: { title: string; path?: string } | null) => {
    const defaultTarget =
      target ||
      (visibleActiveTab
        ? { title: visibleActiveTab.title, path: visibleActiveTab.document?.path || visibleActiveTab.pdf?.path }
        : null);
    if (!defaultTarget) return;
    setBookmarkTarget(defaultTarget);
    setAddBookmarkDialogOpen(true);
  };

  const handleSaveBookmark = (data: { id?: string; title: string; path: string; group?: string | null }) => {
    if (data.id) {
      setBookmarks((prev) =>
        prev.map((item) =>
          item.id === data.id
            ? { ...item, title: data.title, group: data.group }
            : item
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
      setBookmarks((prev) => [...prev, newItem]);
      setStatus(`Bookmarked ${data.title}`);
    }
  };

  const handleRemoveBookmark = (id: string) => {
    setBookmarks((prev) => prev.filter((item) => item.id !== id));
  };

  const handleCreateBookmarkGroup = (name: string) => {
    if (name && !bookmarkGroups.includes(name)) {
      setBookmarkGroups((prev) => [...prev, name]);
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
    const id = nextTabId;
    setNextTabId((current) => current + 1);
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
  };

  const closeOtherTabs = (id: number) => {
    setTabs((current) => current.filter((tab) => tab.id === id));
    setActiveTabId(id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaves(root, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [id],
        activeTabId: id,
      }))
    );
  };

  const closeTabsAfter = (id: number) => {
    const tabIndex = tabs.findIndex((tab) => tab.id === id);
    if (tabIndex < 0) return;

    const nextTabs = tabs.slice(0, tabIndex + 1);
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId)) setActiveTabId(id);
  };

  const closeAllTabs = () => {
    const replacement = createWorkspaceTab(nextTabId);
    setNextTabId((current) => current + 1);
    setTabs([replacement]);
    setActiveTabId(replacement.id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaves(root, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [replacement.id],
        activeTabId: replacement.id,
      }))
    );
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
    setWorkspaceRoot((root) => mapWorkspaceLeaf(root, id, (leaf) => ({ ...leaf, view })));
    setActiveLeafId(id);
  };

  const splitLeaf = (id: number, direction: "horizontal" | "vertical") => {
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
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!leaf || !tab) return;

    const leaves = workspaceLeaves(workspaceRoot);
    if (leaves.length === 1 && leaf.tabIds.length === 1) {
      if (!tab.document && !tab.pdf && !tab.preview) return;
      const replacement = createWorkspaceTab(nextTabId);
      setNextTabId((current) => current + 1);
      setTabs((current) => [...current.filter((candidate) => candidate.id !== tabId), replacement]);
      setWorkspaceRoot({
        ...leaf,
        view: "editor",
        tabIds: [replacement.id],
        activeTabId: replacement.id,
      });
      setActiveTabId(replacement.id);
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
      return;
    }

    const tabIds = leaf.tabIds.filter((id) => id !== tabId);
    const nextActiveId = leaf.activeTabId === tabId ? tabIds[0] : leaf.activeTabId;
    const nextRoot = mapWorkspaceLeaf(workspaceRoot, leafId, (current) => ({
      ...current,
      view: "editor",
      tabIds,
      activeTabId: nextActiveId,
    }));
    setWorkspaceRoot(nextRoot);
    setActiveTabId(nextActiveId);
    if (!workspaceHasTab(nextRoot, tabId)) {
      setTabs((current) => current.filter((candidate) => candidate.id !== tabId));
    }
  };

  const replaceWorkspaceDocument = (document: DemoDocument | null) => {
    const replacement = createWorkspaceTab(1, document);
    setTabs([replacement]);
    setActiveTabId(1);
    setNextTabId(2);
    setWorkspaceRoot({ kind: "leaf", id: 1, view: "editor", tabIds: [1], activeTabId: 1 });
    setActiveLeafId(1);
  };

  const refreshFiles = async (vaultId = vault?.id) => {
    if (!runtime.client || !vaultId) return [];
    const entries = await runtime.client.listFiles(vaultId);
    fileEntriesRef.current = entries;
    setFileEntries(entries);
    return entries;
  };

  const refreshVaultGraph = async (vaultId = vault?.id) => {
    if (!runtime.client || !vaultId) return null;
    const graph = await runtime.client.getGraph(vaultId);
    setVaultGraph(graph);
    return graph;
  };

  const refreshVaultDocuments = async (vaultId: string, entries: FileEntry[]) => {
    if (!runtime.client) return [];
    const previousDocuments = new Map(savedDocumentsRef.current);
    const markdownEntries = entries.filter(
      (entry) => (entry.kind === "markdown" || entry.kind === "text") && savedDocumentsRef.current.has(entry.path)
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
    // Update the index with the synchronously loaded files, without clearing it
    for (const doc of resolved) {
      globalBacklinkStore.updateSingleDocument(doc);
    }
    
    // Background incremental indexing for ALL remaining markdown files
    // Ensures instant startup while building full-vault backlinks without blocking UI
    const backgroundEntries = entries.filter(
      (entry) => (entry.kind === "markdown" || entry.kind === "text") && !savedDocumentsRef.current.has(entry.path)
    );
    setTimeout(async () => {
      let index = 0;
      const CHUNK = 50;
      while (index < backgroundEntries.length) {
        const chunk = backgroundEntries.slice(index, index + CHUNK);
        const chunkLoaded = await Promise.all(
          chunk.map(async (entry) => {
            try {
              const file = await runtime.client!.readFile(vaultId, entry.path);
              return {
                title: titleFromPath(file.path),
                path: file.path,
                content: file.content,
                contentHash: file.contentHash,
              } satisfies DemoDocument;
            } catch { return null; }
          })
        );
        for (const doc of chunkLoaded) {
          if (doc) globalBacklinkStore.updateSingleDocument(doc);
        }
        index += CHUNK;
        await new Promise((r) => setTimeout(r, 50));
      }
    }, 1000);

    return resolved;
  };

  const loadVault = async (info: VaultInfo) => {
    if (!runtime.client) return;
    setStatus(`Opening ${info.name}…`);
    setAppVault(info, "initializing", null);
    setSessionVaultId("");
    setVault(info);
    setActiveVaultId(info.id);
    setVaultDocuments([]);
    setVaultGraph(null);
    setExpandedFolders([]);
    setLayoutState(undefined);
    savedDocumentsRef.current.clear();
    vaultFileVersionsRef.current.clear();
    const entries = await refreshFiles(info.id);
    void refreshVaultGraph(info.id).catch(() => undefined);
    const persisted = await statePersistence.loadWorkspaceSession(windowIdRef.current, info.id);
    const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
    const requestedTabs = persisted?.tabs ?? [];
    const restored = await Promise.all(
      requestedTabs.map(async ({ id, path, mode, pinned }, index) => {
        try {
          const entry = entryByPath.get(path);
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
    const loaded = restored.flatMap((tab) => (tab ? [tab] : []));
    setVaultDocuments(loaded.flatMap((tab) => (tab.document ? [tab.document] : [])));
    if (!loaded.length) {
      replaceWorkspaceDocument(null);
    } else {
      const active =
        loaded.find(
          (tab) =>
            (tab.document?.path ?? tab.pdf?.path ?? tab.preview?.path) === persisted?.activePath
        ) ?? loaded[0];
      const tabIds = loaded.map((tab) => tab.id);
      const restoredRoot = restoreWorkspaceRoot(persisted?.workspaceRoot, new Set(tabIds));
      const nextRoot: WorkspaceNode = restoredRoot ?? {
        kind: "leaf",
        id: 1,
        view: "editor",
        tabIds,
        activeTabId: active.id,
      };
      setTabs(loaded);
      setActiveTabId(active.id);
      setNextTabId(Math.max(...tabIds) + 1);
      setWorkspaceRoot(nextRoot);
      const restoredActiveLeaf = persisted?.activeLeafId
        ? findWorkspaceLeaf(nextRoot, persisted.activeLeafId)
        : null;
      setActiveLeafId(restoredActiveLeaf?.id ?? workspaceLeaves(nextRoot)[0].id);
      nextLeafIdRef.current = maxWorkspaceNodeId(nextRoot) + 1;
    }
    if (persisted?.leftSidebarPane) setLeftSidebarPane(persisted.leftSidebarPane);
    if (persisted?.rightSidebarPane) {
      setRightSidebarPane(persisted.rightSidebarPane === "outline" ? "backlinks" : persisted.rightSidebarPane);
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
  };

  useEffect(() => {
    if (!vault || sessionVaultId !== vault.id) return;
    const persisted: PersistedWorkspaceSession = {
      version: 1,
      vaultId: vault.id,
      tabs: tabs.flatMap((tab) =>
        tab.document?.path || tab.pdf?.path || tab.preview?.path
          ? [
              {
                id: tab.id,
                path: tab.document?.path ?? tab.pdf?.path ?? tab.preview!.path,
                mode: tab.mode,
                pinned: Boolean(tab.pinned),
              },
            ]
          : []
      ),
      activePath: (() => {
        const tab = tabs.find((candidate) => candidate.id === activeTabId);
        return tab?.document?.path ?? tab?.pdf?.path ?? tab?.preview?.path;
      })(),
      workspaceRoot,
      activeLeafId,
      leftSidebarPane,
      rightSidebarPane,
      layout: layoutState,
      expandedFolders,
    };
    latestSessionRef.current = persisted;
    setStoredWorkspace(persisted);
    window.clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = window.setTimeout(() => {
      sessionSaveChainRef.current = sessionSaveChainRef.current
        .catch(() => undefined)
        .then(() => statePersistence.saveWorkspaceSession(windowIdRef.current, persisted))
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(sessionSaveTimerRef.current);
  }, [
    activeLeafId,
    activeTabId,
    leftSidebarPane,
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

  useEffect(() => {
    const flushSession = () => {
      const persisted = latestSessionRef.current;
      if (!persisted) return;
      window.clearTimeout(sessionSaveTimerRef.current);
      sessionSaveChainRef.current = sessionSaveChainRef.current
        .catch(() => undefined)
        .then(() => statePersistence.saveWorkspaceSession(windowIdRef.current, persisted))
        .catch(() => undefined);
    };
    window.addEventListener("pagehide", flushSession);
    return () => window.removeEventListener("pagehide", flushSession);
  }, [statePersistence]);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    let active = true;
    let applying = Promise.resolve();
    const reconcile = async () => {
      const entries = await runtime.client!.listFiles(vault.id);
      if (!active) return;
      fileEntriesRef.current = entries;
      setFileEntries(entries);
      await Promise.all([refreshVaultDocuments(vault.id, entries), refreshVaultGraph(vault.id)]);
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
      await Promise.all([refreshVaultDocuments(vault.id, entries), refreshVaultGraph(vault.id)]);
    };

    const stop = runtime.client.watchVaultChanges(
      vault.id,
      (change) => {
        if (!active) return;
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
    if (!runtime.client || !vault) return;
    let active = true;
    let timer: number | undefined;

    const refreshLifecycle = async () => {
      try {
        const server = await runtime.client!.getStatus();
        if (!active || server.openVault?.id !== vault.id) return;
        const info = server.openVault as IndexedVaultInfo;
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
    const previousLifecycle = lifecycle;
    const previousProgress = indexing;
    setLifecycle("initializing", null);
    setStatus(mode === "create" ? "Creating vault…" : "Initializing vault…");
    try {
      await runWithToast(
        (async () => {
          const info =
            mode === "create"
              ? await runtime.client!.createVault({ path })
              : await runtime.client!.openVault({ path });
          await loadVault(info);
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
      setLifecycle(previousLifecycle, previousProgress);
      setStatus(error instanceof Error ? error.message : "Vault operation failed");
    }
  };

  const openRegisteredVault = async (registered: { name: string; path: string }) => {
    if (!runtime.client) return;
    const previousLifecycle = lifecycle;
    const previousProgress = indexing;
    setLifecycle("initializing", null);
    setStatus(`Initializing ${registered.name}…`);
    try {
      await runWithToast(
        (async () => {
          const info = await runtime.client!.openVault({ path: registered.path });
          await loadVault(info);
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
      setLifecycle(previousLifecycle, previousProgress);
      setStatus(error instanceof Error ? error.message : "Vault operation failed");
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

  const persistDocument = async (tabId: number, document: DemoDocument, content: string) => {
    if (!runtime.client || !vault || !document.path) return;
    const path = document.path;
    const saved = savedDocumentsRef.current.get(path) ?? document;
    if (!saved.contentHash || saved.content === content) return;
    const result = await runtime.client.patchFile({
      vaultId: vault.id,
      path,
      expectedHash: saved.contentHash,
      edits: [singleTextEdit(saved.content, content)],
    });
    const next = { ...saved, content, contentHash: result.contentHash };
    savedDocumentsRef.current.set(path, next);
    setVaultDocuments((current) =>
      current.map((item) =>
        item.path === path ? { ...item, content, contentHash: result.contentHash } : item
      )
    );
    updateTab(tabId, (tab) =>
      tab.document?.path === path && tab.document.content === content
        ? { ...tab, document: { ...tab.document, contentHash: result.contentHash } }
        : tab
    );
  };

  const enqueueSave = (tabId: number, document: DemoDocument, content: string) => {
    if (!document.path) return Promise.resolve();
    const previous = saveChainsRef.current.get(document.path) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => persistDocument(tabId, document, content));
    saveChainsRef.current.set(document.path, next);
    return next;
  };

  const scheduleSave = (tabId: number, document: DemoDocument, content: string) => {
    if (!document.path || !document.contentHash) return;
    const existing = saveTimersRef.current.get(document.path);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      void enqueueSave(tabId, document, content).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown save error";
        setStatus(`Save failed · ${message}`);
        toast.error(`Could not save ${titleFromPath(document.path!)}`, { description: message });
      });
    }, 500);
    saveTimersRef.current.set(document.path, timer);
  };

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
        for (const tab of tabs) {
          if (!tab.document?.path) continue;
          const timer = saveTimersRef.current.get(tab.document.path);
          if (timer) window.clearTimeout(timer);
          await enqueueSave(tab.id, tab.document, tab.document.content);
        }
        await runtime.client!.moveFile({ vaultId: vault.id, sourcePath, destinationPath });
        setTabs((current) =>
          current.map((tab) => {
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
        await refreshFiles();
        for (const tab of tabs) {
          if (!tab.document?.path) continue;
          const nextPath = movedDocumentPath(tab.document.path, sourcePath, destinationPath);
          const file = await runtime.client!.readFile(vault.id, nextPath);
          const document: DemoDocument = {
            title: titleFromPath(file.path),
            path: file.path,
            content: file.content,
            contentHash: file.contentHash,
          };
          savedDocumentsRef.current.set(file.path, document);
          updateTab(tab.id, (current) => ({ ...current, title: document.title, document }));
          setVaultDocuments((current) => [
            ...current.filter(
              (item) => item.path !== tab.document?.path && item.path !== file.path
            ),
            document,
          ]);
        }
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
    if (general.confirmDeleteNote && !window.confirm(`Are you sure you want to delete "${path}"?`)) return;
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.deleteFile(vault.id, path);
          for (const document of tabs.map((tab) => tab.document)) {
            if (
              !document?.path ||
              (document.path !== path && !document.path.startsWith(`${path}/`))
            )
              continue;
            const timer = saveTimersRef.current.get(document.path);
            if (timer) window.clearTimeout(timer);
            savedDocumentsRef.current.delete(document.path);
          }
          const activePath =
            activeTab?.document?.path ?? activeTab?.pdf?.path ?? activeTab?.preview?.path;
          const activeWasDeleted = activePath === path || activePath?.startsWith(`${path}/`);
          setTabs((current) =>
            current.filter((tab) => {
              const candidate = tab.document?.path ?? tab.pdf?.path ?? tab.preview?.path;
              return !candidate || (candidate !== path && !candidate.startsWith(`${path}/`));
            })
          );
          if (activeWasDeleted) replaceWorkspaceDocument(null);
          setVaultDocuments((current) =>
            current.filter(
              (document) =>
                !document.path || (document.path !== path && !document.path.startsWith(`${path}/`))
            )
          );
          await refreshFiles();
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
        onDropDocument={openDocument}
        onOpenDocument={(identifier, inPlace) => openDocument(identifier, inPlace ? tab.id : undefined)}
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
    setSidebarSelectedPath(folder);
  };

  const commandsFor = (tab: WorkspaceTab, leafId = activeLeafId): FluxTabCommands => {
    const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
    const protectedNewTab = isProtectedNewTab(tab, leafId);

    return {
      pinned: tab.pinned,
      canCloseOthers: tabs.length > 1,
      canCloseAfter: tabIndex >= 0 && tabIndex < tabs.length - 1,
      onClose: protectedNewTab ? undefined : () => closeLeafTab(leafId, tab.id),
      onCloseOthers: () => closeOtherTabs(tab.id),
      onCloseAfter: () => closeTabsAfter(tab.id),
      onCloseAll: closeAllTabs,
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

  const activateLeafTab = (leafId: number, tabId: number) => {
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, leafId, (leaf) => ({
        ...leaf,
        view: tabId === leaf.activeTabId ? leaf.view : "editor",
        activeTabId: tabId,
      }))
    );
    setActiveLeafId(leafId);
    setActiveTabId(tabId);

    const targetTab = tabs.find((t) => t.id === tabId);
    const targetPath = targetTab ? (targetTab.document?.path ?? targetTab.pdf?.path ?? targetTab.preview?.path) : undefined;
    if (targetPath) {
      setSidebarSelectedPath(targetPath);
      const separator = targetPath.lastIndexOf("/");
      if (separator > 0) {
        const folder = targetPath.slice(0, separator);
        const parts = folder.split("/").filter(Boolean);
        setExpandedFolders((current) => {
          const next = new Set(current);
          for (let index = 0; index < parts.length; index++) {
            next.add(parts.slice(0, index + 1).join("/"));
          }
          return [...next].sort();
        });
      }
    }
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
    setWorkspaceRoot((root) => moveWorkspaceTab(root, parsed.tabId, parsed.leafId, targetLeafId));
    setActiveLeafId(targetLeafId);
    setActiveTabId(parsed.tabId);
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

  const paneFor = (tab: WorkspaceTab, leafId = activeLeafId) => (
    <FluxEditorPane
      title={
        workspaceTabPath(tab) ? (
          <EditorPathBreadcrumb
            key={workspaceTabPath(tab)!}
            path={workspaceTabPath(tab)!}
            onReveal={revealEditorPath}
            onRename={renamePath}
          />
        ) : (
          tab.title
        )
      }
      canGoBack={tab.history && tab.historyIndex > 0}
      canGoForward={tab.history && tab.historyIndex < tab.history.length - 1}
      onGoBack={() => {
        if (!tab.history || tab.historyIndex <= 0) return;
        const newIndex = tab.historyIndex - 1;
        updateTab(tab.id, (current) => ({ ...current, historyIndex: newIndex }));
        void openDocument(tab.history[newIndex], tab.id, true);
      }}
      onGoForward={() => {
        if (!tab.history || tab.historyIndex >= tab.history.length - 1) return;
        const newIndex = tab.historyIndex + 1;
        updateTab(tab.id, (current) => ({ ...current, historyIndex: newIndex }));
        void openDocument(tab.history[newIndex], tab.id, true);
      }}
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
              if (view === "graph") setLeafView(leafId, "graph");
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
      {tab.pdf ? (
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

  const [backlinksCount, setBacklinksCount] = useState(0);

  useEffect(() => {
    const updateCount = () => {
      if (visibleActiveTab?.document) {
        const identifier = visibleActiveTab.document.path ?? visibleActiveTab.document.title;
        const mentions = globalBacklinkStore.getLinkedMentions(identifier);
        
        // Deduplicate by source document to count unique backlinking files, not total mentions
        const uniqueSources = new Set(mentions.map((m) => m.source));
        setBacklinksCount(uniqueSources.size);
      } else {
        setBacklinksCount(0);
      }
    };
    
    updateCount();
    const unsubscribe = globalBacklinkStore.subscribe(updateCount);
    return () => {
      unsubscribe();
    };
  }, [visibleActiveTab?.document]);

  const openDocument = async (identifier: string, targetTabId?: number, historyNavigation = false) => {
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
                tab.preview?.path === requestedPath
              : tab.document?.title === identifier
          )
        : undefined;
    if (existing) {
      setActiveTabId(existing.id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
          ...leaf,
          view: "editor",
          tabIds: leaf.tabIds.includes(existing.id) ? leaf.tabIds : [...leaf.tabIds, existing.id],
          activeTabId: existing.id,
        }))
      );
      const targetPath = existing.document?.path ?? existing.pdf?.path ?? existing.preview?.path;
      if (targetPath) {
        setSidebarSelectedPath(targetPath);
        const separator = targetPath.lastIndexOf("/");
        if (separator > 0) {
          const folder = targetPath.slice(0, separator);
          const parts = folder.split("/").filter(Boolean);
          setExpandedFolders((current) => {
            const next = new Set(current);
            for (let index = 0; index < parts.length; index++) {
              next.add(parts.slice(0, index + 1).join("/"));
            }
            return [...next].sort();
          });
        }
      }
      return;
    }

    const placeTab = (create: (id: number) => WorkspaceTab) => {
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

      const leaf = findWorkspaceLeaf(workspaceRoot, activeLeafId);
      const emptyTab =
        leaf?.tabIds.length === 1
          ? tabs.find(
              (tab) =>
                tab.id === leaf.activeTabId &&
                !tab.document &&
                !tab.pdf &&
                !tab.preview &&
                !tab.pinned
            )
          : undefined;
      if (emptyTab) {
        const replacement = create(emptyTab.id);
        setTabs((current) => current.map((tab) => (tab.id === emptyTab.id ? replacement : tab)));
        setActiveTabId(emptyTab.id);
        setWorkspaceRoot((root) =>
          mapWorkspaceLeaf(root, activeLeafId, (current) => ({
            ...current,
            view: "editor",
            activeTabId: emptyTab.id,
          }))
        );
        return;
      }
      const id = nextTabId;
      setNextTabId((current) => current + 1);
      setTabs((current) => [...current, create(id)]);
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
  };

  const createNote = async (parent = "", requestedName = "Untitled") => {
    if (vault && runtime.client) {
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
            await openDocument(file.path);
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
    const id = nextTabId;
    setNextTabId((current) => current + 1);
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

  const updateProperty = (key: string, value: string) => {
    if (!activeTab?.document) return;
    updateTab(activeTab.id, (current) =>
      current.document
        ? {
            ...current,
            document: {
              ...current.document,
              content: setFrontmatterProperty(current.document.content, key, value),
            },
          }
        : current
    );
  };

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
        if (runtime.client) {
          const [recent, available] = await Promise.all([
            runtime.client.listRecentVaults(),
            runtime.client.listAvailableVaults(),
          ]);
          setRecentVaults(recent);
          setAvailableVaults(available);
          const server = await getBootstrapStatus(runtime.client);
          if (!active) return;
          if (server.openVault) {
            await loadVault(server.openVault);
          } else {
            const lastPath = appBootstrap.lastVaultPath;
            if (lastPath) {
              try {
                await loadVault(await runtime.client.openVault({ path: lastPath }));
                return;
              } catch {
                await statePersistence.forgetLastVault();
              }
            }
            setAppVault(null, "active", null);
            setStatus("Go backend connected · no vault open");
            setVaultPickerOpen(true);
          }
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
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
        onPointerDownCapture={() => {
          setActiveLeafId(leaf.id);
          if (leafActiveTab) setActiveTabId(leafActiveTab.id);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-flux-tab")) event.preventDefault();
        }}
        onDrop={(event) => moveTabToLeaf(event, leaf.id)}
      >
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
                onCloseAll={closeAllTabs}
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
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
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
                            layout: { type: "spring", visualDuration: 0.24, bounce: 0.04 },
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
            <GraphView
              documents={documents}
              vaultGraph={vaultGraph}
              activePath={
                leafActiveTab?.document?.path ??
                leafActiveTab?.pdf?.path ??
                leafActiveTab?.preview?.path
              }
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
        <TooltipProvider delayDuration={500} skipDelayDuration={150}>
          <FluxLayout
            key={sessionVaultId || "initial"}
            windowControlsInset={windowControlsInset}
            mainExtendsIntoTitlebar
            leftSidebarHeader={
              <WorkspaceSidebarHeader
                side="left"
                active={leftSidebarPane}
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
                  if (plugins["graph-view"] !== false) setLeafView(activeLeafId, "graph");
                }}
                onFiles={() => {
                  if (plugins["file-explorer"] !== false) setLeafView(activeLeafId, "editor");
                }}
                onCanvas={() => {
                  if (plugins["canvas"] !== false) openDocument("Canvas");
                }}
                plugins={plugins}
              />
            }
            leftSidebar={
              <WorkspaceLeftSidebar
                activeTitle={visibleActiveTab?.title ?? ""}
                activePath={sidebarSelectedPath}
                onSelectPath={setSidebarSelectedPath}
                pane={leftSidebarPane}
                documents={documents}
                onOpenDocument={(path) => void openDocument(path)}
                onOpenPdf={() => setLeafView(activeLeafId, "pdf")}
                onCreateNote={(parent, name) => void createNote(parent, name)}
                vaultEntries={vault ? fileEntries : undefined}
                onCreateFolder={(parent, name) => void createFolder(parent, name)}
                onMovePath={(source, destination) => void movePath(source, destination)}
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
              />
            }
            main={
              <div className="relative h-full min-h-0 min-w-0">
                {lifecycle === "degraded" ? (
                  <DegradedBanner onRebuild={() => void rebuildIndex()} />
                ) : null}
                <WorkspaceTree node={workspaceRoot} renderLeaf={renderWorkspaceLeaf} />
              </div>
            }
            rightSidebar={
              <WorkspaceRightSidebar
                pane={rightSidebarPane}
                activeDocument={visibleActiveTab?.document ?? null}
                documents={documents}
                onOpenDocument={openDocument}
                onPropertyChange={updateProperty}
                onAddProperty={() => addProperty(activeTabId)}
              />
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
                gitStatus="Git · Clean"
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
            storageKey={false}
            layoutState={layoutState}
            onLayoutChange={setLayoutState}
          />
          {lifecycle === "initializing" ? <InitializationOverlay label={status} /> : null}
          {vaultPickerOpen ? (
            <div className="fixed inset-0 z-[180] grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]">
              <div className="grid max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-3xl overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl [border-color:var(--layout-separator)] md:grid-cols-[minmax(0,0.9fr)_minmax(20rem,1.1fr)]">
                <div className="min-h-0 border-b bg-muted/20 p-4 md:border-b-0 md:border-r [border-color:var(--layout-separator)]">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Vaults
                  </p>
                  <div
                    className="mt-3 max-h-[24rem] space-y-1 overflow-y-auto"
                    role="list"
                    aria-label="Recent vaults"
                  >
                    {selectableVaults.map((registered) => {
                      const selected = activeVaultId === registered.key;
                      return (
                        <button
                          key={registered.key}
                          type="button"
                          role="listitem"
                          title={registered.path}
                          onClick={() => void openRegisteredVault(registered)}
                          className={`w-full rounded-md px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring ${
                            selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                          }`}
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
                      );
                    })}
                    {!selectableVaults.length ? (
                      <p className="rounded-md border border-dashed px-3 py-4 text-xs leading-5 text-muted-foreground [border-color:var(--layout-separator)]">
                        Open a folder once and it will remain available here.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col justify-between p-6">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Manage vaults
                    </p>
                    <h2 className="mt-2 text-lg font-semibold tracking-tight">
                      Choose where to work
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {runtime.vaultAccess === "registry"
                        ? "Open a vault registered on this Flux server. Access remains limited to its configured storage root."
                        : "Open any notes folder, Obsidian vault, Git repository, or empty directory. Derived data stays in its hidden .flux folder."}
                    </p>
                  </div>
                  <div className="mt-8 flex flex-col gap-2">
                    {runtime.vaultAccess !== "registry" ? (
                      <button
                        type="button"
                        onClick={() => void chooseVault("open")}
                        className="rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Open another folder…
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void chooseVault("create")}
                      disabled={!runtime.selectVaultDirectory}
                      className="rounded-md border px-3 py-2.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [border-color:var(--layout-separator)]"
                    >
                      Create new vault…
                    </button>
                    {vault ? (
                      <button
                        type="button"
                        onClick={() => setVaultPickerOpen(false)}
                        className="px-3 py-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        Return to {vault.name}
                      </button>
                    ) : null}
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
            <div className="fixed inset-0 z-[180] grid place-items-center bg-black/45 p-4">
              <div className="flex max-h-[min(36rem,80vh)] w-full max-w-lg flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
                <div className="flex items-start justify-between gap-4 border-b p-5 [border-color:var(--layout-separator)]">
                  <div>
                    <h2 className="text-base font-semibold">Trash</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Restore items or permanently delete them.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTrashOpen(false)}
                    className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    Close
                  </button>
                </div>
                <div className="min-h-32 overflow-y-auto p-3">
                  {trashEntries.length ? (
                    <div className="space-y-1">
                      {trashEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{entry.originalPath}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
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
                            className="rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                          >
                            Delete permanently
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
                      Trash is empty.
                    </div>
                  )}
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
          <PdfExportDialog
            document={pdfExportDocument}
            documents={documents}
            open={pdfExportOpen}
            onOpenChange={setPdfExportOpen}
            onExport={runtime.exportPdf}
          />
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            vaultName={vault?.name}
          />
          <AddBookmarkDialog
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
