import {
  lazy,
  Suspense,
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { AnimatePresence, LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import type { VaultGraph } from "@flux/bridge-contract";
import {
  FluxTab,
  FluxTabAddButton,
  FluxTabBar,
  FluxTabMenu,
  FluxStackedTab,
} from "@flux/shared-ui/components/flux-tabs";
import {
  FluxEditorPane,
  FluxTabContextMenu,
  type FluxTabCommands,
} from "@flux/shared-ui/components/workspace-tab";
import type { DemoDocument } from "../editor/markdown-editor";
import { mapWorkspaceLeaf, type WorkspaceNode } from "./tree";
import type { WorkspaceTab } from "./tabs";

const PdfViewer = lazy(() =>
  import("../pdf/viewer").then((module) => ({ default: module.PdfViewer }))
);
const GraphView = lazy(() =>
  import("./graph-view").then((module) => ({ default: module.GraphView }))
);

type Leaf = Extract<WorkspaceNode, { kind: "leaf" }>;
export interface WorkspaceFileDrop {
  leafId: number;
  zone: "center" | "left" | "right" | "top" | "bottom";
}

export interface WorkspaceLeafContext {
  tabs: WorkspaceTab[];
  activeLeafId: number;
  setActiveLeafId: Dispatch<SetStateAction<number>>;
  setActiveTabId: Dispatch<SetStateAction<number>>;
  workspaceFileDrop?: WorkspaceFileDrop;
  setWorkspaceFileDrop: Dispatch<SetStateAction<WorkspaceFileDrop | undefined>>;
  workspaceDropZone: (event: DragEvent, element: HTMLDivElement) => WorkspaceFileDrop["zone"];
  moveTabToLeaf: (event: DragEvent<HTMLDivElement>, leafId: number) => void;
  dropFileIntoWorkspace: (event: DragEvent<HTMLDivElement>, leaf: Leaf) => void;
  leftEdgeLeafIds: Set<number>;
  rightEdgeLeafIds: Set<number>;
  addTab: () => void;
  setWorkspaceRoot: Dispatch<SetStateAction<WorkspaceNode>>;
  closeAllTabs: (leafId: number) => void;
  activateLeafTab: (leafId: number, tabId: number) => void;
  commandsFor: (tab: WorkspaceTab, leafId?: number) => FluxTabCommands;
  markDraggedTab: (
    event: DragEvent<HTMLDivElement>,
    title: string,
    tabId: number,
    leafId: number
  ) => void;
  wasDroppedAtWindowEdge: (event: DragEvent<HTMLDivElement>) => boolean;
  popOutTab: (tab: WorkspaceTab) => void;
  moveTabBefore: (event: DragEvent, leafId: number, tabId: number) => void;
  closeLeafTab: (leafId: number, tabId: number) => void;
  paneFor: (tab: WorkspaceTab, leafId?: number) => ReactNode;
  isProtectedNewTab: (tab: WorkspaceTab, leafId: number) => boolean;
  documents: DemoDocument[];
  vaultGraph: VaultGraph | null;
  isTabBookmarked: (tab: WorkspaceTab) => boolean;
  handleOpenAddBookmark: (target?: { title: string; path?: string } | null) => void;
  openDocument: (identifier: string) => Promise<unknown>;
  splitLeaf: (leafId: number, direction: "horizontal" | "vertical") => void;
}

export function WorkspaceLeaf({ leaf, context }: { leaf: Leaf; context: WorkspaceLeafContext }) {
  const {
    tabs,
    activeLeafId,
    setActiveLeafId,
    setActiveTabId,
    workspaceFileDrop,
    setWorkspaceFileDrop,
    workspaceDropZone,
    moveTabToLeaf,
    dropFileIntoWorkspace,
    leftEdgeLeafIds,
    rightEdgeLeafIds,
    addTab,
    setWorkspaceRoot,
    closeAllTabs,
    activateLeafTab,
    commandsFor,
    markDraggedTab,
    wasDroppedAtWindowEdge,
    popOutTab,
    moveTabBefore,
    closeLeafTab,
    paneFor,
    isProtectedNewTab,
    documents,
    vaultGraph,
    isTabBookmarked,
    handleOpenAddBookmark,
    openDocument,
    splitLeaf,
  } = context;
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
}
