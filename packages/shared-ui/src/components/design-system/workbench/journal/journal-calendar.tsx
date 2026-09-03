import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  NotebookPen,
  Plus,
} from "lucide-react";

import { Button } from "../../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../ui/dropdown-menu";
import { Input } from "../../../ui/input";
import { Label } from "../../../ui/label";
import type { WorkbenchJournal } from "../types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function JournalCalendar({
  selectedDate,
  monthLabel,
  days,
  entries,
  onSelectDate,
  onChangeMonth,
  onOpenEntry,
  onCreateEntry,
  onOpenWeekly,
}: WorkbenchJournal) {
  const [kind, setKind] = useState<"all" | "journal" | "file">("all");
  const [tag, setTag] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const allTags = useMemo(
    () => [...new Set(entries.flatMap((entry) => entry.tags))].sort(),
    [entries]
  );
  const visibleEntries = entries.filter(
    (entry) => (kind === "all" || entry.kind === kind) && (!tag || entry.tags.includes(tag))
  );

  const create = async () => {
    const opened = await onCreateEntry(selectedDate, title, tags.split(","));
    if (!opened) return;
    setCreating(false);
    setTitle("");
    setTags("");
  };

  return (
    <section className="flex h-full w-full min-h-0 min-w-0 flex-col bg-background" aria-label="Journal calendar">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="min-w-28 flex-1 truncate text-sm font-medium">{monthLabel}</h1>
        <EntryFilter
          kind={kind}
          tag={tag}
          tags={allTags}
          onKindChange={setKind}
          onTagChange={setTag}
        />
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => onSelectDate(dateKey(new Date()))}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label="Previous month"
          onClick={() => onChangeMonth(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label="Next month"
          onClick={() => onChangeMonth(1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </header>

      <div className="grid shrink-0 grid-cols-7 border-b bg-muted/25 text-[11px] font-medium text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-1.5">
            {day}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const key = dateKey(day);
          const active = key === selectedDate;
          const currentMonth = key.startsWith(selectedDate.slice(0, 7));
          const dayEntries = visibleEntries.filter((entry) => entry.date === key);
          return (
            <div
              key={key}
              className="group min-h-0 overflow-hidden border-b border-r p-1.5 hover:bg-accent/20"
            >
              <button
                type="button"
                aria-label={key}
                aria-pressed={active}
                onClick={() => onSelectDate(key)}
                className={`grid size-6 place-items-center rounded-full text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground" : currentMonth ? "text-foreground" : "text-muted-foreground/45"}`}
              >
                {day.getDate()}
              </button>
              <div className="mt-1 grid gap-1">
                {dayEntries.slice(0, 3).map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    title={`${entry.title}${entry.tags.length ? ` · ${entry.tags.join(", ")}` : ""}`}
                    onClick={() => void onOpenEntry(entry.path)}
                    className="flex min-w-0 items-center gap-1 rounded-sm border bg-card px-1.5 py-1 text-left text-[11px] shadow-xs hover:bg-accent"
                  >
                    {entry.kind === "journal" ? (
                      <NotebookPen className="size-3 shrink-0" aria-hidden="true" />
                    ) : (
                      <FileText className="size-3 shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate">{entry.title}</span>
                  </button>
                ))}
                {dayEntries.length > 3 ? (
                  <span className="px-1 text-[10px] text-muted-foreground">
                    +{dayEntries.length - 3} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="flex min-h-11 shrink-0 items-center gap-2 border-t px-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {selectedDate} · {visibleEntries.filter((entry) => entry.date === selectedDate).length}{" "}
          entries
        </span>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => void onOpenWeekly(selectedDate)}
        >
          Open week
        </Button>
        <Button size="sm" type="button" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          New entry
        </Button>
      </footer>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New journal entry</DialogTitle>
            <DialogDescription>Create another entry for {selectedDate}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="journal-title">Title</Label>
              <Input
                id="journal-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Morning reflection"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="journal-tags">Tags</Label>
              <Input
                id="journal-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="personal, reflection"
              />
              <p className="text-xs text-muted-foreground">Separate tags with commas.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!title.trim()} onClick={() => void create()}>
              Create entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function EntryFilter({
  kind,
  tag,
  tags,
  onKindChange,
  onTagChange,
}: {
  kind: "all" | "journal" | "file";
  tag?: string;
  tags: string[];
  onKindChange: (kind: "all" | "journal" | "file") => void;
  onTagChange: (tag?: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" type="button" />}>
        {kind === "all" ? "All entries" : kind === "journal" ? "Journals" : "Other files"}
        {tag ? ` · #${tag}` : ""}
        <ChevronDown aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Entry type</DropdownMenuLabel>
          {(["all", "journal", "file"] as const).map((value) => (
            <DropdownMenuCheckboxItem
              key={value}
              checked={kind === value}
              onCheckedChange={() => onKindChange(value)}
            >
              {value === "all" ? "All entries" : value === "journal" ? "Journals" : "Other files"}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Tag</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={!tag} onCheckedChange={() => onTagChange(undefined)}>
            All tags
          </DropdownMenuCheckboxItem>
          {tags.map((value) => (
            <DropdownMenuCheckboxItem
              key={value}
              checked={tag === value}
              onCheckedChange={() => onTagChange(value)}
            >
              #{value}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
