import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUpDown,
  ArrowUp,
  Bookmark,
  BookmarkPlus,
  CalendarDays,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
  ExternalLink,
  FileText,
  FilePlus2,
  Files,
  FolderPlus,
  FolderOpen,
  GitBranch,
  Grid2X2,
  List,
  ListCollapse,
  ListFilter,
  Link2,
  LocateFixed,
  Network,
  PlusCircle,
  MinusCircle,
  RefreshCw,
  Search,
  Settings2,
  Tags,
  X,
} from "lucide-react";
import { AlertDialog, HoverCard } from "radix-ui";
import type { FileEntry } from "@flux/bridge-contract";
import type { BookmarkItem } from "./bookmark-store";
import { getFrontmatterProperties, splitFrontmatter } from "./frontmatter";
import type { DemoDocument } from "./markdown-editor";
import {
  buildLinkIndex,
  globalBacklinkStore,
  type DocumentMention,
} from "./link-index";
import { VaultExplorer } from "./vault-explorer";
import { cn } from "@flux/shared-ui";

export type LeftPane = "files" | "search" | "bookmarks";
export type RightPane =
  | "backlinks"
  | "outgoing"
  | "tags"
  | "properties"
  | "outline"
  | "source-control";

export function getLeftOptions(plugins?: Record<string, boolean>): Array<{ id: LeftPane; label: string; icon: typeof Files }> {
  const options: Array<{ id: LeftPane; label: string; icon: typeof Files }> = [];
  if (!plugins || plugins["file-explorer"] !== false) {
    options.push({ id: "files", label: "Files", icon: Files });
  }
  if (!plugins || plugins["search"] !== false) {
    options.push({ id: "search", label: "Search", icon: Search });
  }
  if (!plugins || plugins["bookmarks"] !== false) {
    options.push({ id: "bookmarks", label: "Bookmarks", icon: Bookmark });
  }
  return options;
}

export function getRightOptions(plugins?: Record<string, boolean>): Array<{ id: RightPane; label: string; icon: typeof List }> {
  const options: Array<{ id: RightPane; label: string; icon: typeof List }> = [];

  if (!plugins || plugins["backlinks"] !== false) {
    options.push({ id: "backlinks", label: "Backlinks", icon: Link2 });
  }

  options.push({ id: "outgoing", label: "Outgoing links", icon: ExternalLink });
  options.push({ id: "tags", label: "Tags", icon: Tags });

  if (!plugins || plugins["properties"] !== false) {
    options.push({ id: "properties", label: "Properties", icon: Settings2 });
  }

  if (!plugins || plugins["outline"] !== false) {
    options.push({ id: "outline", label: "Outline", icon: List });
  }

  if (!plugins || plugins["sync"] !== false) {
    options.push({ id: "source-control", label: "Source Control", icon: GitBranch });
  }

  return options;
}


function storedExplorerValue<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return (
      (JSON.parse(localStorage.getItem(`flux-explorer-${key}`) ?? "null") as T | null) ?? fallback
    );
  } catch {
    return fallback;
  }
}

function IconButton({
  label,
  children,
  active = false,
  onClick,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`grid size-7 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function PaneTabs<T extends string>({
  options,
  active,
  onChange,
}: {
  options: Array<{ id: T; label: string; icon: typeof Files }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <nav aria-label="Sidebar views" className="flex h-8 items-center gap-1 overflow-hidden">
      {options.map(({ id, label, icon: Icon }) => (
        <IconButton key={id} label={label} active={active === id} onClick={() => onChange(id)}>
          <Icon className="size-4" strokeWidth={1.8} />
        </IconButton>
      ))}
    </nav>
  );
}

function SidebarToolbar({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return (
    <div
      className={`sticky top-0 z-30 flex min-h-9 shrink-0 items-center justify-center gap-0.5 bg-sidebar px-2 ${wrap ? "flex-wrap py-1" : ""}`}
    >
      {children}
    </div>
  );
}

function SidebarPane({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="shrink-0 bg-sidebar">{controls}</div>
      <div className="flux-editor-scroll flux-sidebar-scroll min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function documentSummary(document: DemoDocument) {
  const body = splitFrontmatter(document.content).body;
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const properties = getFrontmatterProperties(document.content);
  const tags = properties.find(({ key }) => key === "tags")?.value;
  const preview = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`[\]{}|~=!-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
  return { words, tags, preview };
}

function FileRow({
  document,
  selected,
  depth,
  onOpen,
  onReorder,
}: {
  document: DemoDocument;
  selected: boolean;
  depth: number;
  onOpen: () => void;
  onReorder: (title: string, before: string) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const summary = useMemo(() => documentSummary(document), [document]);
  const metadata = ["Markdown", `${summary.words} words`, summary.tags && `tags ${summary.tags}`]
    .filter(Boolean)
    .join(" • ");

  return (
    <HoverCard.Root
      open={previewOpen}
      onOpenChange={(open) => {
        if (!open) setPreviewOpen(false);
      }}
    >
      <HoverCard.Trigger asChild>
        <button
          type="button"
          role="treeitem"
          draggable
          aria-selected={selected}
          title={`${document.title}\n${metadata}\n⌘/Ctrl + hover to preview`}
          onClick={onOpen}
          onPointerEnter={(event) => setPreviewOpen(event.metaKey || event.ctrlKey)}
          onPointerLeave={() => setPreviewOpen(false)}
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-flux-file", document.title);
            event.dataTransfer.setData("text/plain", document.title);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("application/x-flux-file")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const source = event.dataTransfer.getData("application/x-flux-file");
            if (source && source !== document.title) onReorder(source, document.title);
          }}
          className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            selected
              ? "bg-sidebar-selected text-sidebar-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          }`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <Files className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{document.title}</span>
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="right"
          align="start"
          sideOffset={8}
          className="z-[130] w-80 rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl [border-color:var(--layout-separator)]"
        >
          <p className="truncate text-sm font-semibold">{document.title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{metadata}</p>
          <p className="mt-3 line-clamp-6 text-xs leading-5 text-muted-foreground">
            {summary.preview || "Empty note"}
          </p>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function FileExplorer({
  activeTitle,
  documents,
  onOpenDocument,
  onOpenPdf,
  onCreateNote,
}: {
  activeTitle: string;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onOpenPdf: () => void;
  onCreateNote: (parent?: string) => void;
}) {
  const [folders, setFolders] = useState(() =>
    storedExplorerValue("folders", ["Projects", "Reference"])
  );
  const [locations, setLocations] = useState<Record<string, string | null>>(() =>
    storedExplorerValue("locations", {
      "Project plan": "Projects",
      "Performance notes": "Reference",
    })
  );
  const [order, setOrder] = useState(() =>
    storedExplorerValue(
      "order",
      documents.map(({ title }) => title)
    )
  );
  const [sortByName, setSortByName] = useState(false);
  const [autoReveal, setAutoReveal] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingMove, setPendingMove] = useState<
    | { kind: "folder"; title: string; folder: string | null }
    | { kind: "reorder"; title: string; before: string }
  >();

  const sortedDocuments = useMemo(() => {
    const rank = new Map(order.map((title, index) => [title, index]));
    return [...documents].sort((a, b) =>
      sortByName
        ? a.title.localeCompare(b.title)
        : (rank.get(a.title) ?? order.length) - (rank.get(b.title) ?? order.length)
    );
  }, [documents, order, sortByName]);

  useEffect(() => {
    localStorage.setItem("flux-explorer-folders", JSON.stringify(folders));
    localStorage.setItem("flux-explorer-locations", JSON.stringify(locations));
    localStorage.setItem("flux-explorer-order", JSON.stringify(order));
  }, [folders, locations, order]);

  const confirmMove = () => {
    if (!pendingMove) return;
    if (pendingMove.kind === "folder") {
      setLocations((current) => ({ ...current, [pendingMove.title]: pendingMove.folder }));
    } else {
      setOrder((current) => {
        const next = current.filter((title) => title !== pendingMove.title);
        const index = next.indexOf(pendingMove.before);
        next.splice(index < 0 ? next.length : index, 0, pendingMove.title);
        return next;
      });
      setSortByName(false);
    }
    setPendingMove(undefined);
  };

  const renderFiles = (folder: string | null, depth = 0) =>
    sortedDocuments
      .filter((document) => (locations[document.title] ?? null) === folder)
      .map((document) => (
        <FileRow
          key={document.title}
          document={document}
          selected={document.title === activeTitle}
          depth={depth}
          onOpen={() => onOpenDocument(document.title)}
          onReorder={(title, before) => setPendingMove({ kind: "reorder", title, before })}
        />
      ));

  return (
    <>
      <SidebarToolbar>
        <IconButton label="New note" onClick={onCreateNote}>
          <FilePlus2 className="size-3.5" />
        </IconButton>
        <IconButton
          label="New folder"
          onClick={() => setFolders((current) => [...current, `New folder ${current.length - 1}`])}
        >
          <FolderPlus className="size-3.5" />
        </IconButton>
        <IconButton
          label={`Sort: ${sortByName ? "Name" : "Manual"}`}
          active={sortByName}
          onClick={() => setSortByName((current) => !current)}
        >
          <ListFilter className="size-3.5" />
        </IconButton>
        <IconButton
          label="Auto-reveal active file"
          active={autoReveal}
          onClick={() => setAutoReveal((current) => !current)}
        >
          <LocateFixed className="size-3.5" />
        </IconButton>
        <IconButton
          label={collapsed.size === folders.length ? "Expand all" : "Collapse all"}
          onClick={() =>
            setCollapsed((current) =>
              current.size === folders.length ? new Set() : new Set(folders)
            )
          }
        >
          <ChevronRight className="size-3.5 rotate-90" />
        </IconButton>
      </SidebarToolbar>
      <div
        className="p-1.5"
        role="tree"
        aria-label="Files"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("application/x-flux-file")) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const title = event.dataTransfer.getData("application/x-flux-file");
          if (title && locations[title]) setPendingMove({ kind: "folder", title, folder: null });
        }}
      >
        <button
          type="button"
          role="treeitem"
          onClick={onOpenPdf}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <FileText className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">Flux PDF demo</span>
          <span className="text-[9px] uppercase tracking-wide">PDF</span>
        </button>
        {renderFiles(null)}
        {folders.map((folder) => (
          <div key={folder}>
            <button
              type="button"
              role="treeitem"
              aria-expanded={
                !collapsed.has(folder) || (autoReveal && locations[activeTitle] === folder)
              }
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(folder)) next.delete(folder);
                  else next.add(folder);
                  return next;
                })
              }
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("application/x-flux-file")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const title = event.dataTransfer.getData("application/x-flux-file");
                if (title && locations[title] !== folder) {
                  setPendingMove({ kind: "folder", title, folder });
                }
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronRight
                className={`size-3.5 transition-transform ${
                  collapsed.has(folder) && !(autoReveal && locations[activeTitle] === folder)
                    ? ""
                    : "rotate-90"
                }`}
              />
              <FolderOpen className="size-3.5" />
              <span className="truncate">{folder}</span>
            </button>
            {collapsed.has(folder) && !(autoReveal && locations[activeTitle] === folder) ? null : (
              <div role="group">{renderFiles(folder, 1)}</div>
            )}
          </div>
        ))}
      </div>
      <AlertDialog.Root
        open={Boolean(pendingMove)}
        onOpenChange={(open) => !open && setPendingMove(undefined)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[140] bg-black/35" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[141] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
            <AlertDialog.Title className="text-sm font-semibold">Move file?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-5 text-muted-foreground">
              {pendingMove?.kind === "folder"
                ? `Move “${pendingMove.title}” to ${pendingMove.folder ?? "vault root"}?`
                : `Move “${pendingMove?.title ?? "file"}” before “${pendingMove?.kind === "reorder" ? pendingMove.before : "file"}”?`}
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">
                Cancel
              </AlertDialog.Cancel>
              <AlertDialog.Action
                onClick={confirmMove}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                Move
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-8 items-center justify-between gap-3">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-primary"
      />
    </label>
  );
}

function SearchPane({
  documents,
  onOpenDocument,
}: {
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [collapseResults, setCollapseResults] = useState(false);
  const [moreContext, setMoreContext] = useState(false);
  const [explainTerms, setExplainTerms] = useState(false);
  const normalizedQuery = matchCase ? query : query.toLocaleLowerCase();
  const results = query
    ? documents.filter((document) => {
        const haystack = `${document.title}\n${document.content}`;
        return (matchCase ? haystack : haystack.toLocaleLowerCase()).includes(normalizedQuery);
      })
    : [];

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center gap-1 bg-sidebar p-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2 [border-color:var(--layout-separator)]">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            aria-label="Search vault"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search..."
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X className="size-3.5 text-muted-foreground" />
            </button>
          ) : null}
        </label>
        <IconButton
          label="Match case"
          active={matchCase}
          onClick={() => setMatchCase((current) => !current)}
        >
          <span className="text-[11px] font-semibold">Aa</span>
        </IconButton>
        <IconButton
          label="Search settings"
          active={showSettings}
          onClick={() => setShowSettings((current) => !current)}
        >
          <Settings2 className="size-3.5" />
        </IconButton>
      </div>
      {showSettings ? (
        <div className="space-y-1 px-3 pb-2 text-xs">
          <ToggleRow
            label="Collapse results"
            checked={collapseResults}
            onChange={setCollapseResults}
          />
          <ToggleRow label="Show more context" checked={moreContext} onChange={setMoreContext} />
          <ToggleRow
            label="Explain search terms"
            checked={explainTerms}
            onChange={setExplainTerms}
          />
        </div>
      ) : null}
      <div className="px-3 text-[11px] text-muted-foreground">
        {results.length
          ? results.map((result) => (
              <button
                key={result.title}
                type="button"
                onClick={() => onOpenDocument(result.title)}
                className="block w-full rounded-md px-1 py-2 text-left hover:bg-accent/60 hover:text-foreground"
              >
                <span className="block font-medium text-foreground">{result.title}</span>
                {!collapseResults && moreContext ? (
                  <span className="mt-1 line-clamp-2 block leading-4">
                    {documentSummary(result).preview}
                  </span>
                ) : null}
              </button>
            ))
          : query
            ? "No matches found."
            : "Search notes, tags, and properties"}
      </div>
    </>
  );
}

function BookmarksPane({
  activeTitle: _activeTitle,
  activePath: _activePath,
  bookmarks = [],
  groups = [],
  onOpenDocument,
  onRemoveBookmark: _onRemoveBookmark,
  onOpenAddBookmark,
  onCreateGroup,
}: {
  activeTitle: string;
  activePath?: string;
  bookmarks?: BookmarkItem[];
  groups?: string[];
  onOpenDocument: (titleOrPath: string) => void;
  onRemoveBookmark?: (id: string) => void;
  onOpenAddBookmark?: () => void;
  onCreateGroup?: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const handleCreateGroup = () => {
    const name = window.prompt("Enter new group name:");
    if (name?.trim()) {
      onCreateGroup?.(name.trim());
    }
  };

  const renderBookmarkRow = (item: BookmarkItem, plClass = "pl-7") => (
    <div
      key={item.id}
      className="group/bookmark flex w-full items-center rounded-md py-1.5 text-left hover:bg-accent/60"
    >
      <button
        type="button"
        onClick={() => onOpenDocument(item.path || item.title)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 text-left outline-none",
          plClass
        )}
      >
        <Bookmark className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{item.title}</span>
      </button>
    </div>
  );

  const ungroupedBookmarks = bookmarks.filter(
    (b) => !b.group || b.group === "None" || !groups.includes(b.group)
  );

  return (
    <>
      <SidebarToolbar>
        <IconButton
          label="Bookmark active tab"
          onClick={onOpenAddBookmark}
        >
          <BookmarkPlus className="size-3.5" />
        </IconButton>
        <IconButton
          label="New group"
          onClick={handleCreateGroup}
        >
          <FolderPlus className="size-3.5" />
        </IconButton>
        <IconButton
          label="Collapse all"
          onClick={() => setCollapsed(new Set(groups))}
        >
          <ListCollapse className="size-3.5" />
        </IconButton>
      </SidebarToolbar>
      <div className="p-1.5 text-xs">
        {bookmarks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No bookmarks added yet.<br />
            Click <span className="font-medium text-foreground">Bookmark</span> in a note menu to add one.
          </div>
        ) : (
          <>
            {groups.map((group) => {
              const groupItems = bookmarks.filter((b) => b.group === group);
              return (
                <div key={group}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <ChevronRight
                      className={`size-3.5 transition-transform ${collapsed.has(group) ? "" : "rotate-90"}`}
                    />
                    <span className="truncate">{group}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {groupItems.length}
                    </span>
                  </button>
                  {collapsed.has(group)
                    ? null
                    : groupItems.map((item) => renderBookmarkRow(item, "pl-7"))}
                </div>
              );
            })}
            {ungroupedBookmarks.map((item) => renderBookmarkRow(item, "pl-2"))}
          </>
        )}
      </div>
    </>
  );
}

function LeftSidebar({
  activeTitle,
  pane,
  documents,
  onOpenDocument,
  onOpenPdf,
  onCreateNote,
  vaultEntries,
  activePath,
  onCreateFolder,
  onMovePath,
  onRenamePath,
  onDeletePath,
  onArchivePath,
  onOpenTrash,
  onPreviewPath,
  bookmarks,
  bookmarkGroups,
  onRemoveBookmark,
  onOpenAddBookmark,
  onCreateBookmarkGroup,
  expandedFolders,
  onExpandedFoldersChange,
  onSelectPath,
}: {
  activeTitle: string;
  pane: LeftPane;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onOpenPdf: () => void;
  onCreateNote: (parent?: string, name?: string) => void;
  vaultEntries?: FileEntry[];
  activePath?: string;
  onCreateFolder?: (parent: string, name: string) => void;
  onMovePath?: (sourcePath: string, destinationPath: string) => void;
  onRenamePath?: (path: string, name: string) => void;
  onDeletePath?: (path: string) => void;
  onArchivePath?: (path: string) => void;
  onOpenTrash?: () => void;
  onPreviewPath?: (path: string) => Promise<string | null>;
  bookmarks?: BookmarkItem[];
  bookmarkGroups?: string[];
  onRemoveBookmark?: (id: string) => void;
  onOpenAddBookmark?: () => void;
  onCreateBookmarkGroup?: (name: string) => void;
  expandedFolders?: string[];
  onExpandedFoldersChange?: (paths: string[]) => void;
  onSelectPath?: (path: string) => void;
}) {
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      aria-label="Left sidebar"
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0 max-w-full" hidden={pane !== "files"}>
          {vaultEntries ? (
            <VaultExplorer
              entries={vaultEntries}
              documents={documents}
              activePath={activePath}
              onOpen={onOpenDocument}
              onCreateNote={(parent, name) => onCreateNote(parent, name)}
              onCreateFolder={(parent, name) => onCreateFolder?.(parent, name)}
              onMove={(source, destination) => onMovePath?.(source, destination)}
              onRename={(path, name) => onRenamePath?.(path, name)}
              onDelete={(path) => onDeletePath?.(path)}
              onArchive={(path) => onArchivePath?.(path)}
              onOpenTrash={() => onOpenTrash?.()}
              onPreview={(path) => onPreviewPath?.(path) ?? Promise.resolve(null)}
              expandedFolders={expandedFolders}
              onExpandedFoldersChange={onExpandedFoldersChange}
              onSelectPath={onSelectPath}
            />
          ) : (
            <FileExplorer
              activeTitle={activeTitle}
              documents={documents}
              onOpenDocument={onOpenDocument}
              onOpenPdf={onOpenPdf}
              onCreateNote={onCreateNote}
            />
          )}
        </div>
        <div
          className="flux-editor-scroll flux-sidebar-scroll h-full min-h-0 overflow-x-clip overflow-y-auto"
          hidden={pane !== "search"}
        >
          <SearchPane documents={documents} onOpenDocument={onOpenDocument} />
        </div>
        <div
          className="flux-editor-scroll flux-sidebar-scroll h-full min-h-0 overflow-x-clip overflow-y-auto"
          hidden={pane !== "bookmarks"}
        >
          <BookmarksPane
            activeTitle={activeTitle}
            activePath={activePath}
            bookmarks={bookmarks}
            groups={bookmarkGroups}
            onOpenDocument={onOpenDocument}
            onRemoveBookmark={onRemoveBookmark}
            onOpenAddBookmark={onOpenAddBookmark}
            onCreateGroup={onCreateBookmarkGroup}
          />
        </div>
      </div>
    </section>
  );
}

function RightContent({
  pane,
  activeDocument,
  documents,
  onOpenDocument,
  onPropertyChange,
  onAddProperty,
}: {
  pane: RightPane;
  activeDocument: DemoDocument | null;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onPropertyChange: (key: string, value: string) => void;
  onAddProperty: () => void;
}) {
  const [filterVisible, setFilterVisible] = useState(false);
  const [filter, setFilter] = useState("");
  const [descending, setDescending] = useState(false);
  const [collapsedResults, setCollapsedResults] = useState(false);
  const [moreContext, setMoreContext] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [linkedExpanded, setLinkedExpanded] = useState(true);
  const [unlinkedExpanded, setUnlinkedExpanded] = useState(false);
  const [sortByCount, setSortByCount] = useState(false);
  const [refreshTrigger] = useState(0);

  useEffect(() => {
    setFilterVisible(false);
    setFilter("");
  }, [pane]);

  const filterField = filterVisible ? (
    <div className="bg-sidebar px-2 pb-2">
      <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 [border-color:var(--layout-separator)]">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          aria-label={`Filter ${pane}`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter..."
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </label>
    </div>
  ) : null;

  if (!activeDocument) {
    return (
      <div className="grid min-h-32 place-items-center px-4 text-center text-xs text-muted-foreground">
        No active file
      </div>
    );
  }

  if (pane === "outline") {
    const headings = activeDocument
      ? [...splitFrontmatter(activeDocument.content).body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(
          (match) => ({ level: match[1].length, title: match[2] })
        )
      : [];
    const visibleHeadings = headings.filter(({ title }) =>
      title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    );
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
              <IconButton label="Expand all headings" onClick={() => setCollapsedResults(false)}>
                <ChevronsUpDown className="size-3.5" />
              </IconButton>
              <IconButton label="Collapse all headings" onClick={() => setCollapsedResults(true)}>
                <ListCollapse className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="p-2 text-xs">
          {collapsedResults
            ? null
            : visibleHeadings.map((heading, index) => (
                <button
                  key={`${heading.title}-${index}`}
                  type="button"
                  className="flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-left hover:bg-accent/60"
                  style={{ paddingLeft: 8 + (heading.level - 1) * 14 }}
                >
                  <ChevronRight className="size-3.5 rotate-90 text-muted-foreground" />
                  <span className="truncate">{heading.title}</span>
                </button>
              ))}
        </div>
      </SidebarPane>
    );
  }
  if (pane === "backlinks") {
    const activeTitle = activeDocument?.path ?? activeDocument?.title ?? "Untitled";
    
    const titleFromPath = (path: string) => {
      return path.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? path;
    };

    const highlightQuery = (text: string, query: string) => {
      if (!text) return null;
      const cleanTarget = query.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? query;
      const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const targetEsc = escapeRegExp(cleanTarget);

      const linkPattern = new RegExp(
        `(\\[\\[[^\\]]*${targetEsc}[^\\]]*\\]\\]|\\[[^\\]]+\\]\\([^)]*${targetEsc}[^)]*\\)|${targetEsc})`,
        "gi"
      );

      const parts = text.split(linkPattern);

      return (
        <span>
          {parts.map((part, idx) =>
            linkPattern.test(part) ? (
              <mark
                key={idx}
                className="inline rounded border border-[#a68a26]/60 bg-[#685512]/40 px-1 py-0.5 font-mono text-[11px] font-medium text-[#ffe57f] shadow-xs"
              >
                {part}
              </mark>
            ) : (
              <span key={idx}>{part}</span>
            )
          )}
        </span>
      );
    };

    const groupMentions = (mentions: DocumentMention[]) => {
      const grouped = new Map<string, DocumentMention[]>();
      for (const mention of mentions) {
        const matchesFilter = `${mention.source} ${mention.excerpt}`
          .toLocaleLowerCase()
          .includes(filter.toLocaleLowerCase());
        if (!matchesFilter) continue;
        const group = grouped.get(mention.source) ?? [];
        group.push(mention);
        grouped.set(mention.source, group);
      }
      return [...grouped].sort(([left, leftMentions], [right, rightMentions]) => {
        if (sortByCount) {
          const compareCounts = rightMentions.length - leftMentions.length;
          return descending ? -compareCounts : compareCounts;
        }
        return descending ? right.localeCompare(left) : left.localeCompare(right);
      });
    };

    // decoupled performance: raw backlink indexing only runs when activeTitle/refreshTrigger/storeVersion changes
    const storeVersion = useSyncExternalStore(
      (onStoreChange) => globalBacklinkStore.subscribe(onStoreChange),
      () => globalBacklinkStore.getCacheVersion()
    );

    const rawLinkedMentions = useMemo(() => {
      return globalBacklinkStore.getLinkedMentions(activeTitle);
    }, [activeTitle, refreshTrigger, storeVersion]);

    const rawUnlinkedMentions = useMemo(() => {
      if (!activeDocument) return [];
      return globalBacklinkStore.getUnlinkedMentions(activeDocument.title);
    }, [activeDocument?.title, refreshTrigger, storeVersion]);

    // group & search filtering: running instantly in O(N)
    const linked = useMemo(() => {
      return groupMentions(rawLinkedMentions);
    }, [rawLinkedMentions, filter, descending, sortByCount]);

    const unlinked = useMemo(() => {
      return groupMentions(rawUnlinkedMentions);
    }, [rawUnlinkedMentions, filter, descending, sortByCount]);

    const totalLinkedCount = linked.reduce((sum, [, ms]) => sum + ms.length, 0);
    const totalUnlinkedCount = unlinked.reduce((sum, [, ms]) => sum + ms.length, 0);

    const handleCollapseAll = () => {
      const next = { ...expandedGroups };
      for (const [source] of linked) {
        next[`${activeTitle}::${source}`] = false;
      }
      for (const [source] of unlinked) {
        next[`${activeTitle}::${source}`] = false;
      }
      setExpandedGroups(next);
    };

    const handleExpandAll = () => {
      const next = { ...expandedGroups };
      for (const [source] of linked) {
        next[`${activeTitle}::${source}`] = true;
      }
      for (const [source] of unlinked) {
        next[`${activeTitle}::${source}`] = true;
      }
      setExpandedGroups(next);
    };

    const toggleGroupExpanded = (key: string, isCurrentlyExpanded: boolean) => {
      setExpandedGroups((prev) => ({
        ...prev,
        [key]: !isCurrentlyExpanded,
      }));
    };

    const renderGroupedMentions = (groups: Array<[string, DocumentMention[]]>, defaultExpanded: boolean = false, type: "linked" | "unlinked") => {
      return groups.map(([source, mentions]) => {
        const key = `${type}::${activeTitle}::${source}`;
        const stored = expandedGroups[key];
        const isExpanded = stored !== undefined ? stored : defaultExpanded;
        return (
          <div key={source} className="mb-0.5">
            <div className="flex items-center justify-between py-1 px-1 hover:bg-accent/80 rounded-md group select-none">
              <button
                type="button"
                onClick={() => toggleGroupExpanded(key, isExpanded)}
                className="flex items-center gap-1.5 min-w-0 flex-1 text-left text-[13px] font-semibold text-muted-foreground outline-none transition-colors"
              >
                <ChevronRight className={`size-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-90 text-foreground" : ""}`} />
                <span className="truncate">{titleFromPath(source)}</span>
              </button>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground opacity-60">
                  {mentions.length}
                </span>
              </div>
            </div>
            {isExpanded && (
              <div className="space-y-1.5 mt-1">
                {mentions.map((mention, idx) => (
                  <button
                    key={`${mention.line}-${idx}`}
                    type="button"
                    onClick={() => {
                      onOpenDocument(source);
                      const detail = { path: source, line: mention.line, excerpt: mention.excerpt };
                      const dispatch = () => window.dispatchEvent(new CustomEvent("flux-navigate-editor", { detail }));
                      dispatch();
                      setTimeout(dispatch, 30);
                      setTimeout(dispatch, 100);
                      setTimeout(dispatch, 250);
                    }}
                    className="w-full text-left rounded-md border border-[var(--layout-separator)] bg-transparent p-2 hover:bg-accent/40 transition-colors outline-none block shadow-none"
                  >
                    <div className="text-[12px] leading-relaxed text-muted-foreground/90 whitespace-pre-wrap break-words">
                      {highlightQuery(mention.excerpt, activeTitle)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      });
    };

    return (
      <SidebarPane
        controls={
          <>
            <div className="sticky top-0 z-30 flex min-h-9 shrink-0 items-center justify-center gap-0 bg-sidebar px-2">
              <IconButton
                label={collapsedResults ? "Expand all" : "Collapse all"}
                onClick={() => {
                  if (collapsedResults) handleExpandAll();
                  else handleCollapseAll();
                  setCollapsedResults((current) => !current);
                }}
              >
                <List className="size-3.5" />
              </IconButton>
              <IconButton
                label={descending ? "Sort ascending" : "Sort descending"}
                active={descending}
                onClick={() => setDescending((current) => !current)}
              >
                <ArrowUpDown className="size-3.5" />
              </IconButton>
              <IconButton
                label={sortByCount ? "Sort alphabetically" : "Sort by count"}
                active={sortByCount}
                onClick={() => setSortByCount((current) => !current)}
              >
                <ListFilter className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
            </div>
            {filterVisible && (
              <div className="px-3 pb-3">
                <label className="flex h-8 w-full items-center gap-2.5 rounded-lg border-[1.5px] border-[var(--layout-separator)] bg-background px-3.5 transition-colors focus-within:border-ring">
                  <Search className="size-4 text-muted-foreground shrink-0" />
                  <input
                    aria-label="Filter"
                    placeholder="Search..."
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                  />
                </label>
              </div>
            )}
          </>
        }
      >
        <div className="px-3 py-3 text-xs h-full overflow-y-auto">
          {/* Linked Mentions Section */}
          <div className="mb-6">
            <button 
              className="flex w-full items-center justify-between py-1 font-medium text-foreground/80 mb-2 outline-none transition-colors"
              onClick={() => setLinkedExpanded(prev => !prev)}
            >
              <span className="text-[13px]">Linked mentions</span>
              <span className="text-[12px] text-muted-foreground font-normal opacity-60">
                {totalLinkedCount}
              </span>
            </button>
            {linkedExpanded && totalLinkedCount > 0 ? (
              renderGroupedMentions(linked, true, "linked")
            ) : null}
            {linkedExpanded && totalLinkedCount === 0 ? (
              <div className="text-[11px] text-muted-foreground px-5">
                No backlinks found.
              </div>
            ) : null}
          </div>

          {/* Unlinked Mentions Section */}
          <div>
            <button 
              className="flex w-full items-center justify-between py-1 font-medium text-foreground/80 mb-2 outline-none transition-colors"
              onClick={() => setUnlinkedExpanded(prev => !prev)}
            >
              <span className="text-[13px]">Unlinked mentions</span>
              {totalUnlinkedCount > 0 && (
                <span className="text-[12px] text-muted-foreground font-normal opacity-60">
                  {totalUnlinkedCount}
                </span>
              )}
            </button>
            {unlinkedExpanded && totalUnlinkedCount > 0 ? (
              renderGroupedMentions(unlinked, false, "unlinked")
            ) : null}
            {unlinkedExpanded && totalUnlinkedCount === 0 ? (
              <div className="text-[11px] text-muted-foreground px-5">
                No unlinked mentions found.
              </div>
            ) : null}
          </div>
        </div>
      </SidebarPane>
    );
  }
  if (pane === "outgoing") {
    const activeTitle = activeDocument?.path ?? activeDocument?.title ?? "Untitled";
    const outgoing = [...(buildLinkIndex(documents).outgoing.get(activeTitle) ?? new Set<string>())]
      .filter((title) => title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
      .sort((a, b) => (descending ? b.localeCompare(a) : a.localeCompare(b)));
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Change sort order"
                active={descending}
                onClick={() => setDescending((current) => !current)}
              >
                <ListFilter className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="px-3 py-2 text-xs">
          <div className="flex items-center justify-between py-1 font-medium">
            <span>Links</span>
            <span className="text-[10px] text-muted-foreground">{outgoing.length}</span>
          </div>
          {outgoing.map((title) => (
            <button
              key={title}
              type="button"
              onClick={() => onOpenDocument(title)}
              className="flex w-full items-center gap-2 rounded-md px-1 py-2 text-left hover:bg-accent/60"
            >
              <Link2 className="size-3.5 text-muted-foreground" />
              {title}
            </button>
          ))}
          <div className="mt-3 py-1 font-medium text-muted-foreground">Unlinked mentions</div>
        </div>
      </SidebarPane>
    );
  }
  if (pane === "tags") {
    const counts = new Map<string, number>();
    for (const document of documents) {
      const value = getFrontmatterProperties(document.content).find(
        ({ key }) => key === "tags"
      )?.value;
      for (const tag of value?.replace(/^\[|\]$/g, "").split(",") ?? []) {
        const normalized = tag.trim();
        if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
    const tags = [...counts]
      .filter(([tag]) => tag.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
      .sort(([a], [b]) => (descending ? b.localeCompare(a) : a.localeCompare(b)));
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Change sort order"
                active={descending}
                onClick={() => setDescending((current) => !current)}
              >
                <ListFilter className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show nested tags"
                active={moreContext}
                onClick={() => setMoreContext((current) => !current)}
              >
                <Network className="size-3.5" />
              </IconButton>
              <IconButton
                label="Collapse all"
                active={collapsedResults}
                onClick={() => setCollapsedResults((current) => !current)}
              >
                <ChevronsUpDown className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="px-3 py-2 text-xs">
          {collapsedResults
            ? null
            : tags.map(([tag, count]) => (
                <div key={tag} className="flex justify-between py-1.5">
                  <span>{moreContext ? tag.replaceAll("/", " › ") : tag}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              ))}
        </div>
      </SidebarPane>
    );
  }
  if (pane === "properties") {
    const properties = (activeDocument ? getFrontmatterProperties(activeDocument.content) : [])
      .filter(({ key }) => key.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
      .sort((a, b) => (descending ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)));
    return (
      <SidebarPane
        controls={
          <>
            <SidebarToolbar>
              <IconButton
                label="Change sort order"
                active={descending}
                onClick={() => setDescending((current) => !current)}
              >
                <ListFilter className="size-3.5" />
              </IconButton>
              <IconButton
                label="Show search filter"
                active={filterVisible}
                onClick={() => setFilterVisible((current) => !current)}
              >
                <Search className="size-3.5" />
              </IconButton>
            </SidebarToolbar>
            {filterField}
          </>
        }
      >
        <div className="divide-y px-3 text-xs [divide-color:var(--layout-separator)]">
          {properties.map((property) => (
            <label key={property.key} className="flex items-center justify-between gap-3 py-2">
              <span className="shrink-0 text-muted-foreground">{property.key}</span>
              <input
                value={property.value}
                onChange={(event) => onPropertyChange(property.key, event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-right outline-none"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={onAddProperty}
            className="py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            + Add property
          </button>
        </div>
      </SidebarPane>
    );
  }
  if (pane === "source-control")
    return (
      <SidebarPane
        controls={
          <SidebarToolbar wrap>
            <IconButton label="Commit and sync">
              <ArrowUp className="size-3.5" />
            </IconButton>
            <IconButton label="Commit">
              <CircleDot className="size-3.5" />
            </IconButton>
            <IconButton label="Stage all">
              <PlusCircle className="size-3.5" />
            </IconButton>
            <IconButton label="Unstage all">
              <MinusCircle className="size-3.5" />
            </IconButton>
            <IconButton label="Push">
              <ArrowUp className="size-3.5" />
            </IconButton>
            <IconButton label="Pull">
              <ArrowDown className="size-3.5" />
            </IconButton>
            <IconButton label="Open repository">
              <FolderOpen className="size-3.5" />
            </IconButton>
            <IconButton label="Refresh">
              <RefreshCw className="size-3.5" />
            </IconButton>
          </SidebarToolbar>
        }
      >
        <div className="p-2">
          <label className="flex h-8 items-center rounded-md border bg-background px-2 [border-color:var(--layout-separator)]">
            <input
              aria-label="Commit message"
              placeholder="vault backup: {{date}}"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
      </SidebarPane>
    );
  return null;
}

function RightSidebar({
  pane,
  activeDocument,
  documents,
  onOpenDocument,
  onPropertyChange,
  onAddProperty,
}: {
  pane: RightPane;
  activeDocument: DemoDocument | null;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onPropertyChange: (key: string, value: string) => void;
  onAddProperty: () => void;
}) {
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      aria-label="Right sidebar"
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <RightContent
          pane={pane}
          activeDocument={activeDocument}
          documents={documents}
          onOpenDocument={onOpenDocument}
          onPropertyChange={onPropertyChange}
          onAddProperty={onAddProperty}
        />
      </div>
    </section>
  );
}

export function WorkspaceSidebarHeader<T extends LeftPane | RightPane>({
  side,
  active,
  onChange,
  plugins,
}: {
  side: "left" | "right";
  active: T;
  onChange: (id: T) => void;
  plugins?: Record<string, boolean>;
}) {
  const options = side === "left" ? getLeftOptions(plugins) : getRightOptions(plugins);
  return (
    <PaneTabs
      options={options as Array<{ id: T; label: string; icon: typeof Files }>}
      active={active}
      onChange={onChange}
    />
  );
}

export function WorkspaceLeftSidebar({
  activeTitle,
  pane,
  documents,
  onOpenDocument,
  onOpenPdf,
  onCreateNote,
  vaultEntries,
  activePath,
  onCreateFolder,
  onMovePath,
  onRenamePath,
  onDeletePath,
  onArchivePath,
  onOpenTrash,
  onPreviewPath,
  bookmarks,
  bookmarkGroups,
  onRemoveBookmark,
  onOpenAddBookmark,
  onCreateBookmarkGroup,
  expandedFolders,
  onExpandedFoldersChange,
  onSelectPath,
}: {
  activeTitle: string;
  pane: LeftPane;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onOpenPdf: () => void;
  onCreateNote: (parent?: string, name?: string) => void;
  vaultEntries?: FileEntry[];
  activePath?: string;
  onCreateFolder?: (parent: string, name: string) => void;
  onMovePath?: (sourcePath: string, destinationPath: string) => void;
  onRenamePath?: (path: string, name: string) => void;
  onDeletePath?: (path: string) => void;
  onArchivePath?: (path: string) => void;
  onOpenTrash?: () => void;
  onPreviewPath?: (path: string) => Promise<string | null>;
  bookmarks?: BookmarkItem[];
  bookmarkGroups?: string[];
  onRemoveBookmark?: (id: string) => void;
  onOpenAddBookmark?: () => void;
  onCreateBookmarkGroup?: (name: string) => void;
  expandedFolders?: string[];
  onExpandedFoldersChange?: (paths: string[]) => void;
  onSelectPath?: (path: string) => void;
}) {
  return (
    <LeftSidebar
      activeTitle={activeTitle}
      pane={pane}
      documents={documents}
      onOpenDocument={onOpenDocument}
      onOpenPdf={onOpenPdf}
      onCreateNote={onCreateNote}
      vaultEntries={vaultEntries}
      activePath={activePath}
      onCreateFolder={onCreateFolder}
      onMovePath={onMovePath}
      onRenamePath={onRenamePath}
      onDeletePath={onDeletePath}
      onArchivePath={onArchivePath}
      onOpenTrash={onOpenTrash}
      onPreviewPath={onPreviewPath}
      bookmarks={bookmarks}
      bookmarkGroups={bookmarkGroups}
      onRemoveBookmark={onRemoveBookmark}
      onOpenAddBookmark={onOpenAddBookmark}
      onCreateBookmarkGroup={onCreateBookmarkGroup}
      expandedFolders={expandedFolders}
      onExpandedFoldersChange={onExpandedFoldersChange}
      onSelectPath={onSelectPath}
    />
  );
}

export function WorkspaceRightSidebar({
  pane,
  activeDocument,
  documents,
  onOpenDocument,
  onPropertyChange,
  onAddProperty,
}: {
  pane: RightPane;
  activeDocument: DemoDocument | null;
  documents: DemoDocument[];
  onOpenDocument: (title: string) => void;
  onPropertyChange: (key: string, value: string) => void;
  onAddProperty: () => void;
}) {
  return (
    <RightSidebar
      pane={pane}
      activeDocument={activeDocument}
      documents={documents}
      onOpenDocument={onOpenDocument}
      onPropertyChange={onPropertyChange}
      onAddProperty={onAddProperty}
    />
  );
}

export function WorkspaceRibbon({
  onGraph,
  onFiles,
  onCanvas,
  plugins,
}: {
  onGraph?: () => void;
  onFiles?: () => void;
  onCanvas?: () => void;
  plugins?: Record<string, boolean>;
}) {
  const showFiles = !plugins || plugins["file-explorer"] !== false;
  const showGraph = !plugins || plugins["graph-view"] !== false;
  const showCanvas = !plugins || plugins["canvas"] !== false;
  const showDailyNotes = !plugins || plugins["daily-notes"] !== false;
  const showSync = !plugins || plugins["sync"] !== false;

  return (
    <nav aria-label="Workspace tools" className="flex h-full flex-col items-center gap-0.5 py-1.5">
      {showFiles ? (
        <IconButton label="Files" onClick={onFiles}>
          <Files className="size-4" />
        </IconButton>
      ) : null}
      {showGraph ? (
        <IconButton label="Graph view" onClick={onGraph}>
          <Network className="size-4" />
        </IconButton>
      ) : null}
      {showCanvas ? (
        <IconButton label="Canvas" onClick={onCanvas}>
          <Grid2X2 className="size-4" />
        </IconButton>
      ) : null}
      {showDailyNotes ? (
        <IconButton label="Calendar">
          <CalendarDays className="size-4" />
        </IconButton>
      ) : null}
      {showSync ? (
        <IconButton label="Source Control">
          <GitBranch className="size-4" />
        </IconButton>
      ) : null}
    </nav>
  );
}
