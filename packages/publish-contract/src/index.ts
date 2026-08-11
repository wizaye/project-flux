export const PUBLICATION_SCHEMA_VERSION = 1 as const;

export interface PublicationManifest {
  schemaVersion: typeof PUBLICATION_SCHEMA_VERSION;
  publication: { id: string; name: string; title: string };
  snapshot: { id: string; contentHash: string };
  pages: PublicationPage[];
  assets: PublicationAsset[];
  navigation: NavigationNode[];
  graph: { path: string };
  backlinks: { path: string };
}

export interface PublicationPage {
  id: string;
  contentPath: string;
  outputPath: string;
  slug: string;
  title: string;
  description?: string;
  tags: string[];
  aliases: string[];
  contentHash: string;
  createdAt?: string;
  modifiedAt?: string;
  outgoing: PublicationLink[];
  toc: PublicationHeading[];
  draft: boolean;
}

export interface PublicationLink {
  text: string;
  rawTarget: string;
  type: "wiki" | "markdown" | "embed" | "attachment";
  resolvedPageId?: string;
  resolvedSlug?: string;
  status: "published" | "unpublished" | "missing" | "ambiguous";
}

export interface PublicationHeading {
  id: string;
  text: string;
  depth: number;
}

export interface PublicationAsset {
  id: string;
  path: string;
  contentHash: string;
  mediaType?: string;
  sizeBytes?: number;
}

export interface NavigationNode {
  title: string;
  pageId?: string;
  slug?: string;
  children?: NavigationNode[];
}

const SHA256 = /^[a-f0-9]{64}$/;

export function isSafeBundlePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\")) return false;
  const parts = value.split("/");
  return !parts.some(
    (part) =>
      !part || part === "." || part === ".." || [".flux", ".git", ".obsidian"].includes(part)
  );
}

export function manifestErrors(value: unknown): string[] {
  const errors: string[] = [];
  if (!record(value)) return ["manifest must be an object"];
  if (!record(value.publication)) errors.push("invalid publication metadata");
  if (!record(value.snapshot)) errors.push("invalid snapshot metadata");
  if (!Array.isArray(value.pages)) errors.push("pages must be an array");
  if (!Array.isArray(value.assets)) errors.push("assets must be an array");
  if (!Array.isArray(value.navigation)) errors.push("navigation must be an array");
  if (!record(value.graph)) errors.push("invalid graph reference");
  if (!record(value.backlinks)) errors.push("invalid backlinks reference");
  if (errors.length > 0) return errors;

  const manifest = value as unknown as PublicationManifest;
  if (manifest.schemaVersion !== PUBLICATION_SCHEMA_VERSION)
    errors.push("unsupported schema version");
  if (!strings(manifest.publication, "id", "name", "title"))
    errors.push("invalid publication metadata");
  if (!strings(manifest.snapshot, "id", "contentHash")) errors.push("invalid snapshot metadata");
  if (!strings(manifest.graph, "path")) errors.push("invalid graph reference");
  if (!strings(manifest.backlinks, "path")) errors.push("invalid backlinks reference");
  if (errors.length > 0) return errors;
  if (!SHA256.test(manifest.snapshot.contentHash)) errors.push("invalid snapshot hash");
  if (!isSafeBundlePath(manifest.graph.path)) errors.push("unsafe graph path");
  if (!isSafeBundlePath(manifest.backlinks.path)) errors.push("unsafe backlinks path");

  const pageIDs = new Set<string>();
  const slugs = new Set<string>();
  for (const page of manifest.pages) {
    if (
      !record(page) ||
      !strings(page, "id", "contentPath", "outputPath", "slug", "title", "contentHash")
    ) {
      errors.push("invalid page metadata");
      continue;
    }
    if (pageIDs.has(page.id)) errors.push(`duplicate page id: ${page.id}`);
    if (slugs.has(page.slug)) errors.push(`duplicate page slug: ${page.slug}`);
    pageIDs.add(page.id);
    slugs.add(page.slug);
    if (!isSafeBundlePath(page.contentPath) || !isSafeBundlePath(page.outputPath)) {
      errors.push(`unsafe page path: ${page.id}`);
    }
    if (!SHA256.test(page.contentHash)) errors.push(`invalid page hash: ${page.id}`);
  }
  for (const asset of manifest.assets) {
    if (!record(asset) || !strings(asset, "id", "path", "contentHash")) {
      errors.push("invalid asset metadata");
      continue;
    }
    if (!isSafeBundlePath(asset.path)) errors.push(`unsafe asset path: ${asset.id}`);
    if (!SHA256.test(asset.contentHash)) errors.push(`invalid asset hash: ${asset.id}`);
  }
  return errors;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: object, ...keys: string[]): boolean {
  const item = value as Record<string, unknown>;
  return keys.every((key) => typeof item[key] === "string" && item[key] !== "");
}
