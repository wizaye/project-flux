import { useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry } from "@flux/bridge-contract";
import {
  Archive,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  ListFilter,
  Trash2,
} from "lucide-react";
import { ContextMenu, HoverCard } from "radix-ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@flux/shared-ui/components/tooltip";
import ReadingView from "./reading-view";
import { splitFrontmatter } from "./frontmatter";
import type { DemoDocument } from "./markdown-editor";

interface VaultExplorerProps {
  entries: FileEntry[];
  activePath?: string;
  onOpen: (path: string) => void;
  onCreateNote: (parent: string, name: string) => void;
  onCreateFolder: (parent: string, name: string) => void;
  onMove: (sourcePath: string, destinationPath: string) => void;
  onRename: (path: string, name: string) => void;
  onDelete: (path: string) => void;
  onArchive: (path: string) => void;
  onOpenTrash: () => void;
  onPreview: (path: string) => Promise<string | null>;
  documents: DemoDocument[];
  expandedFolders?: string[];
  onExpandedFoldersChange?: (paths: string[]) => void;
  onSelectPath?: (path: string) => void;
}

const menuClass =
  "z-[150] min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl [border-color:var(--layout-separator)]";
const itemClass =
  "flex h-8 cursor-default select-none items-center rounded-md px-2 text-sm outline-none data-[highlighted]:bg-accent";

function filePresentation(entry: FileEntry) {
  if (entry.kind === "directory") return { label: entry.name, badge: "" };
  if (/^\.[^.]+$/.test(entry.name)) return { label: entry.name, badge: "" };
  const extension = entry.name.match(/\.([^.]+)$/)?.[1] ?? "";
  if (entry.kind === "markdown")
    return { label: entry.name.replace(/\.(md|markdown)$/i, ""), badge: "" };
  return {
    label: extension ? entry.name.slice(0, -(extension.length + 1)) : entry.name,
    badge: extension.toLocaleUpperCase(),
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function entryMetadata(entry: FileEntry) {
  const kind = entry.kind === "directory" ? "Folder" : filePresentation(entry).badge || "Markdown";
  const modified = new Date(entry.modifiedAt).toLocaleString();
  return entry.kind === "directory"
    ? `${kind} • Modified ${modified}`
    : `${kind} • ${formatFileSize(entry.sizeBytes)} • Modified ${modified}`;
}

export function VaultExplorer({
  entries,
  activePath,
  onOpen,
  onCreateNote,
  onCreateFolder,
  onMove,
  onRename,
  onDelete,
  onArchive,
  onOpenTrash,
  onPreview,
  documents,
  expandedFolders,
  onExpandedFoldersChange,
  onSelectPath,
}: VaultExplorerProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, [activePath, expandedFolders]);

  const [selectedFolder, setSelectedFolder] = useState<string>();
  const [localExpandedPaths, setLocalExpandedPaths] = useState<Set<string>>(new Set());
  const expandedPaths = useMemo(
    () => (expandedFolders ? new Set(expandedFolders) : localExpandedPaths),
    [expandedFolders, localExpandedPaths]
  );
  const updateExpandedPaths = (update: (current: Set<string>) => Set<string>) => {
    const next = update(expandedPaths);
    if (expandedFolders) onExpandedFoldersChange?.([...next].sort());
    else setLocalExpandedPaths(next);
  };
  const [sortByName, setSortByName] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [dropTarget, setDropTarget] = useState<string>();
  const [preview, setPreview] = useState<{
    path: string;
    content?: string;
    loading: boolean;
  }>();
  const previewRequestRef = useRef(0);
  const pointerDragRef = useRef<
    | {
        source: string;
        startX: number;
        startY: number;
        pointerId: number;
        dragging: boolean;
        target?: string;
      }
    | undefined
  >(undefined);
  const suppressClickRef = useRef(false);
  const cancelInlineEditRef = useRef(false);
  const [inlineEdit, setInlineEdit] = useState<
    | { kind: "note" | "folder"; parent: string; value: string }
    | { kind: "rename"; entry: FileEntry; value: string }
  >();
  const [dialog, setDialog] = useState<{ kind: "move"; entry: FileEntry; value: string }>();

  const activeParent = activePath?.includes("/")
    ? activePath.slice(0, activePath.lastIndexOf("/"))
    : "";
  const creationFolder = selectedFolder ?? activeParent;

  const canMoveTo = (source: string, targetFolder: string) => {
    const separator = source.lastIndexOf("/");
    const currentParent = separator < 0 ? "" : source.slice(0, separator);
    return (
      currentParent !== targetFolder &&
      source !== targetFolder &&
      !targetFolder.startsWith(`${source}/`)
    );
  };

  const showPreview = async (entry: FileEntry) => {
    if (entry.kind !== "markdown" && entry.kind !== "text") return;
    if (preview?.path === entry.path) return;
    const request = ++previewRequestRef.current;
    setPreview({ path: entry.path, loading: true });
    try {
      const content = await onPreview(entry.path);
      if (request !== previewRequestRef.current) return;
      setPreview({ path: entry.path, content: content ?? undefined, loading: false });
    } catch {
      if (request === previewRequestRef.current) setPreview({ path: entry.path, loading: false });
    }
  };

  const hidePreview = (path: string) => {
    if (preview?.path !== path) return;
    previewRequestRef.current += 1;
    setPreview(undefined);
  };
  const children = useMemo(() => {
    const grouped = new Map<string, FileEntry[]>();
    for (const entry of entries) {
      if (!showArchived && (entry.path === "archive" || entry.path.startsWith("archive/")))
        continue;
      const separator = entry.path.lastIndexOf("/");
      const parent = separator < 0 ? "" : entry.path.slice(0, separator);
      const list = grouped.get(parent) ?? [];
      list.push(entry);
      grouped.set(parent, list);
    }
    for (const list of grouped.values()) {
      list.sort((left, right) => {
        if (left.kind === "directory" && right.kind !== "directory") return -1;
        if (right.kind === "directory" && left.kind !== "directory") return 1;
        return sortByName
          ? left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
          : left.modifiedAt.localeCompare(right.modifiedAt);
      });
    }
    return grouped;
  }, [entries, showArchived, sortByName]);

  const beginCreate = (kind: "note" | "folder", parent: string) => {
    cancelInlineEditRef.current = false;
    if (parent) {
      updateExpandedPaths((current) => {
        const next = new Set(current);
        next.add(parent);
        return next;
      });
    }
    setInlineEdit({ kind, parent, value: kind === "note" ? "Untitled" : "New folder" });
  };

  const commitInlineEdit = () => {
    if (cancelInlineEditRef.current) {
      cancelInlineEditRef.current = false;
      setInlineEdit(undefined);
      return;
    }
    const current = inlineEdit;
    if (!current) return;
    setInlineEdit(undefined);
    const value = current.value.trim();
    if (!value) return;
    if (current.kind === "rename") onRename(current.entry.path, value);
    else if (current.kind === "note") onCreateNote(current.parent, value);
    else onCreateFolder(current.parent, value);
  };

  const renderInlineEdit = (parent: string, depth: number, entry?: FileEntry) => {
    if (!inlineEdit) return null;
    if (inlineEdit.kind === "rename") {
      if (!entry || inlineEdit.entry.path !== entry.path) return null;
    } else if (entry || inlineEdit.parent !== parent) return null;
    const directory = inlineEdit.kind === "folder" || entry?.kind === "directory";
    const label =
      inlineEdit.kind === "rename"
        ? `Rename ${entry?.name ?? "item"}`
        : inlineEdit.kind === "folder"
          ? "New folder name"
          : "New note name";
    return (
      <div
        role="treeitem"
        className="flex h-7 w-full items-center gap-1.5 pr-2 text-xs"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {directory ? (
          <FolderOpen className="size-3.5 shrink-0" />
        ) : (
          <FileText className="size-3.5 shrink-0" />
        )}
        <input
          autoFocus
          aria-label={label}
          value={inlineEdit.value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setInlineEdit({ ...inlineEdit, value: event.target.value })}
          onBlur={commitInlineEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitInlineEdit();
            if (event.key === "Escape") {
              cancelInlineEditRef.current = true;
              setInlineEdit(undefined);
            }
          }}
          className="h-6 min-w-0 flex-1 rounded-sm border bg-background px-1.5 outline-none focus:ring-1 focus:ring-ring [border-color:var(--layout-separator)]"
        />
      </div>
    );
  };

  const submitDialog = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    const folder = value.replace(/^\/+|\/+$/g, "");
    onMove(dialog.entry.path, folder ? `${folder}/${dialog.entry.name}` : dialog.entry.name);
    setDialog(undefined);
  };

  const renderEntry = (entry: FileEntry, depth: number) => {
    if (inlineEdit?.kind === "rename" && inlineEdit.entry.path === entry.path) {
      return <div key={entry.path}>{renderInlineEdit("", depth, entry)}</div>;
    }
    const directory = entry.kind === "directory";
    const expanded = expandedPaths.has(entry.path);
    const presentation = filePresentation(entry);
    const metadata = entryMetadata(entry);
    const row = (
      <button
        ref={entry.path === activePath ? activeRef : undefined}
        type="button"
        role="treeitem"
        data-flux-drop-folder={directory ? entry.path : undefined}
        aria-expanded={directory ? expanded : undefined}
        aria-selected={entry.path === activePath}
        aria-label={`${presentation.label}, ${metadata}`}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (!directory) {
            const separator = entry.path.lastIndexOf("/");
            setSelectedFolder(separator < 0 ? "" : entry.path.slice(0, separator));
            onSelectPath?.(entry.path);
            onOpen(entry.path);
            return;
          }
          setSelectedFolder(entry.path);
          onSelectPath?.(entry.path);
          updateExpandedPaths((current) => {
            const next = new Set(current);
            if (next.has(entry.path)) next.delete(entry.path);
            else next.add(entry.path);
            return next;
          });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          pointerDragRef.current = {
            source: entry.path,
            startX: event.clientX,
            startY: event.clientY,
            pointerId: event.pointerId,
            dragging: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerEnter={(event) => {
          if (event.metaKey || event.ctrlKey) void showPreview(entry);
        }}
        onPointerMove={(event) => {
          const drag = pointerDragRef.current;
          if (drag?.pointerId === event.pointerId) {
            const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
            if (distance >= 5) drag.dragging = true;
            if (drag.dragging) {
              event.preventDefault();
              const target = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest<HTMLElement>("[data-flux-drop-folder]")?.dataset.fluxDropFolder;
              drag.target =
                target !== undefined && canMoveTo(drag.source, target) ? target : undefined;
              setDropTarget(drag.target);
            }
          }
          if ((event.metaKey || event.ctrlKey) && preview?.path !== entry.path)
            void showPreview(entry);
        }}
        onPointerUp={(event) => {
          const drag = pointerDragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          pointerDragRef.current = undefined;
          setDropTarget(undefined);
          if (!drag.dragging || drag.target === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          const name = drag.source.slice(drag.source.lastIndexOf("/") + 1);
          onMove(drag.source, drag.target ? `${drag.target}/${name}` : name);
          setSelectedFolder(drag.target);
        }}
        onPointerCancel={() => {
          pointerDragRef.current = undefined;
          setDropTarget(undefined);
        }}
        onPointerLeave={() => hidePreview(entry.path)}
        className={`flex w-full min-w-0 max-w-full select-none items-center gap-1.5 overflow-hidden rounded-md py-1.5 pr-2 text-left text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 ${
          dropTarget === entry.path
            ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/50"
            : entry.path === activePath
              ? "bg-sidebar-selected text-sidebar-accent-foreground font-medium ring-2 ring-[var(--layout-separator)] ring-inset"
              : "text-muted-foreground"
        }`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {directory ? (
          <ChevronRight className={`size-3.5 shrink-0 ${expanded ? "rotate-90" : ""}`} />
        ) : null}
        {directory ? (
          <FolderOpen className="size-3.5 shrink-0" />
        ) : (
          <FileText className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{presentation.label}</span>
        {presentation.badge ? (
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            {presentation.badge}
          </span>
        ) : null}
      </button>
    );

    return (
      <div key={entry.path}>
        <ContextMenu.Root>
          <HoverCard.Root
            open={preview?.path === entry.path}
            onOpenChange={(open) => !open && hidePreview(entry.path)}
          >
            <Tooltip open={preview?.path === entry.path ? false : undefined}>
              <ContextMenu.Trigger asChild>
                <TooltipTrigger asChild>
                  <HoverCard.Trigger asChild>{row}</HoverCard.Trigger>
                </TooltipTrigger>
              </ContextMenu.Trigger>
              <TooltipContent side="right" sideOffset={8} className="max-w-72 items-start">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{entry.path}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{metadata}</span>
                </span>
              </TooltipContent>
            </Tooltip>
            <HoverCard.Portal>
              <HoverCard.Content
                side="right"
                align="start"
                sideOffset={10}
                collisionPadding={12}
                className="z-[160] w-[30rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]"
              >
                <div className="grid grid-cols-[3px_minmax(0,1fr)] border-b [border-color:var(--layout-separator)]">
                  <span className="bg-primary/70" aria-hidden="true" />
                  <div className="px-4 py-3">
                    <p className="truncate text-sm font-semibold tracking-tight">
                      {presentation.label}
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {entry.path}
                    </p>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">{metadata}</p>
                  </div>
                </div>
                <div className="max-h-96 overflow-auto bg-background/70">
                  {preview?.loading ? (
                    <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
                      <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none" />
                      Loading preview…
                    </div>
                  ) : preview?.content?.trim() ? (
                    <div className="[&_.flux-reading-view]:max-w-none [&_.flux-reading-view]:px-5 [&_.flux-reading-view]:pb-8 [&_.flux-reading-view]:pt-4 [&_.flux-reading-view]:text-sm">
                      <ReadingView
                        value={splitFrontmatter(preview.content).body}
                        documents={documents}
                      />
                    </div>
                  ) : (
                    <p className="p-4 text-xs text-muted-foreground">Empty file</p>
                  )}
                </div>
              </HoverCard.Content>
            </HoverCard.Portal>
          </HoverCard.Root>
          <ContextMenu.Portal>
            <ContextMenu.Content className={menuClass}>
              {directory ? (
                <>
                  <ContextMenu.Item
                    className={itemClass}
                    onSelect={() => beginCreate("note", entry.path)}
                  >
                    New note
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={itemClass}
                    onSelect={() => beginCreate("folder", entry.path)}
                  >
                    New folder
                  </ContextMenu.Item>
                  <ContextMenu.Separator className="my-1 h-px bg-[var(--layout-separator)]" />
                </>
              ) : null}
              <ContextMenu.Item
                className={itemClass}
                onSelect={() => setDialog({ kind: "move", entry, value: "" })}
              >
                Move {directory ? "folder" : "file"} to…
              </ContextMenu.Item>
              <ContextMenu.Item
                className={itemClass}
                onSelect={() => {
                  cancelInlineEditRef.current = false;
                  setInlineEdit({ kind: "rename", entry, value: entry.name });
                }}
              >
                Rename…
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-1 h-px bg-[var(--layout-separator)]" />
              {entry.path !== "archive" && !entry.path.startsWith("archive/") ? (
                <ContextMenu.Item className={itemClass} onSelect={() => onArchive(entry.path)}>
                  Move to archive
                </ContextMenu.Item>
              ) : null}
              <ContextMenu.Item
                className={`${itemClass} text-destructive`}
                onSelect={() => onDelete(entry.path)}
              >
                Move to trash
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        {directory && expanded ? (
          <div role="group" className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-[color-mix(in_oklab,var(--muted-foreground)_16%,transparent)]"
              style={{ left: 15 + depth * 16 }}
            />
            {renderInlineEdit(entry.path, depth + 1)}
            {(children.get(entry.path) ?? []).map((child) => renderEntry(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-9 shrink-0 items-center justify-center gap-0.5 bg-sidebar px-2">
        <button
          type="button"
          aria-label="New note"
          title="New note"
          onClick={() => beginCreate("note", creationFolder)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <FilePlus2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="New folder"
          title="New folder"
          onClick={() => beginCreate("folder", creationFolder)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <FolderPlus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={showArchived ? "Hide archived files" : "Show archived files"}
          title={showArchived ? "Hide archived files" : "Show archived files"}
          onClick={() => setShowArchived((current) => !current)}
          className={`grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent ${showArchived ? "bg-accent" : ""}`}
        >
          <Archive className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Open trash"
          title="Open trash"
          onClick={onOpenTrash}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Sort: ${sortByName ? "Name" : "Modified"}`}
          title="Change sort order"
          onClick={() => setSortByName((current) => !current)}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ListFilter className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Collapse all"
          title="Collapse all"
          onClick={() => updateExpandedPaths(() => new Set())}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
      <div
        data-flux-drop-folder=""
        className={`flux-editor-scroll flux-sidebar-scroll min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto p-1.5 ${dropTarget === "" ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : ""}`}
        role="tree"
        aria-label="Files"
        onClick={(event) => {
          if (event.currentTarget === event.target) setSelectedFolder("");
        }}
      >
        {renderInlineEdit("", 0)}
        {(children.get("") ?? []).map((entry) => renderEntry(entry, 0))}
      </div>
      {dialog ? (
        <div className="fixed inset-0 z-[190] grid place-items-center bg-black/35 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-popover p-5 shadow-2xl [border-color:var(--layout-separator)]">
            <label className="text-sm font-semibold" htmlFor="vault-operation-value">
              Move to folder
            </label>
            <input
              id="vault-operation-value"
              autoFocus
              value={dialog.value}
              placeholder="Vault root"
              onChange={(event) => setDialog({ ...dialog, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitDialog();
              }}
              className="mt-3 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50 [border-color:var(--layout-separator)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(undefined)}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDialog}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                Move
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
