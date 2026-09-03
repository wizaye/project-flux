const listPrefix = /^(\s*)(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;

export function listIndentWidth(
  text: string,
  previousLines: Iterable<string>,
  fallback: number,
  outdent: boolean
) {
  const current = listPrefix.exec(text);
  if (!current) return 0;
  const currentIndent = current[1].length;

  for (const previousText of previousLines) {
    const previous = listPrefix.exec(previousText);
    if (!previous) continue;
    const previousIndent = previous[1].length;

    if (outdent && previousIndent < currentIndent) return currentIndent - previousIndent;
    if (!outdent && previousIndent <= currentIndent) {
      return Math.max(fallback, previous[0].length - currentIndent);
    }
  }

  return outdent ? currentIndent : fallback;
}

export function isMarkdownListLine(text: string) {
  return listPrefix.test(text);
}

export function nestedOrderedMarkerEdit(text: string) {
  const marker = /^(\s*)(\d+)([.)])\s+/.exec(text);
  if (!marker || marker[2] === "1") return null;
  return { from: marker[1].length, to: marker[1].length + marker[2].length, insert: "1" };
}
