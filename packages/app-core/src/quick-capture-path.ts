export function quickCaptureInboxPath(inbox: string, fileName: string) {
  const name = fileName.trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) return null;
  const markdownName = name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
  const configured = inbox.replace(/\/+$/, "");
  const folder = configured.toLowerCase().endsWith(".md")
    ? configured.split("/").slice(0, -1).join("/")
    : configured;
  return folder ? `${folder}/${markdownName}` : markdownName;
}
