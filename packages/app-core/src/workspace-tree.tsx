import type { ReactNode } from "react";
import { ResizableSplit } from "./resizable-split";

export type WorkspaceLeafView = "editor" | "graph" | "pdf";

export type WorkspaceNode =
  | {
      kind: "leaf";
      id: number;
      view: WorkspaceLeafView;
      tabIds: number[];
      activeTabId: number;
      stacked?: boolean;
    }
  | {
      kind: "split";
      id: number;
      direction: "horizontal" | "vertical";
      children: [WorkspaceNode, WorkspaceNode];
    };

export function mapWorkspaceLeaf(
  node: WorkspaceNode,
  id: number,
  update: (leaf: Extract<WorkspaceNode, { kind: "leaf" }>) => WorkspaceNode
): WorkspaceNode {
  if (node.kind === "leaf") return node.id === id ? update(node) : node;
  return {
    ...node,
    children: [
      mapWorkspaceLeaf(node.children[0], id, update),
      mapWorkspaceLeaf(node.children[1], id, update),
    ],
  };
}

export function mapWorkspaceLeaves(
  node: WorkspaceNode,
  update: (
    leaf: Extract<WorkspaceNode, { kind: "leaf" }>
  ) => Extract<WorkspaceNode, { kind: "leaf" }>
): WorkspaceNode {
  if (node.kind === "leaf") return update(node);
  return {
    ...node,
    children: [
      mapWorkspaceLeaves(node.children[0], update),
      mapWorkspaceLeaves(node.children[1], update),
    ],
  };
}

export function removeWorkspaceLeaf(node: WorkspaceNode, id: number): WorkspaceNode | null {
  if (node.kind === "leaf") return node.id === id ? null : node;
  const first = removeWorkspaceLeaf(node.children[0], id);
  const second = removeWorkspaceLeaf(node.children[1], id);
  if (!first) return second;
  if (!second) return first;
  return { ...node, children: [first, second] };
}

export function findWorkspaceLeaf(
  node: WorkspaceNode,
  id: number
): Extract<WorkspaceNode, { kind: "leaf" }> | null {
  if (node.kind === "leaf") return node.id === id ? node : null;
  return findWorkspaceLeaf(node.children[0], id) ?? findWorkspaceLeaf(node.children[1], id);
}

export function workspaceLeaves(
  node: WorkspaceNode
): Array<Extract<WorkspaceNode, { kind: "leaf" }>> {
  if (node.kind === "leaf") return [node];
  return [...workspaceLeaves(node.children[0]), ...workspaceLeaves(node.children[1])];
}

export function workspaceEdgeLeafIds(node: WorkspaceNode, edge: "left" | "right"): number[] {
  if (node.kind === "leaf") return [node.id];
  if (node.direction === "horizontal") {
    return workspaceEdgeLeafIds(node.children[edge === "left" ? 0 : 1], edge);
  }
  return [
    ...workspaceEdgeLeafIds(node.children[0], edge),
    ...workspaceEdgeLeafIds(node.children[1], edge),
  ];
}

export function workspaceHasTab(node: WorkspaceNode, tabId: number) {
  return workspaceLeaves(node).some((leaf) => leaf.tabIds.includes(tabId));
}

export function closeOtherWorkspaceTabs(
  node: WorkspaceNode,
  leafId: number,
  tabId: number
): WorkspaceNode {
  const leaf = findWorkspaceLeaf(node, leafId);
  if (!leaf?.tabIds.includes(tabId)) return node;
  return mapWorkspaceLeaf(node, leafId, (current) => ({
    ...current,
    tabIds: [tabId],
    activeTabId: tabId,
  }));
}

export function closeWorkspaceTabsAfter(
  node: WorkspaceNode,
  leafId: number,
  tabId: number
): WorkspaceNode {
  const leaf = findWorkspaceLeaf(node, leafId);
  const tabIndex = leaf?.tabIds.indexOf(tabId) ?? -1;
  if (!leaf || tabIndex < 0 || tabIndex === leaf.tabIds.length - 1) return node;
  const tabIds = leaf.tabIds.slice(0, tabIndex + 1);
  return mapWorkspaceLeaf(node, leafId, (current) => ({
    ...current,
    tabIds,
    activeTabId: tabIds.includes(current.activeTabId) ? current.activeTabId : tabId,
  }));
}

export function moveWorkspaceTab(
  node: WorkspaceNode,
  tabId: number,
  sourceLeafId: number,
  targetLeafId: number
) {
  if (sourceLeafId === targetLeafId) return node;
  const source = findWorkspaceLeaf(node, sourceLeafId);
  if (!source || !findWorkspaceLeaf(node, targetLeafId)) return node;

  let next = mapWorkspaceLeaf(node, targetLeafId, (leaf) => ({
    ...leaf,
    view: "editor",
    tabIds: leaf.tabIds.includes(tabId) ? leaf.tabIds : [...leaf.tabIds, tabId],
    activeTabId: tabId,
  }));
  if (source.tabIds.length === 1) return removeWorkspaceLeaf(next, sourceLeafId) ?? next;

  next = mapWorkspaceLeaf(next, sourceLeafId, (leaf) => {
    const tabIds = leaf.tabIds.filter((id) => id !== tabId);
    return {
      ...leaf,
      tabIds,
      activeTabId: leaf.activeTabId === tabId ? tabIds[0] : leaf.activeTabId,
    };
  });
  return next;
}

export function WorkspaceTree({
  node,
  renderLeaf,
}: {
  node: WorkspaceNode;
  renderLeaf: (leaf: Extract<WorkspaceNode, { kind: "leaf" }>) => ReactNode;
}) {
  if (node.kind === "leaf") return renderLeaf(node);

  return (
    <ResizableSplit direction={node.direction} minSize={14}>
      {[
        <WorkspaceTree key={node.children[0].id} node={node.children[0]} renderLeaf={renderLeaf} />,
        <WorkspaceTree key={node.children[1].id} node={node.children[1]} renderLeaf={renderLeaf} />,
      ]}
    </ResizableSplit>
  );
}
