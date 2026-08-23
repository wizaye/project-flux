import type { DemoDocument } from "./markdown-editor";

const WIKILINK = /!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_LINK = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

export interface DocumentLink {
  source: string;
  target: string;
}

export interface DocumentMention {
  source: string;
  target: string;
  line: number;
  excerpt: string;
}

function normalizeTarget(value: string) {
  let target = value.trim().replace(/^<|>$/g, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep malformed-but-readable links searchable.
  }
  return target
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.(md|markdown)$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

function aliasesFor(document: Pick<DemoDocument, "path" | "title">) {
  const path = normalizeTarget(document.path ?? "");
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return [document.title, normalizeTarget(document.title), path, basename]
    .filter(Boolean)
    .map((value) => value.toLocaleLowerCase());
}

const IGNORED_PATH_PATTERNS = [
  /(?:^|\/)\.git(?:\/|$)/i,
  /(?:^|\/)\.turbo(?:\/|$)/i,
  /(?:^|\/)\.next(?:\/|$)/i,
  /(?:^|\/)dist(?:\/|$)/i,
  /(?:^|\/)build(?:\/|$)/i,
  /(?:^|\/)out(?:\/|$)/i,
  /(?:^|\/)\.cache(?:\/|$)/i,
  /(?:^|\/)\.vscode(?:\/|$)/i,
  /(?:^|\/)\.gemini(?:\/|$)/i,
  /(?:^|\/)coverage(?:\/|$)/i,
];

export function isIgnoredPath(path?: string): boolean {
  if (!path) return false;
  return IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function documentId(document: Pick<DemoDocument, "path" | "title">) {
  return document.path ?? document.title;
}

export function resolverFor(documents: Pick<DemoDocument, "path" | "title">[]) {
  const candidates = new Map<string, Set<string>>();
  for (const document of documents) {
    for (const alias of aliasesFor(document)) {
      const ids = candidates.get(alias) ?? new Set<string>();
      ids.add(documentId(document));
      candidates.set(alias, ids);
    }
  }
  return (rawTarget: string, source?: DemoDocument) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(rawTarget)) return undefined;
    const isAbsolute = rawTarget.startsWith("/");
    const target = normalizeTarget(rawTarget).toLocaleLowerCase();

    // 1. Check relative path match from source directory (if not absolute)
    if (!isAbsolute && source?.path) {
      const directory = normalizeTarget(source.path).split("/").slice(0, -1).join("/");
      const relative = normalizeTarget(`${directory}/${target}`).toLocaleLowerCase();
      for (const document of documents) {
        const docPath = normalizeTarget(document.path ?? "").toLocaleLowerCase();
        if (docPath && docPath === relative) {
          return documentId(document);
        }
      }
    }

    // 2. Check exact document path match
    for (const document of documents) {
      const docPath = normalizeTarget(document.path ?? "").toLocaleLowerCase();
      if (docPath && docPath === target) {
        return documentId(document);
      }
    }

    // 3. Exact alias match if size is 1
    const exact = candidates.get(target);
    if (exact?.size === 1) return [...exact][0];

    // 4. Basename match if size is 1
    const targetBasename = target.slice(target.lastIndexOf("/") + 1);
    const basenameMatches = candidates.get(targetBasename);
    if (basenameMatches?.size === 1) return [...basenameMatches][0];

    // 5. Fallback for duplicates: prioritize root document or exact path match before returning undefined
    if (basenameMatches && basenameMatches.size > 1) {
      const rootMatch = [...basenameMatches].find((id) => {
        const doc = documents.find((d) => documentId(d) === id);
        return doc?.path && normalizeTarget(doc.path).toLocaleLowerCase() === targetBasename;
      });
      if (rootMatch) return rootMatch;
    }

    return undefined;
  };
}

function targetId(documents: DemoDocument[], identifier: string) {
  const exact = documents.find((document) => documentId(document) === identifier);
  if (exact) return documentId(exact);

  const targetNorm = normalizeTarget(identifier).toLocaleLowerCase();
  for (const document of documents) {
    const docPath = normalizeTarget(document.path ?? "").toLocaleLowerCase();
    if (docPath && docPath === targetNorm) {
      return documentId(document);
    }
  }

  const matches = documents.filter(
    (document) =>
      document.title.toLocaleLowerCase() === identifier.toLocaleLowerCase() ||
      normalizeTarget(document.path ?? "").toLocaleLowerCase() === targetNorm
  );
  if (matches.length > 0) return documentId(matches[0]);
  return identifier;
}

function rawLinks(content: string) {
  const links: Array<{ target: string; index: number; length: number }> = [];
  for (const match of content.matchAll(WIKILINK)) {
    links.push({ target: match[1].trim(), index: match.index, length: match[0].length });
  }
  for (const match of content.matchAll(MARKDOWN_LINK)) {
    links.push({ target: match[1].trim(), index: match.index, length: match[0].length });
  }
  return links.sort((left, right) => left.index - right.index);
}

function locationFor(content: string, index: number) {
  const line = content.slice(0, index).split("\n").length;
  const start = content.lastIndexOf("\n", index - 1) + 1;
  const end = content.indexOf("\n", index);
  const excerpt = content.slice(start, end < 0 ? content.length : end).trim();
  return { line, excerpt };
}

function maskMarkdown(content: string) {
  const preserveLines = (value: string) => value.replace(/[^\n]/g, " ");
  let masked = content
    .replace(/```[\s\S]*?```/g, preserveLines)
    .replace(/`[^`\n]*`/g, preserveLines)
    .replace(/%%[\s\S]*?%%/g, preserveLines);
  for (const link of rawLinks(masked)) {
    masked =
      masked.slice(0, link.index) +
      " ".repeat(link.length) +
      masked.slice(link.index + link.length);
  }
  return masked;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function linkedTitles(content: string) {
  return rawLinks(content).map((link) => normalizeTarget(link.target));
}

// Global cached index store for ultra-fast, zero-re-scan lookups across the entire vault
export class BacklinkIndexStore {
  private fileMap = new Map<string, DemoDocument>();
  private reverseLinked = new Map<string, Map<string, DocumentMention[]>>();
  private cacheVersion = 0;
  private listeners = new Set<() => void>();

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public getCacheVersion() {
    return this.cacheVersion;
  }

  private addMention(alias: string, sourceId: string, mention: DocumentMention) {
    if (!alias) return;
    let sourceGroup = this.reverseLinked.get(alias);
    if (!sourceGroup) {
      sourceGroup = new Map();
      this.reverseLinked.set(alias, sourceGroup);
    }
    let mentions = sourceGroup.get(sourceId);
    if (!mentions) {
      mentions = [];
      sourceGroup.set(sourceId, mentions);
    }
    mentions.push(mention);
  }

  private updateSingleDocumentInternal(doc: DemoDocument): boolean {
    const id = documentId(doc);
    const previous = this.fileMap.get(id);
    if (
      previous &&
      previous.contentHash &&
      doc.contentHash &&
      previous.contentHash === doc.contentHash
    ) {
      return false;
    }
    if (previous && previous.content === doc.content) {
      return false;
    }

    this.fileMap.set(id, doc);

    // Clean up old references originating from this source
    for (const sourceGroup of this.reverseLinked.values()) {
      sourceGroup.delete(id);
    }

    const directory = doc.path ? normalizeTarget(doc.path).split("/").slice(0, -1).join("/") : "";
    for (const link of rawLinks(doc.content)) {
      const target = normalizeTarget(link.target).toLocaleLowerCase();
      const relative = directory
        ? normalizeTarget(`${directory}/${target}`).toLocaleLowerCase()
        : target;

      const mention = {
        source: id,
        target: link.target,
        ...locationFor(doc.content, link.index),
      };

      this.addMention(target, id, mention);
      if (relative !== target) {
        this.addMention(relative, id, mention);
      }
    }

    return true;
  }

  public rebuild(documents: DemoDocument[]) {
    this.fileMap.clear();
    this.reverseLinked.clear();

    for (const doc of documents) {
      this.updateSingleDocumentInternal(doc);
    }
    this.cacheVersion += 1;
    this.notify();
  }

  public updateSingleDocument(doc: DemoDocument) {
    if (this.updateSingleDocumentInternal(doc)) {
      this.cacheVersion += 1;
      this.notify();
    }
  }

  public updateDocuments(documents: DemoDocument[]) {
    let updated = false;
    for (const doc of documents) {
      if (this.updateSingleDocumentInternal(doc)) {
        updated = true;
      }
    }
    if (updated) {
      this.cacheVersion += 1;
      this.notify();
    }
  }

  public getLinkedMentions(targetIdentifier: string): DocumentMention[] {
    const allDocs = [...this.fileMap.values()];
    const resolve = resolverFor(allDocs);

    const targetDoc = allDocs.find(
      (d) =>
        documentId(d) === targetIdentifier ||
        d.path === targetIdentifier ||
        d.title === targetIdentifier
    );
    const wantedId = targetDoc ? documentId(targetDoc) : targetIdentifier;

    const wantedSet = new Set<string>();
    wantedSet.add(normalizeTarget(targetIdentifier).toLocaleLowerCase());

    if (targetDoc) {
      for (const alias of aliasesFor(targetDoc)) {
        wantedSet.add(alias);
      }
    }

    const result: DocumentMention[] = [];
    const seen = new Set<string>();

    for (const alias of wantedSet) {
      const sourceGroup = this.reverseLinked.get(alias);
      if (sourceGroup) {
        for (const [sourceId, mentions] of sourceGroup.entries()) {
          // Exclude self-references
          if (wantedId === sourceId) continue;

          const sourceDoc = this.fileMap.get(sourceId);

          for (const m of mentions) {
            // Verify that this mention ACTUALLY resolves to our wanted target!
            const resolvedTarget = resolve(m.target, sourceDoc);
            if (resolvedTarget !== wantedId) continue;

            const key = `${m.source}:${m.line}:${m.excerpt}`;
            if (!seen.has(key)) {
              seen.add(key);
              result.push(m);
            }
          }
        }
      }
    }

    return result.sort((a, b) => {
      if (a.source === b.source) return a.line - b.line;
      return a.source.localeCompare(b.source);
    });
  }

  public getUnlinkedMentions(targetIdentifier: string): DocumentMention[] {
    const allDocs = [...this.fileMap.values()];
    return unlinkedMentionsFor(allDocs, targetIdentifier);
  }
}

export const globalBacklinkStore = new BacklinkIndexStore();

export function linkedMentionsFor(documents: DemoDocument[], targetIdentifier: string) {
  const resolve = resolverFor(documents);
  const wantedId = targetId(documents, targetIdentifier);
  const targetDoc = documents.find(
    (d) => documentId(d) === wantedId || d.path === targetIdentifier || d.title === targetIdentifier
  );

  const wantedSet = new Set<string>();
  if (wantedId) wantedSet.add(wantedId);
  if (targetDoc) {
    wantedSet.add(documentId(targetDoc));
    if (targetDoc.path) wantedSet.add(targetDoc.path);
    if (targetDoc.title) wantedSet.add(targetDoc.title);
  }
  wantedSet.add(targetIdentifier);

  const mentions: DocumentMention[] = [];
  for (const document of documents) {
    for (const link of rawLinks(document.content)) {
      const resolved = resolve(link.target, document);
      if (resolved && (wantedSet.has(resolved) || wantedSet.has(normalizeTarget(resolved)))) {
        mentions.push({
          source: documentId(document),
          target: resolved,
          ...locationFor(document.content, link.index),
        });
      }
    }
  }
  return mentions;
}

export function unlinkedMentionsFor(documents: DemoDocument[], targetIdentifier: string) {
  const targetDoc = documents.find(
    (d) =>
      documentId(d) === targetIdentifier ||
      d.path === targetIdentifier ||
      d.title === targetIdentifier
  );
  const targetTitle =
    targetDoc?.title ??
    targetIdentifier
      .split("/")
      .pop()
      ?.replace(/\.(md|markdown)$/i, "") ??
    targetIdentifier;

  const mentions: DocumentMention[] = [];
  if (!targetTitle.trim()) return mentions;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(${escapeRegExp(targetTitle)})(?=$|[^\\p{L}\\p{N}_])`,
    "giu"
  );
  const wantedId = targetDoc ? documentId(targetDoc) : targetIdentifier;

  for (const document of documents) {
    if (documentId(document) === wantedId) continue;
    const searchable = maskMarkdown(document.content);
    for (const match of searchable.matchAll(pattern)) {
      const index = match.index + match[1].length;
      mentions.push({
        source: documentId(document),
        target: wantedId,
        ...locationFor(document.content, index),
      });
    }
  }
  return mentions;
}

export function buildLinkIndex(documents: DemoDocument[]) {
  const resolve = resolverFor(documents);
  const edges: DocumentLink[] = [];
  const outgoing = new Map<string, Set<string>>();
  const backlinks = new Map<string, Set<string>>();

  for (const document of documents) {
    const targets = new Set(
      rawLinks(document.content)
        .map((link) => resolve(link.target, document))
        .filter((target): target is string => Boolean(target))
    );
    const source = documentId(document);
    for (const target of targets) {
      edges.push({ source, target });
      if (!outgoing.has(source)) outgoing.set(source, new Set());
      if (!backlinks.has(target)) backlinks.set(target, new Set());
      outgoing.get(source)?.add(target);
      backlinks.get(target)?.add(source);
    }
  }

  return { edges, outgoing, backlinks };
}
