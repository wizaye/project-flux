const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface FrontmatterProperty {
  key: string;
  value: string;
}

export function splitFrontmatter(content: string) {
  const match = FRONTMATTER.exec(content);
  return match
    ? { frontmatter: match[0], body: content.slice(match[0].length) }
    : { frontmatter: "", body: content };
}

export function setFrontmatterProperty(content: string, name: string, value: string) {
  const key = name.replace(/[\r\n:]/g, " ").trim();
  if (!key) return content;

  const { frontmatter, body } = splitFrontmatter(content);
  const line = `${key}: ${formatYamlValue(value)}`;
  if (!frontmatter) return `---\n${line}\n---\n\n${body}`;

  const lines = frontmatter.trimEnd().split(/\r?\n/);
  const index = lines.findIndex((candidate) => candidate.startsWith(`${key}:`));
  if (index >= 0) lines[index] = line;
  else lines.splice(-1, 0, line);
  return `${lines.join("\n")}\n${body}`;
}

export function getFrontmatterProperties(content: string): FrontmatterProperty[] {
  const { frontmatter } = splitFrontmatter(content);
  if (!frontmatter) return [];

  return frontmatter
    .trim()
    .split(/\r?\n/)
    .slice(1, -1)
    .flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator < 1) return [];
      return [{ key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }];
    });
}

function formatYamlValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '""';
  if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(trimmed)) return trimmed;
  if (/^\[[\s\S]*\]$/.test(trimmed) || /^(?:\{|>\||\|)/.test(trimmed)) return trimmed;
  return JSON.stringify(trimmed);
}
