import { useEffect, useMemo, useState } from "react";
import type { FluxClient, VaultInfo } from "@flux/bridge-contract";
import {
  calendarGrid,
  dateFromKey,
  dateKeyInTimeZone,
  defaultDailyNoteConfig,
  isoWeekKey,
  loadDailyNoteConfig,
  localDateKey,
  noteFileName,
  noteTemplate,
} from "./config";
import { errorMessage } from "../app/helpers";

export function useDailyNotes({
  client,
  vault,
  refreshFiles,
  openDocument,
  onStatus,
}: {
  client: FluxClient | null;
  vault: VaultInfo | null;
  refreshFiles: () => Promise<unknown>;
  openDocument: (path: string) => Promise<unknown>;
  onStatus: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(localDateKey);
  const [config, setConfig] = useState(defaultDailyNoteConfig);
  const days = useMemo(() => calendarGrid(date), [date]);
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
        dateFromKey(date)
      ),
    [date]
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => {
    let active = true;
    if (!vault || !client) return;
    void loadDailyNoteConfig(client, vault.id)
      .then((next) => {
        if (!active) return;
        setConfig(next);
        setDate(dateKeyInTimeZone(new Date(), next.timeZone));
      })
      .catch((error) => {
        if (active) onStatus(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [client, onStatus, vault]);

  const openDaily = async (selected: string) => {
    if (!vault || !client) return;
    const path = `${config.dailyFolder}/${noteFileName(selected, config.dailyFormat)}`;
    try {
      await client.createDirectory(vault.id, config.dailyFolder);
      if (!(await client.getFileMetadata(vault.id, path))) {
        try {
          const content = await noteTemplate(
            client,
            vault.id,
            config.dailyTemplate,
            `# ${selected}\n\n`,
            { date: selected }
          );
          await client.createFile({ vaultId: vault.id, path, content });
          await refreshFiles();
        } catch {
          // A simultaneous capture may have created today's note.
        }
      }
      setOpen(false);
      await openDocument(path);
    } catch (error) {
      onStatus(errorMessage(error));
    }
  };

  const openWeekly = async (selected: string) => {
    if (!vault || !client) return;
    const week = isoWeekKey(dateFromKey(selected));
    const path = `${config.weeklyFolder}/${noteFileName(selected, config.weeklyFormat, true)}`;
    try {
      await client.createDirectory(vault.id, config.weeklyFolder);
      if (!(await client.getFileMetadata(vault.id, path))) {
        try {
          const content = await noteTemplate(
            client,
            vault.id,
            config.weeklyTemplate,
            `# ${week}\n\n`,
            { date: selected, week }
          );
          await client.createFile({ vaultId: vault.id, path, content });
          await refreshFiles();
        } catch {
          // Another window won create race.
        }
      }
      setOpen(false);
      await openDocument(path);
    } catch (error) {
      onStatus(errorMessage(error));
    }
  };

  return {
    open,
    setOpen,
    date,
    setDate,
    config,
    setConfig,
    days,
    monthLabel,
    openDaily,
    openWeekly,
  };
}
