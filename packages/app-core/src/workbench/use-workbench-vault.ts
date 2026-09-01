import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FileDocument,
  FileEntry,
  RecentVault,
  VaultInfo,
  VaultLocation,
} from "@flux/bridge-contract";
import type { EditorTab } from "@flux/shared-ui/components/design-system/workbench/editor/editor-area";

import type { FluxRuntime } from "../App";
import { decodedText, singleTextEdit } from "../app/helpers";
import type { FluxStatePersistence } from "../app/state";

export function useWorkbenchVault({
  runtime,
  persistence,
  windowId,
}: {
  runtime: FluxRuntime;
  persistence: FluxStatePersistence;
  windowId?: string;
}) {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [recent, setRecent] = useState<RecentVault[]>([]);
  const [available, setAvailable] = useState<VaultLocation[]>([]);
  const [documents, setDocuments] = useState<Record<string, FileDocument>>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [status, setStatus] = useState("No vault open");
  const documentsRef = useRef(documents);
  const savedDocumentsRef = useRef(new Map<string, FileDocument>());
  const movedPathsRef = useRef(new Map<string, string>());
  const saveTimers = useRef(new Map<string, number>());
  const saveChains = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const refreshFiles = useCallback(
    async (vaultId = vault?.id) => {
      if (!runtime.client || !vaultId) return;
      setFiles(await runtime.client.listFiles(vaultId));
    },
    [runtime.client, vault?.id]
  );

  const loadVault = useCallback(
    async (info: VaultInfo) => {
      if (!runtime.client) return;
      setVault(info);
      setDocuments({});
      savedDocumentsRef.current.clear();
      movedPathsRef.current.clear();
      setFiles(await runtime.client.listFiles(info.id));
      setStatus(info.name);
      setManagerOpen(false);
    },
    [runtime.client]
  );

  useEffect(() => {
    if (!runtime.client || !windowId) return;
    let cancelled = false;
    void Promise.all([
      runtime.client.getBootstrap(windowId),
      runtime.client.listRecentVaults(),
      runtime.client.listAvailableVaults(),
    ])
      .then(async ([bootstrap, nextRecent, nextAvailable]) => {
        if (cancelled) return;
        setRecent(nextRecent);
        setAvailable(nextAvailable);
        const vaultId = bootstrap.workspace?.vaultId ?? nextRecent[0]?.vaultId;
        const location =
          nextAvailable.find((item) => item.vaultId === vaultId) ??
          nextRecent.find((item) => item.vaultId === vaultId);
        if (location) await loadVault(await runtime.client!.openVault({ path: location.path }));
        else setManagerOpen(true);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not load vaults");
          setManagerOpen(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadVault, runtime.client, windowId]);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    return runtime.client.watchVaultChanges(vault.id, () => {
      void refreshFiles(vault.id);
    });
  }, [refreshFiles, runtime.client, vault]);

  useEffect(
    () => () => {
      for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    },
    []
  );

  const openFile = useCallback(
    async (path: string): Promise<EditorTab | undefined> => {
      if (!runtime.client || !vault) return;
      const entry = files.find((item) => item.path === path);
      if (entry?.kind === "directory") return;
      let document = documentsRef.current[path];
      if (!document) {
        if (entry?.kind === "binary") {
          const data = await runtime.client.readBinaryFile(vault.id, path);
          const content = decodedText(data);
          if (content === null) {
            return {
              id: `file:${path}`,
              title: entry.name,
              content: "Binary preview is not available.",
              readOnly: true,
            };
          }
          document = { path, content, contentHash: "", modifiedAt: entry.modifiedAt };
        } else {
          document = await runtime.client.readFile(vault.id, path);
        }
        documentsRef.current = { ...documentsRef.current, [path]: document };
        savedDocumentsRef.current.set(path, document);
        setDocuments(documentsRef.current);
      }
      return {
        id: `file:${path}`,
        title: path.split("/").pop() ?? path,
        content: document.content,
      };
    },
    [files, runtime.client, vault]
  );

  const changeDocument = useCallback(
    (path: string, content: string, onSaved: () => void) => {
      if (!runtime.client || !vault) return;
      path = resolveMovedPath(movedPathsRef.current, path);
      const current = documentsRef.current[path];
      if (!current || current.content === content) return;
      const next = { ...current, content };
      documentsRef.current = { ...documentsRef.current, [path]: next };
      setDocuments(documentsRef.current);
      const previousTimer = saveTimers.current.get(path);
      if (previousTimer) window.clearTimeout(previousTimer);
      saveTimers.current.set(
        path,
        window.setTimeout(() => {
          saveTimers.current.delete(path);
          const latest = documentsRef.current[path];
          if (!latest) return;
          const targetContent = latest.content;
          const previous = saveChains.current.get(path) ?? Promise.resolve();
          const nextSave = previous
            .catch(() => undefined)
            .then(async () => {
              const base = savedDocumentsRef.current.get(path) ?? current;
              if (base.content === targetContent) return;
              const saved = base.contentHash
                ? await runtime.client!.patchFile({
                    vaultId: vault.id,
                    path,
                    expectedHash: base.contentHash,
                    edits: [singleTextEdit(base.content, targetContent)],
                  })
                : await runtime.client!.saveFile({
                    vaultId: vault.id,
                    path,
                    content: targetContent,
                  });
              const savedDocument = {
                ...base,
                content: targetContent,
                contentHash: saved.contentHash,
                modifiedAt: saved.modifiedAt,
              };
              savedDocumentsRef.current.set(path, savedDocument);
              const visible = documentsRef.current[path];
              if (visible) {
                documentsRef.current = {
                  ...documentsRef.current,
                  [path]: {
                    ...visible,
                    contentHash: saved.contentHash,
                    modifiedAt: saved.modifiedAt,
                  },
                };
                setDocuments(documentsRef.current);
              }
              setStatus(`Saved ${path}`);
              if (visible?.content === targetContent) onSaved();
            })
            .catch((error) =>
              setStatus(error instanceof Error ? error.message : `Could not save ${path}`)
            );
          saveChains.current.set(path, nextSave);
        }, 500)
      );
    },
    [runtime.client, vault]
  );

  const chooseVault = useCallback(
    async (mode: "open" | "create") => {
      if (!runtime.client || !runtime.selectVaultDirectory) return;
      const path = await runtime.selectVaultDirectory(mode);
      if (!path) return;
      const info =
        mode === "create"
          ? await runtime.client.createVault({ path })
          : await runtime.client.openVault({ path });
      await persistence.rememberVault({ id: info.id, name: info.name, path });
      await loadVault(info);
      const [nextRecent, nextAvailable] = await Promise.all([
        runtime.client.listRecentVaults(),
        runtime.client.listAvailableVaults(),
      ]);
      setRecent(nextRecent);
      setAvailable(nextAvailable);
    },
    [loadVault, persistence, runtime]
  );

  const openVault = useCallback(
    async (location: { path: string }) => {
      if (!runtime.client) return;
      await loadVault(await runtime.client.openVault({ path: location.path }));
    },
    [loadVault, runtime.client]
  );

  const createFile = useCallback(
    async (parent: string | undefined, name: string) => {
      if (!runtime.client || !vault) return;
      const path = resourcePath(parent, name);
      await runtime.client.createFile({ vaultId: vault.id, path, content: "" });
      await refreshFiles();
      return openFile(path);
    },
    [openFile, refreshFiles, runtime.client, vault]
  );

  const createFolder = useCallback(
    async (parent: string | undefined, name: string) => {
      if (!runtime.client || !vault) return;
      await runtime.client.createDirectory(vault.id, resourcePath(parent, name));
      await refreshFiles();
    },
    [refreshFiles, runtime.client, vault]
  );

  const renameFile = useCallback(
    async (path: string, name: string) => {
      if (!runtime.client || !vault) return;
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const destinationPath = resourcePath(parent, name);
      if (destinationPath === path) return;
      const affectedDocuments = Object.entries(documentsRef.current).filter(
        ([documentPath]) => documentPath === path || documentPath.startsWith(`${path}/`)
      );
      for (const [documentPath] of affectedDocuments) {
        const timer = saveTimers.current.get(documentPath);
        if (timer) window.clearTimeout(timer);
        saveTimers.current.delete(documentPath);
        await saveChains.current.get(documentPath)?.catch(() => undefined);
      }
      await runtime.client.moveFile({ vaultId: vault.id, sourcePath: path, destinationPath });
      const nextDocuments = { ...documentsRef.current };
      for (const [documentPath, document] of affectedDocuments) {
        const nextPath = `${destinationPath}${documentPath.slice(path.length)}`;
        const saved = await runtime.client.saveFile({
          vaultId: vault.id,
          path: nextPath,
          content: document.content,
        });
        const nextDocument = {
          ...document,
          path: nextPath,
          contentHash: saved.contentHash,
          modifiedAt: saved.modifiedAt,
        };
        delete nextDocuments[documentPath];
        nextDocuments[nextPath] = nextDocument;
        movedPathsRef.current.set(documentPath, nextPath);
        savedDocumentsRef.current.delete(documentPath);
        savedDocumentsRef.current.set(nextPath, nextDocument);
      }
      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      await refreshFiles();
    },
    [refreshFiles, runtime.client, vault]
  );

  const deleteFile = useCallback(
    async (path: string) => {
      if (!runtime.client || !vault) return;
      await runtime.client.deleteFile(vault.id, path);
      await refreshFiles();
    },
    [refreshFiles, runtime.client, vault]
  );

  const forgetVault = useCallback(
    async (vaultId: string) => {
      if (!runtime.client) return;
      await runtime.client.forgetVault(vaultId);
      setRecent(await runtime.client.listRecentVaults());
    },
    [runtime.client]
  );

  const backlinkCount = useCallback(
    async (path: string) => {
      if (!runtime.client || !vault) return 0;
      const references = await runtime.client.getDocumentReferences(
        vault.id,
        resolveMovedPath(movedPathsRef.current, path)
      );
      return references.linked.length;
    },
    [runtime.client, vault]
  );

  return {
    vault,
    files,
    recent,
    available,
    documents,
    managerOpen,
    setManagerOpen,
    status,
    refreshFiles,
    openFile,
    changeDocument,
    chooseVault,
    openVault,
    createFile,
    createFolder,
    renameFile,
    deleteFile,
    forgetVault,
    backlinkCount,
  };
}

export function resourcePath(parent: string | undefined, requestedName: string) {
  const name = requestedName.trim();
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
    throw new Error("Use a name without slashes.");
  }
  return parent ? `${parent}/${name}` : name;
}

function resolveMovedPath(movedPaths: ReadonlyMap<string, string>, path: string) {
  let resolved = path;
  for (let index = 0; index < movedPaths.size; index += 1) {
    const next = movedPaths.get(resolved);
    if (!next) break;
    resolved = next;
  }
  return resolved;
}
