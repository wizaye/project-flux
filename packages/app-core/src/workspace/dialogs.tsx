import type { RecentVault, TrashEntry } from "@flux/bridge-contract";
import type { DailyNoteConfig } from "../daily-notes/config";
import { dateFromKey, isoWeekKey, localDateKey, noteFileName } from "../daily-notes/config";

export interface SelectableVault {
  key: string;
  name: string;
  path: string;
}

export function VaultManager({
  open,
  canClose,
  activeVaultId,
  vaults,
  recentVaults,
  query,
  vaultAccess,
  canSelectDirectory,
  onClose,
  onQueryChange,
  onOpenVault,
  onForgetVault,
  onChooseVault,
}: {
  open: boolean;
  canClose: boolean;
  activeVaultId: string;
  vaults: SelectableVault[];
  recentVaults: RecentVault[];
  query: string;
  vaultAccess?: "filesystem" | "registry";
  canSelectDirectory: boolean;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onOpenVault: (vault: SelectableVault) => void;
  onForgetVault: (vaultId: string) => void;
  onChooseVault: (mode: "open" | "create") => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[180] grid place-items-center bg-black/50 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-manager-title"
        className="relative grid h-[min(38rem,calc(100vh-2rem))] w-full max-w-4xl overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl [border-color:var(--layout-separator)] md:grid-cols-[minmax(18rem,0.85fr)_minmax(24rem,1.15fr)]"
      >
        {canClose ? (
          <button
            type="button"
            aria-label="Close vault manager"
            onClick={onClose}
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
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Find a vault"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <span className="font-mono text-[9px] text-muted-foreground">{vaults.length}</span>
          </label>
          <div
            className="flux-editor-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto"
            role="list"
            aria-label="Recent vaults"
          >
            {vaults.map((registered) => {
              const selected = activeVaultId === registered.key;
              const recent = recentVaults.find((candidate) => candidate.path === registered.path);
              return (
                <div
                  key={registered.key}
                  role="listitem"
                  className={`group flex items-center rounded-md pr-1 transition-colors ${selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
                >
                  <button
                    type="button"
                    title={registered.path}
                    onClick={() => onOpenVault(registered)}
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
                      onClick={() => onForgetVault(recent.vaultId)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground opacity-0 hover:bg-background/70 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
            {!vaults.length ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-xs leading-5 text-muted-foreground [border-color:var(--layout-separator)]">
                {query
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
            <h2 id="vault-manager-title" className="mt-5 text-xl font-semibold tracking-tight">
              Choose where knowledge lives
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {vaultAccess === "registry"
                ? "Open a vault registered on this Flux server. Access remains limited to its configured storage root."
                : "Open any notes folder, Obsidian vault, Git repository, or empty directory. Derived data stays in its hidden .flux folder."}
            </p>
          </div>
          <div className="mt-8 grid gap-2">
            {vaultAccess !== "registry" ? (
              <button
                type="button"
                onClick={() => onChooseVault("open")}
                className="rounded-md bg-primary px-3 py-3 text-left text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open folder as vault…
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onChooseVault("create")}
              disabled={!canSelectDirectory}
              className="rounded-md border px-3 py-3 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [border-color:var(--layout-separator)]"
            >
              Create new vault…
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RenameDialog({
  request,
  onChange,
  onCancel,
  onRename,
}: {
  request?: { path: string; value: string };
  onChange: (value: string) => void;
  onCancel: () => void;
  onRename: (path: string, value: string) => void;
}) {
  if (!request) return null;
  return (
    <div className="fixed inset-0 z-[190] grid place-items-center bg-black/35 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onRename(request.path, request.value);
          onCancel();
        }}
        className="w-full max-w-sm rounded-xl border bg-popover p-5 shadow-2xl [border-color:var(--layout-separator)]"
      >
        <label htmlFor="document-rename" className="text-sm font-semibold">
          Rename file
        </label>
        <input
          id="document-rename"
          autoFocus
          value={request.value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-3 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50 [border-color:var(--layout-separator)]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
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
  );
}

export function TrashManager({
  open,
  vaultName,
  entries,
  query,
  onQueryChange,
  onClose,
  onEmpty,
  onRestore,
  onDelete,
}: {
  open: boolean;
  vaultName?: string;
  entries: TrashEntry[];
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onEmpty: () => void;
  onRestore: (entry: TrashEntry) => void;
  onDelete: (entry: TrashEntry) => void;
}) {
  if (!open) return null;
  return (
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
              {vaultName ?? "Vault"} · {entries.length} items
            </p>
            <h2 id="trash-title" className="mt-1 text-lg font-semibold">
              Vault trash
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Items remain recoverable until permanently deleted.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {entries.length ? (
              <button
                type="button"
                onClick={onEmpty}
                className="rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              >
                Empty trash
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
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
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Filter by original path"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <span className="font-mono text-[9px] text-muted-foreground">{entries.length}</span>
          </label>
        </div>
        <div className="flux-editor-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {entries.length ? (
            <div className="space-y-1">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-[var(--layout-separator)] hover:bg-accent/35"
                >
                  <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted font-mono text-[10px] text-muted-foreground">
                    {entry.originalPath.split(".").pop()?.slice(0, 3).toUpperCase() || "FILE"}
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
                    onClick={() => onRestore(entry)}
                    className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent [border-color:var(--layout-separator)]"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(entry)}
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
                  {query ? "No matching trash items" : "Trash is empty"}
                </p>
                <p className="mt-1 text-xs">
                  {query ? "Try another path." : "Deleted notes will appear here for recovery."}
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
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  action,
  onCancel,
  onConfirm,
  zIndex = 200,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
  zIndex?: number;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/55 p-4" style={{ zIndex }}>
      <div className="w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-3 text-sm leading-5 text-muted-foreground">{description}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CalendarDialog({
  open,
  selected,
  monthLabel,
  days,
  entries,
  config,
  onSelect,
  onClose,
  onOpenDaily,
  onOpenWeekly,
}: {
  open: boolean;
  selected: string;
  monthLabel: string;
  days: Date[];
  entries: Array<{ path: string }>;
  config: DailyNoteConfig;
  onSelect: (date: string) => void;
  onClose: () => void;
  onOpenDaily: (date: string) => void;
  onOpenWeekly: (date: string) => void;
}) {
  if (!open) return null;
  const hasNote = (date: string) =>
    entries.some(
      (entry) => entry.path === `${config.dailyFolder}/${noteFileName(date, config.dailyFormat)}`
    );
  const changeMonth = (offset: number) => {
    const date = dateFromKey(selected);
    date.setMonth(date.getMonth() + offset, 1);
    onSelect(localDateKey(date));
  };
  return (
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
            onClick={() => changeMonth(-1)}
            className="grid size-8 place-items-center rounded-md hover:bg-accent"
          >
            ‹
          </button>
          <div className="text-center">
            <h2 id="calendar-title" className="text-sm font-semibold">
              {monthLabel}
            </h2>
            <p className="text-[10px] text-muted-foreground">
              Week {isoWeekKey(dateFromKey(selected))}
            </p>
          </div>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => changeMonth(1)}
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
          {days.map((day) => {
            const key = localDateKey(day);
            const active = key === selected;
            const currentMonth = day.getMonth() === dateFromKey(selected).getMonth();
            return (
              <button
                key={key}
                type="button"
                aria-label={key}
                onClick={() => onSelect(key)}
                onDoubleClick={() => onOpenDaily(key)}
                className={`relative grid aspect-square place-items-center rounded-md text-xs ${active ? "bg-primary text-primary-foreground" : currentMonth ? "hover:bg-accent" : "text-muted-foreground/45 hover:bg-accent"}`}
              >
                {day.getDate()}
                {hasNote(key) ? (
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-1 size-1 rounded-full ${active ? "bg-primary-foreground" : "bg-primary"}`}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {hasNote(selected) ? "A note exists for this date." : "A new note will be created."}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onOpenWeekly(selected)}
            className="rounded-md border px-3 py-2 text-sm [border-color:var(--layout-separator)]"
          >
            Open week
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => onOpenDaily(selected)}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            Open daily note
          </button>
        </div>
      </div>
    </div>
  );
}
