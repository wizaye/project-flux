import { lazy, Suspense, useEffect, useState } from "react";
import type { FluxClient, VaultGraph } from "@flux/bridge-contract";
import type { DemoDocument } from "../editor/markdown-editor";
const emptyDocuments: DemoDocument[] = [];
const GraphView = lazy(() => import("../workspace/graph-view").then((module) => ({ default: module.GraphView })));

export function WorkbenchGraph({ client, vaultId, onOpenDocument, onSplit, onSearchTag }: {
  client: FluxClient;
  vaultId: string;
  onOpenDocument: (path: string) => void;
  onSplit: (placement: "right" | "bottom") => void;
  onSearchTag: (tag: string) => void;
}) {
  const [graph, setGraph] = useState<VaultGraph>();
  const [error, setError] = useState<string>();
  const [bookmarked, setBookmarked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      try {
        const next = await client.getGraph(vaultId);
        if (!cancelled && request === revision) { setGraph(next); setError(undefined); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load graph");
      }
    };
    void load();
    const stop = client.watchVaultChanges(vaultId, () => void load());
    return () => { cancelled = true; stop(); };
  }, [client, vaultId]);
  if (error) return <p role="alert" className="p-4 text-sm text-destructive">{error}</p>;
  if (!graph) return <p role="status" className="p-4 text-sm text-muted-foreground">Loading graph…</p>;
  return <Suspense fallback={<p role="status" className="p-4">Loading graph…</p>}>
    <GraphView embedded documents={emptyDocuments} vaultGraph={graph} bookmarked={bookmarked}
      onBookmarkChange={setBookmarked} onOpenDocument={onOpenDocument}
      onSearchTag={onSearchTag}
      onSplitRight={() => onSplit("right")} onSplitDown={() => onSplit("bottom")} />
  </Suspense>;
}
