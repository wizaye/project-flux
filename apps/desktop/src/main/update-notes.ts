export function formatReleaseNotes(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const notes = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const note = item as { version?: unknown; note?: unknown };
    if (typeof note.note !== "string") return [];
    const heading = typeof note.version === "string" ? `## ${note.version}\n\n` : "";
    return [`${heading}${note.note}`];
  });
  return notes.length ? notes.join("\n\n") : undefined;
}
