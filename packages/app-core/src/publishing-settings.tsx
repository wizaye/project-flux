import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  FileEntry,
  FluxClient,
  Publication,
  PublicationConnector,
  PublicationDeployment,
  PublicationJob,
  PublicationRenderer,
  PublicationSnapshotResult,
} from "@flux/bridge-contract";
import { Button } from "@flux/shared-ui/components/ui/button";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Globe2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

interface PublishingSettingsProps {
  client: FluxClient | null;
  vaultId?: string;
  openPublicationPreview?: (sitePath: string) => Promise<void>;
}

const fieldClass =
  "h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none [border-color:var(--layout-separator)] focus-visible:ring-1 focus-visible:ring-ring";

export function PublishingSettings({
  client,
  vaultId,
  openPublicationPreview,
}: PublishingSettingsProps) {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [connectors, setConnectors] = useState<PublicationConnector[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Publication | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [renderer, setRenderer] = useState<PublicationRenderer["id"]>("flux");
  const [provider, setProvider] = useState<PublicationDeployment["provider"]>("bundle");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [branch, setBranch] = useState("gh-pages");
  const [project, setProject] = useState("");
  const [review, setReview] = useState<Publication | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<Record<string, PublicationSnapshotResult>>({});

  const refresh = useCallback(async () => {
    if (!client || !vaultId) return;
    setPublications(await client.listPublications(vaultId));
  }, [client, vaultId]);

  useEffect(() => {
    void refresh().catch((cause) => setMessage(errorMessage(cause)));
  }, [refresh]);

  useEffect(() => {
    if (!client) return;
    void client
      .listPublicationConnectors()
      .then(setConnectors)
      .catch(() => setConnectors([]));
  }, [client]);

  const create = async () => {
    if (!client || !vaultId || !name.trim()) return;
    setBusy("create");
    setMessage("");
    try {
      const deployment = {
        provider,
        repositoryUrl: provider === "github-pages" ? repositoryUrl.trim() : undefined,
        branch: provider === "github-pages" ? branch.trim() : undefined,
        project:
          provider === "vercel" ||
          provider === "cloudflare-pages" ||
          provider === "netlify" ||
          provider === "flowershow"
            ? project.trim()
            : undefined,
      } as const;
      const rendererConfig = { id: renderer } as const;
      const publication = editing
        ? await client.updatePublication(vaultId, editing.id, {
            name: name.trim(),
            title: title.trim() || name.trim(),
            include: editing.selection.include,
            exclude: editing.selection.exclude,
            explicitPaths: editing.explicitPaths ?? [],
            renderer: rendererConfig,
            deployment,
          })
        : await client.createPublication(vaultId, {
            name: name.trim(),
            title: title.trim() || name.trim(),
            include: [],
            exclude: ["private/**", "**/*.draft.md"],
            renderer: rendererConfig,
            deployment,
          });
      setName("");
      setTitle("");
      setEditing(null);
      setShowCreate(false);
      await refresh();
      if (!editing) await openReview(publication);
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy("");
    }
  };

  const startCreate = () => {
    setEditing(null);
    setName("");
    setTitle("");
    setRenderer("flux");
    setProvider("bundle");
    setRepositoryUrl("");
    setBranch("gh-pages");
    setProject("");
    setShowCreate(true);
  };

  const startEdit = (publication: Publication) => {
    setEditing(publication);
    setName(publication.name);
    setTitle(publication.title);
    setRenderer(publication.renderer?.id ?? "flux");
    setProvider(publication.deployment.provider);
    setRepositoryUrl(publication.deployment.repositoryUrl ?? "");
    setBranch(publication.deployment.branch ?? "gh-pages");
    setProject(publication.deployment.project ?? "");
    setShowCreate(true);
  };

  const openReview = async (publication: Publication) => {
    if (!client || !vaultId) return;
    setBusy(`review:${publication.id}`);
    setMessage("");
    try {
      const entries = (await client.listFiles(vaultId))
        .filter((entry) => entry.kind === "markdown" && !isInternal(entry.path))
        .sort((left, right) => left.path.localeCompare(right.path));
      setFiles(entries);
      setSelected(
        new Set(
          entries.filter((entry) => isSelected(entry.path, publication)).map((entry) => entry.path)
        )
      );
      setFilter("");
      setReview(publication);
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy("");
    }
  };

  const setupConnector = async () => {
    if (!client || provider === "bundle") return;
    setBusy(`connector:${provider}`);
    setMessage("");
    try {
      const updated = await client.setupPublicationConnector(provider);
      setConnectors((current) => [
        ...current.filter((item) => item.provider !== updated.provider),
        updated,
      ]);
      setMessage(updated.message || "Connector ready");
      for (let attempt = 0; attempt < 40 && !updated.authenticated; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const current = await client.listPublicationConnectors();
        setConnectors(current);
        if (connectorReady(current, provider)) {
          setMessage(`${providerName(provider)} connected`);
          break;
        }
      }
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy("");
    }
  };

  const build = async (production: boolean) => {
    if (!client || !vaultId || !review || selected.size === 0) return;
    const key = `${production ? "publish" : "preview"}:${review.id}`;
    setBusy(key);
    setJobStatus("Saving selection");
    setMessage("");
    try {
      const updated = await client.updatePublication(vaultId, review.id, {
        include: [],
        exclude: review.selection.exclude,
        explicitPaths: [...selected].sort(),
      });
      setReview(updated);
      const started = production
        ? await client.publishPublication(vaultId, review.id)
        : await client.previewPublication(vaultId, review.id);
      const completed = await waitForPublicationJob(client, vaultId, review.id, started, (status) =>
        setJobStatus(publicationStatus(status))
      );
      if (!completed.result) throw new Error(completed.error || "Publication build failed");
      const result = completed.result;
      setResults((current) => ({ ...current, [review.id]: result }));
      if (production) {
        setMessage(result.state === "published" ? "Published" : "Public site built");
        setReview(null);
      } else {
        if (openPublicationPreview) {
          await openPublicationPreview(result.sitePath);
        } else {
          const html = await client.getPublicationPreview(vaultId, review.id, result.snapshotId);
          openHTMLPreview(html);
        }
        setMessage("Preview opened in browser");
      }
      await refresh();
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy("");
      setJobStatus("");
    }
  };

  const unpublish = async (publication: Publication) => {
    if (!client || !vaultId || !window.confirm(`Unpublish “${publication.name}”?`)) return;
    setBusy(`unpublish:${publication.id}`);
    try {
      await client.unpublishPublication(vaultId, publication.id);
      await refresh();
      setMessage("Unpublished");
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy("");
    }
  };

  const remove = async (publication: Publication) => {
    if (!client || !vaultId || !window.confirm(`Delete “${publication.name}”?`)) return;
    setBusy(`delete:${publication.id}`);
    try {
      await client.deletePublication(vaultId, publication.id);
      await refresh();
      setMessage("Publication deleted");
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-2xl pb-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <Globe2 className="size-4" strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Publishing</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose notes, review public output, then publish.
            </p>
          </div>
        </div>
        <Button size="xs" onClick={startCreate}>
          <Plus /> New publication
        </Button>
      </header>

      {showCreate ? (
        <section className="mt-5 border-y py-4 [border-color:var(--layout-separator)]">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Engineering garden"
                className={fieldClass}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Site title
              </span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={name || "Engineering garden"}
                className={fieldClass}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Renderer</span>
              <select
                value={renderer}
                onChange={(event) => {
                  const next = event.target.value as PublicationRenderer["id"];
                  setRenderer(next);
                  if (next === "flowershow") setProvider("flowershow");
                  else if (provider === "flowershow") setProvider("bundle");
                }}
                className={fieldClass}
              >
                <option value="flux">Flux (built-in)</option>
                <option value="fumadocs">Fumadocs</option>
                <option value="quartz">Quartz</option>
                <option value="flowershow">Flowershow</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Hosting</span>
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value as typeof provider)}
                className={fieldClass}
                disabled={renderer === "flowershow"}
              >
                <option value="bundle">Export only</option>
                <option
                  value="github-pages"
                >
                  GitHub Pages
                </option>
                <option value="vercel">
                  Vercel
                </option>
                <option
                  value="cloudflare-pages"
                >
                  Cloudflare Pages
                </option>
                <option value="netlify">
                  Netlify
                </option>
                {renderer === "flowershow" ? (
                  <option
                    value="flowershow"
                  >
                    Flowershow
                  </option>
                ) : null}
              </select>
            </label>
            <div
              className="sm:col-span-2 flex flex-wrap items-center gap-1.5"
              aria-label="Publishing connectors"
            >
              {connectors.map((connector) => (
                <span
                  key={connector.provider}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] text-muted-foreground [border-color:var(--layout-separator)]"
                >
                  <span
                    className={`size-1.5 rounded-full ${connector.available ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                  />
                  {providerName(connector.provider)} · {connector.message || "Not set up"}
                </span>
              ))}
            </div>
            {renderer === "flowershow" ? (
              <p className="sm:col-span-2 text-[11px] text-muted-foreground">
                Local Preview uses Flux&apos;s safe content view. Flowershow Cloud performs the
                final render when you publish.
              </p>
            ) : null}
            {renderer === "quartz" || renderer === "fumadocs" ? (
              <p className="sm:col-span-2 text-[11px] text-muted-foreground">
                Flux downloads and maintains the pinned {rendererName(renderer)} renderer on first preview.
              </p>
            ) : null}
            {provider === "github-pages" ? (
              <label>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Branch</span>
                <input
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  className={fieldClass}
                />
              </label>
            ) : null}
            {provider === "vercel" ||
            provider === "cloudflare-pages" ||
            provider === "netlify" ||
            provider === "flowershow" ? (
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  {provider === "flowershow" ? "Flowershow site name" : "Project / site ID"}
                </span>
                <input
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                  placeholder={
                    name
                      .trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-") || "garden"
                  }
                  className={fieldClass}
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Flux keeps this connector isolated from your system installation.
                </span>
              </label>
            ) : null}
            {provider === "github-pages" ? (
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Repository
                </span>
                <input
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                  placeholder="https://github.com/owner/public-garden.git"
                  className={fieldClass}
                />
              </label>
            ) : null}
          </div>
          {provider !== "bundle" && !connectorReady(connectors, provider) ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2 [border-color:var(--layout-separator)]">
              <span className="text-xs text-muted-foreground">
                {connectorStatus(connectors, provider)}
              </span>
              <Button
                variant="outline"
                size="xs"
                loading={busy === `connector:${provider}`}
                onClick={() => void setupConnector()}
              >
                {connectorAvailable(connectors, provider) ? "Sign in" : "Set up"}
              </Button>
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setShowCreate(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              loading={busy === "create"}
              disabled={
                !name.trim() ||
                (provider !== "bundle" && !connectorReady(connectors, provider)) ||
                (provider === "github-pages" && (!repositoryUrl.trim() || !branch.trim())) ||
                ((provider === "vercel" ||
                  provider === "cloudflare-pages" ||
                  provider === "netlify" ||
                  provider === "flowershow") &&
                  !project.trim())
              }
              onClick={() => void create()}
            >
              {editing ? "Save changes" : "Continue"}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Your publications
        </div>
        <div className="divide-y border-y [border-color:var(--layout-separator)] divide-[var(--layout-separator)]">
          {publications.map((publication) => (
            <div key={publication.id} className="flex min-h-14 items-center gap-3 py-2.5">
              <div className="grid size-7 shrink-0 place-items-center rounded-md bg-muted">
                <Globe2 className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{publication.name}</span>
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground [border-color:var(--layout-separator)]">
                    {publication.state === "published" ? "Published" : "Draft"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {publication.deployment?.provider === "github-pages"
                    ? publication.publishedUrl || publication.deployment.repositoryUrl
                    : `${rendererName(publication.renderer?.id)} · ${providerName(publication.deployment?.provider)}`}
                </div>
              </div>
              {publication.publishedUrl ? (
                <a
                  href={publication.publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${publication.name}`}
                  className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
              <Button variant="ghost" size="xs" onClick={() => startEdit(publication)}>
                Edit
              </Button>
              <Button
                variant="outline"
                size="xs"
                loading={busy === `review:${publication.id}`}
                onClick={() => void openReview(publication)}
              >
                {publication.lastSnapshot ? "Publish changes" : "Choose notes"}
              </Button>
              {publication.state === "published" ? (
                <Button
                  variant="ghost"
                  size="xs"
                  loading={busy === `unpublish:${publication.id}`}
                  onClick={() => void unpublish(publication)}
                >
                  Unpublish
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete ${publication.name}`}
                disabled={publication.state === "published"}
                loading={busy === `delete:${publication.id}`}
                onClick={() => void remove(publication)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {publications.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No publications. Create one to choose public notes.
            </div>
          ) : null}
        </div>
      </section>

      {message ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}

      <PublishReviewDialog
        publication={review}
        files={files}
        selected={selected}
        filter={filter}
        result={review ? results[review.id] : undefined}
        busy={busy}
        jobStatus={jobStatus}
        onFilter={setFilter}
        onSelected={setSelected}
        onClose={() => setReview(null)}
        onPreview={() => void build(false)}
        onPublish={() => void build(true)}
      />
    </div>
  );
}

interface PublishReviewDialogProps {
  publication: Publication | null;
  files: FileEntry[];
  selected: Set<string>;
  filter: string;
  result?: PublicationSnapshotResult;
  busy: string;
  jobStatus: string;
  onFilter: (value: string) => void;
  onSelected: (value: Set<string>) => void;
  onClose: () => void;
  onPreview: () => void;
  onPublish: () => void;
}

function PublishReviewDialog({
  publication,
  files,
  selected,
  filter,
  result,
  busy,
  jobStatus,
  onFilter,
  onSelected,
  onClose,
  onPreview,
  onPublish,
}: PublishReviewDialogProps) {
  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files;
  }, [files, filter]);
  useEffect(() => {
    if (!publication) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [publication, onClose]);
  const included = visible.filter((file) => selected.has(file.path));
  const excluded = visible.filter((file) => !selected.has(file.path));
  const toggle = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onSelected(next);
  };

  if (!publication) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Publish changes"
    >
      <div className="flex h-[min(720px,calc(100vh-3rem))] w-[min(920px,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl border bg-background [border-color:var(--layout-separator)]">
        <header className="flex h-14 shrink-0 items-center border-b px-5 [border-color:var(--layout-separator)]">
          <h2 className="text-base font-semibold">Publish changes</h2>
          <button
            type="button"
            aria-label="Close publish changes"
            onClick={onClose}
            className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-3 [border-color:var(--layout-separator)]">
          <span className="text-sm text-muted-foreground">Publishing to</span>
          <span className="text-sm font-medium text-foreground">{publication?.name}</span>
          <span className="text-xs text-muted-foreground">
            · {rendererName(publication?.renderer?.id)} ·{" "}
            {providerName(publication?.deployment?.provider)}
          </span>
          <label className="relative ml-auto min-w-52 flex-1 sm:max-w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(event) => onFilter(event.target.value)}
              placeholder="Filter notes"
              aria-label="Filter notes"
              className={`${fieldClass} pl-8`}
            />
          </label>
        </div>

        <div className="flux-editor-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <FileSection
            title="Selected"
            files={included}
            selected={selected}
            empty="No notes selected."
            onToggle={toggle}
            onAll={() => onSelected(new Set([...selected, ...visible.map((file) => file.path)]))}
            onNone={() => {
              const next = new Set(selected);
              visible.forEach((file) => next.delete(file.path));
              onSelected(next);
            }}
          />
          <FileSection
            title="Not selected"
            hint="select to publish"
            files={excluded}
            selected={selected}
            empty="All visible notes selected."
            onToggle={toggle}
            onAll={() => onSelected(new Set([...selected, ...visible.map((file) => file.path)]))}
            onNone={() => undefined}
          />
        </div>

        <footer className="flex min-h-16 shrink-0 items-center gap-3 border-t px-5 py-3 [border-color:var(--layout-separator)]">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            {jobStatus ? (
              <span role="status">{jobStatus}</span>
            ) : result ? (
              <span className="inline-flex items-center gap-1.5">
                {result.warnings.length ? (
                  <AlertTriangle className="size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {result.pageCount} notes · {result.assetCount} assets · {result.linkCount} links
              </span>
            ) : (
              `${selected.size} of ${files.length} notes selected`
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={busy === `preview:${publication?.id}`}
            disabled={selected.size === 0}
            onClick={onPreview}
          >
            Preview
          </Button>
          <Button
            size="sm"
            loading={busy === `publish:${publication?.id}`}
            disabled={selected.size === 0}
            onClick={onPublish}
          >
            Publish
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function FileSection({
  title,
  hint,
  files,
  selected,
  empty,
  onToggle,
  onAll,
  onNone,
}: {
  title: string;
  hint?: string;
  files: FileEntry[];
  selected: Set<string>;
  empty: string;
  onToggle: (path: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <section className="mb-4">
      <div className="flex h-9 items-center border-b [border-color:var(--layout-separator)]">
        <span className="text-sm font-semibold">{title}</span>
        {hint ? <span className="ml-1 text-xs text-muted-foreground">({hint})</span> : null}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {files.length} {files.length === 1 ? "note" : "notes"}
        </span>
        <button
          type="button"
          className="ml-3 text-xs text-muted-foreground hover:text-foreground"
          onClick={onAll}
        >
          Select all
        </button>
        {title === "Selected" ? (
          <button
            type="button"
            className="ml-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={onNone}
          >
            Deselect all
          </button>
        ) : null}
      </div>
      <div className="py-1">
        {files.map((file) => (
          <label
            key={file.path}
            className="group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-accent"
          >
            <input
              type="checkbox"
              checked={selected.has(file.path)}
              onChange={() => onToggle(file.path)}
              className="size-3.5 accent-foreground"
            />
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{file.path}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100">
              {formatBytes(file.sizeBytes)}
            </span>
          </label>
        ))}
        {files.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">{empty}</div>
        ) : null}
      </div>
    </section>
  );
}

function isSelected(path: string, publication: Publication): boolean {
  if (publication.selection.exclude.some((pattern) => globMatch(path, pattern))) return false;
  if (publication.explicitPaths?.includes(path)) return true;
  if (publication.selection.include.some((pattern) => globMatch(path, pattern))) return true;
  return publication.selection.defaultPublic;
}

function rendererName(renderer?: PublicationRenderer["id"]): string {
  return renderer === "quartz"
    ? "Quartz"
    : renderer === "fumadocs"
      ? "Fumadocs"
      : renderer === "flowershow"
        ? "Flowershow"
        : "Flux";
}

function providerName(provider?: PublicationDeployment["provider"]): string {
  return (
    {
      bundle: "Export only",
      "github-pages": "GitHub Pages",
      vercel: "Vercel",
      "cloudflare-pages": "Cloudflare Pages",
      netlify: "Netlify",
      flowershow: "Flowershow Cloud",
    } as const
  )[provider ?? "bundle"];
}

function connectorAvailable(
  connectors: PublicationConnector[],
  provider: PublicationDeployment["provider"]
): boolean {
  return connectors.find((connector) => connector.provider === provider)?.available ?? false;
}

function connectorReady(
  connectors: PublicationConnector[],
  provider: PublicationDeployment["provider"]
): boolean {
  const connector = connectors.find((item) => item.provider === provider);
  return connector?.available === true && connector.authenticated;
}

function connectorStatus(
  connectors: PublicationConnector[],
  provider: PublicationDeployment["provider"]
): string {
  const connector = connectors.find((item) => item.provider === provider);
  if (!connector?.available) return `${providerName(provider)} needs a one-time setup.`;
  return connector.message || `Sign in to ${providerName(provider)}.`;
}

async function waitForPublicationJob(
  client: FluxClient,
  vaultId: string,
  publicationId: string,
  started: PublicationJob,
  onStatus: (status: PublicationJob["status"]) => void
): Promise<PublicationJob> {
  let job = started;
  for (let attempt = 0; attempt < 480; attempt += 1) {
    onStatus(job.status);
    if (["ready", "succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    job = await client.getPublicationJob(vaultId, publicationId, job.id);
  }
  throw new Error("Publication build timed out");
}

function publicationStatus(status: PublicationJob["status"]): string {
  return (
    {
      queued: "Queued",
      snapshotting: "Preparing snapshot",
      rendering: "Rendering public site",
      deploying: "Deploying",
      ready: "Preview ready",
      succeeded: "Publish complete",
      failed: "Publish failed",
      cancelled: "Publish cancelled",
    } as const
  )[status];
}

function globMatch(path: string, pattern: string): boolean {
  const values = path.split("/");
  const patterns = pattern.split("/");
  const match = (valueIndex: number, patternIndex: number): boolean => {
    if (patternIndex === patterns.length) return valueIndex === values.length;
    if (patterns[patternIndex] === "**") {
      return (
        match(valueIndex, patternIndex + 1) ||
        (valueIndex < values.length && match(valueIndex + 1, patternIndex))
      );
    }
    if (valueIndex >= values.length || !segmentMatch(values[valueIndex], patterns[patternIndex]))
      return false;
    return match(valueIndex + 1, patternIndex + 1);
  };
  return match(0, 0);
}

function segmentMatch(value: string, pattern: string): boolean {
  let source = "";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`^${source}$`).test(value);
}

function isInternal(path: string): boolean {
  return (
    path === ".flux" || path.startsWith(".flux/") || path === ".git" || path.startsWith(".git/")
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function openHTMLPreview(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
