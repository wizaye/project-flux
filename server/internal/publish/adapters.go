package publish

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	quartzVersion              = "v4.5.2"
	fumadocsVersion            = "16.1.14"
	fumadocsKnowledgeComponent = `'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PointerEvent as ReactPointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from 'react';

type Page = { id: string; slug: string; title: string };
type Graph = { nodes: { pageId: string; label: string }[]; edges: { source: string; target: string }[] };
type Point = { x: number; y: number };

export default function FluxKnowledge() {
  const pathname = usePathname();
  const router = useRouter();
  const [pages, setPages] = useState<Page[]>([]);
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [backlinks, setBacklinks] = useState<Record<string, string[]>>({});
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [view, setView] = useState({ x: 0, y: 0, width: 240, height: 160 });
  const [expanded, setExpanded] = useState(false);
  const gesture = useRef<{ id?: string; x: number; y: number; moved: boolean } | undefined>(undefined);
  const lastMoved = useRef(false);

  useEffect(() => {
    Promise.all([
      fetch('/flux/manifest.json').then((response) => response.json()),
      fetch('/flux/graph.json').then((response) => response.json()),
      fetch('/flux/backlinks.json').then((response) => response.json()),
    ]).then(([manifest, nextGraph, nextBacklinks]) => {
      setPages(manifest.pages);
      setGraph(nextGraph);
      setBacklinks(nextBacklinks);
    }).catch(() => {});
  }, []);

  const page = pages.find((item) => item.slug === pathname);
  const pageByID = useMemo(() => new Map(pages.map((item) => [item.id, item])), [pages]);
  const neighbors = useMemo(() => page ? [...new Set(graph.edges.flatMap((edge) => {
    if (edge.source === page.id) return [edge.target];
    if (edge.target === page.id) return [edge.source];
    return [];
  }))] : [], [graph, page]);
  const localIDs = page ? [page.id, ...neighbors] : [];
  const localEdges = graph.edges.filter((edge) => localIDs.includes(edge.source) && localIDs.includes(edge.target));
  const incoming = page ? (backlinks[page.id] ?? []).map((id) => pageByID.get(id)).filter(Boolean) as Page[] : [];

  useEffect(() => {
    if (!page) return;
    const next: Record<string, Point> = { [page.id]: { x: 120, y: 80 } };
    neighbors.forEach((id, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(neighbors.length, 1);
      next[id] = { x: 120 + Math.cos(angle) * 76, y: 80 + Math.sin(angle) * 50 };
    });
    setPositions(next);
    setView({ x: 0, y: 0, width: 240, height: 160 });
  }, [page?.id, neighbors.join(',')]);

  if (!page) return null;
  const point = (id: string) => positions[id] ?? { x: 120, y: 80 };
  const graphPointer = (event: ReactPointerEvent<Element>) => {
    const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : (event.currentTarget as SVGElement).ownerSVGElement!;
    const bounds = svg.getBoundingClientRect();
    return { x: view.x + (event.clientX - bounds.left) / bounds.width * view.width, y: view.y + (event.clientY - bounds.top) / bounds.height * view.height };
  };
  const begin = (event: ReactPointerEvent<Element>, id?: string) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    lastMoved.current = false;
    gesture.current = { id, ...graphPointer(event), moved: false };
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!gesture.current) return;
    const next = graphPointer(event), dx = next.x - gesture.current.x, dy = next.y - gesture.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) gesture.current.moved = lastMoved.current = true;
    if (gesture.current.id) setPositions((current) => ({ ...current, [gesture.current!.id!]: { x: (current[gesture.current!.id!] ?? { x: 120, y: 80 }).x + dx, y: (current[gesture.current!.id!] ?? { x: 120, y: 80 }).y + dy } }));
    else setView((current) => ({ ...current, x: current.x - dx, y: current.y - dy }));
    gesture.current.x = next.x;
    gesture.current.y = next.y;
  };
  const zoom = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const scale = event.deltaY > 0 ? 1.12 : 0.88;
    setView((current) => ({ x: current.x + current.width * (1 - scale) / 2, y: current.y + current.height * (1 - scale) / 2, width: current.width * scale, height: current.height * scale }));
  };

  const graphView = <svg viewBox={[view.x, view.y, view.width, view.height].join(' ')} className="h-full w-full touch-none select-none" role="img" aria-label={'Interactive local graph for ' + page.title} onPointerDown={(event) => begin(event)} onPointerMove={move} onPointerUp={() => { gesture.current = undefined; }} onWheel={zoom}>
    {localEdges.map((edge) => <line key={edge.source + edge.target} x1={point(edge.source).x} y1={point(edge.source).y} x2={point(edge.target).x} y2={point(edge.target).y} stroke="currentColor" opacity="0.2" vectorEffect="non-scaling-stroke" />)}
    {localIDs.map((id) => {
      const node = pageByID.get(id), current = point(id), active = id === page.id;
      return <a key={id} href={node?.slug} aria-label={node?.title} onPointerDown={(event) => { event.stopPropagation(); begin(event, id); }} onClick={(event) => { event.preventDefault(); if (!lastMoved.current && node) router.push(node.slug); }}>
        <circle cx={current.x} cy={current.y} r={active ? 7 : 5} className={active ? 'fill-fd-foreground' : 'fill-fd-muted-foreground hover:fill-fd-foreground'} />
        <text x={current.x} y={current.y + 15} textAnchor="middle" className="pointer-events-none fill-fd-foreground text-[8px]">{node?.title.slice(0, 20)}</text>
      </a>;
    })}
  </svg>;

  return <div className="mt-5 space-y-5" aria-label="Page knowledge">
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">Interactive graph</h2>
        <button type="button" className="rounded px-1.5 py-0.5 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground" onClick={() => setExpanded(true)} aria-label="Expand graph">Expand</button>
      </div>
      <div className="h-40 overflow-hidden rounded-lg border bg-fd-secondary/20">{graphView}</div>
    </section>
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">Backlinks</h2>
      {incoming.length ? <nav className="flex flex-col gap-1.5">{incoming.map((source) => <Link key={source.id} href={source.slug} className="text-sm text-fd-muted-foreground hover:text-fd-foreground">{source.title}</Link>)}</nav> : <p className="text-sm text-fd-muted-foreground">No public backlinks</p>}
    </section>
    {expanded && <div className="fixed inset-4 z-50 flex flex-col rounded-xl border bg-fd-background p-4 shadow-xl" role="dialog" aria-modal="true" aria-label="Expanded local graph">
      <div className="mb-3 flex items-center justify-between"><strong>Local graph</strong><button type="button" className="rounded px-2 py-1 text-sm hover:bg-fd-accent" onClick={() => setExpanded(false)}>Close</button></div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-fd-secondary/20">{graphView}</div>
    </div>}
  </div>;
}
`
)

var rendererInstallMu sync.Mutex

func ValidateRenderer(config RendererConfig) error {
	switch config.ID {
	case "", "flux", "flowershow", "quartz", "fumadocs":
		return nil
	default:
		return errors.New("unsupported publication renderer")
	}
}

func ValidateTarget(renderer RendererConfig, deployment DeploymentConfig) error {
	if err := ValidateRenderer(renderer); err != nil {
		return err
	}
	if err := ValidateDeployment(deployment); err != nil {
		return err
	}
	if renderer.ID == "flowershow" && deployment.Provider != "flowershow" {
		return errors.New("Flowershow renderer requires Flowershow hosting")
	}
	if renderer.ID != "flowershow" && deployment.Provider == "flowershow" {
		return errors.New("Flowershow hosting requires the Flowershow renderer")
	}
	return nil
}

func Render(ctx context.Context, snapshotPath string, config RendererConfig) (string, error) {
	switch config.ID {
	case "", "flux", "flowershow":
		return RenderStaticSite(snapshotPath)
	case "quartz":
		return renderQuartz(ctx, snapshotPath)
	case "fumadocs":
		return renderFumadocs(ctx, snapshotPath)
	default:
		return "", errors.New("unsupported publication renderer")
	}
}

func MaterializeMarkdown(snapshotPath string) (string, error) {
	content, err := os.ReadFile(filepath.Join(snapshotPath, "manifest.json"))
	if err != nil {
		return "", err
	}
	var manifest PublicationManifest
	if err := json.Unmarshal(content, &manifest); err != nil {
		return "", err
	}
	if err := validateManifest(manifest); err != nil {
		return "", err
	}
	output := filepath.Join(snapshotPath, "content")
	temporary, err := os.MkdirTemp(snapshotPath, ".content-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	for _, page := range manifest.Pages {
		source := filepath.Join(snapshotPath, filepath.FromSlash(page.ContentPath))
		destination := filepath.Join(temporary, filepath.FromSlash(strings.Trim(page.Slug, "/"))+".md")
		if page.Slug == "" || page.Slug == "index" {
			destination = filepath.Join(temporary, "index.md")
		}
		body, err := os.ReadFile(source)
		if err != nil {
			return "", err
		}
		frontmatter := "---\ntitle: " + strconv.Quote(page.Title) + "\n"
		if page.Description != "" {
			frontmatter += "description: " + strconv.Quote(page.Description) + "\n"
		}
		frontmatter += "---\n\n"
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return "", err
		}
		body = portableRendererMarkdown(body)
		if err := os.WriteFile(destination, append([]byte(frontmatter), body...), 0o600); err != nil {
			return "", err
		}
	}
	for _, asset := range manifest.Assets {
		if err := copyFile(filepath.Join(snapshotPath, filepath.FromSlash(asset.Path)), filepath.Join(temporary, filepath.FromSlash(asset.Path))); err != nil {
			return "", err
		}
	}
	if err := os.RemoveAll(output); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, output); err != nil {
		return "", err
	}
	return output, nil
}

func portableRendererMarkdown(content []byte) []byte {
	return bytes.ReplaceAll(content, []byte("](#/"), []byte("](./"))
}

func renderQuartz(ctx context.Context, snapshotPath string) (string, error) {
	projectPath, err := ensureQuartz(ctx)
	if err != nil {
		return "", err
	}
	contentPath, err := MaterializeMarkdown(snapshotPath)
	if err != nil {
		return "", err
	}
	output := filepath.Join(snapshotPath, "site")
	if err := os.RemoveAll(output); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "node", filepath.Join(projectPath, "quartz", "bootstrap-cli.mjs"), "build", "--directory", contentPath, "--output", output)
	command.Dir = projectPath
	command.Env = append(os.Environ(), "NO_COLOR=1")
	if result, err := command.CombinedOutput(); err != nil {
		return "", fmt.Errorf("Quartz build failed: %s", strings.TrimSpace(string(result)))
	}
	if _, err := os.Stat(filepath.Join(output, "index.html")); err != nil {
		return "", errors.New("Quartz build did not create index.html")
	}
	return output, nil
}

func renderFumadocs(ctx context.Context, snapshotPath string) (string, error) {
	projectPath, err := ensureFumadocs(ctx)
	if err != nil {
		return "", err
	}
	contentPath, err := MaterializeMarkdown(snapshotPath)
	if err != nil {
		return "", err
	}
	work := filepath.Join(snapshotPath, "fumadocs-work")
	if err := os.RemoveAll(work); err != nil {
		return "", err
	}
	if err := copyProject(projectPath, work); err != nil {
		return "", err
	}
	if err := os.RemoveAll(filepath.Join(work, "content", "docs")); err != nil {
		return "", err
	}
	if err := copyMarkdownAsMDX(contentPath, filepath.Join(work, "content", "docs")); err != nil {
		return "", err
	}
	if err := configureFumadocs(snapshotPath, work); err != nil {
		return "", err
	}
	if err := os.Symlink(filepath.Join(projectPath, "node_modules"), filepath.Join(work, "node_modules")); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, filepath.Join(projectPath, "node_modules", ".bin", "next"), "build", "--webpack")
	command.Dir = work
	command.Env = append(os.Environ(), "NODE_ENV=production", "NO_COLOR=1", "NEXT_TELEMETRY_DISABLED=1")
	if result, err := command.CombinedOutput(); err != nil {
		return "", fmt.Errorf("Fumadocs build failed: %s", strings.TrimSpace(string(result)))
	}
	built := filepath.Join(work, "out")
	if _, err := os.Stat(filepath.Join(built, "index.html")); err != nil {
		return "", errors.New("Fumadocs project must enable Next.js static export")
	}
	output := filepath.Join(snapshotPath, "site")
	if err := os.RemoveAll(output); err != nil {
		return "", err
	}
	if err := os.Rename(built, output); err != nil {
		return "", err
	}
	return output, nil
}

func configureFumadocs(snapshotPath, work string) error {
	content, err := os.ReadFile(filepath.Join(snapshotPath, "manifest.json"))
	if err != nil {
		return err
	}
	var manifest PublicationManifest
	if err := json.Unmarshal(content, &manifest); err != nil {
		return err
	}
	destination := filepath.Join(work, "content", "docs", "index.mdx")
	if !fileExists(destination) {
		var body strings.Builder
		fmt.Fprintf(&body, "---\ntitle: %s\n---\n\n", strconv.Quote(manifest.Publication.Title))
		for _, page := range manifest.Pages {
			fmt.Fprintf(&body, "- [%s](./%s)\n", page.Title, strings.Trim(page.Slug, "/"))
		}
		if err := os.WriteFile(destination, []byte(body.String()), 0o600); err != nil {
			return err
		}
	}
	title := strconv.Quote(manifest.Publication.Title)
	sharedPath := filepath.Join(work, "lib", "shared.ts")
	shared, err := os.ReadFile(sharedPath)
	if err != nil {
		return err
	}
	sharedText := strings.Replace(string(shared), "export const appName = 'My App';", "export const appName = "+title+";", 1)
	sharedText = strings.Replace(sharedText, "export const docsRoute = '/docs';", "export const docsRoute = '/';", 1)
	shared = []byte(sharedText)
	if err := os.WriteFile(sharedPath, shared, 0o600); err != nil {
		return err
	}
	for _, name := range []string{"manifest.json", "graph.json", "backlinks.json"} {
		if err := copyFile(filepath.Join(snapshotPath, name), filepath.Join(work, "public", "flux", name)); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Join(work, "components"), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(work, "components", "flux-knowledge.tsx"), []byte(fumadocsKnowledgeComponent), 0o600); err != nil {
		return err
	}
	route := filepath.Join(work, "app", "[[...slug]]")
	if err := os.MkdirAll(route, 0o700); err != nil {
		return err
	}
	page, err := os.ReadFile(filepath.Join(work, "app", "docs", "[[...slug]]", "page.tsx"))
	if err != nil {
		return err
	}
	pageText := strings.ReplaceAll(string(page), "'/docs/[[...slug]]'", "'/[[...slug]]'")
	pageText = strings.Replace(pageText, "import { notFound } from 'next/navigation';", "import { notFound } from 'next/navigation';\nimport FluxKnowledge from '@/components/flux-knowledge';", 1)
	pageText = strings.Replace(pageText, "<DocsPage toc={page.data.toc} full={page.data.full}>", "<DocsPage toc={page.data.toc} full={page.data.full} tableOfContent={{ footer: <FluxKnowledge /> }}>", 1)
	pageText = strings.Replace(pageText, "      </DocsBody>", "      </DocsBody>\n      <div className=\"mt-10 xl:hidden\"><FluxKnowledge /></div>", 1)
	if err := os.WriteFile(filepath.Join(route, "page.tsx"), []byte(pageText), 0o600); err != nil {
		return err
	}
	layout, err := os.ReadFile(filepath.Join(work, "app", "docs", "layout.tsx"))
	if err != nil {
		return err
	}
	layout = []byte(strings.Replace(string(layout), "LayoutProps<'/docs'>", "LayoutProps<'/[[...slug]]'>", 1))
	if err := os.WriteFile(filepath.Join(route, "layout.tsx"), layout, 0o600); err != nil {
		return err
	}
	if err := os.RemoveAll(filepath.Join(work, "app", "docs")); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(work, "app", "(home)"))
}

func ensureQuartz(ctx context.Context) (string, error) {
	root := filepath.Join(toolchainRoot(), "renderers", "quartz-"+quartzVersion)
	if fileExists(filepath.Join(root, "quartz", "bootstrap-cli.mjs")) {
		return root, nil
	}
	rendererInstallMu.Lock()
	defer rendererInstallMu.Unlock()
	if fileExists(filepath.Join(root, "quartz", "bootstrap-cli.mjs")) {
		return root, nil
	}
	if _, err := exec.LookPath("git"); err != nil {
		return "", errors.New("Quartz setup requires Git")
	}
	if _, err := exec.LookPath("npm"); err != nil {
		return "", errors.New("Quartz setup requires Node.js 22 or newer")
	}
	temporary, err := os.MkdirTemp(filepath.Dir(root), ".quartz-*")
	if err != nil {
		if mkdirErr := os.MkdirAll(filepath.Dir(root), 0o700); mkdirErr != nil {
			return "", mkdirErr
		}
		temporary, err = os.MkdirTemp(filepath.Dir(root), ".quartz-*")
	}
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	if _, err := runExternal(ctx, "git", "clone", "--depth", "1", "--branch", quartzVersion, "https://github.com/jackyzha0/quartz.git", temporary); err != nil {
		return "", fmt.Errorf("install Quartz: %w", err)
	}
	if _, err := runExternalIn(ctx, temporary, "npm", "install", "--no-audit", "--no-fund"); err != nil {
		return "", fmt.Errorf("install Quartz dependencies: %w", err)
	}
	if err := os.RemoveAll(filepath.Join(temporary, ".git")); err != nil {
		return "", err
	}
	if err := os.RemoveAll(root); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, root); err != nil {
		return "", err
	}
	return root, nil
}

func ensureFumadocs(ctx context.Context) (string, error) {
	root := filepath.Join(toolchainRoot(), "renderers", "fumadocs-"+fumadocsVersion)
	if fileExists(filepath.Join(root, "node_modules", ".bin", "next")) {
		return root, nil
	}
	rendererInstallMu.Lock()
	defer rendererInstallMu.Unlock()
	if fileExists(filepath.Join(root, "node_modules", ".bin", "next")) {
		return root, nil
	}
	if _, err := exec.LookPath("npm"); err != nil {
		return "", errors.New("Fumadocs setup requires Node.js 22 or newer")
	}
	parent := filepath.Dir(root)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return "", err
	}
	temporary, err := os.MkdirTemp(parent, ".fumadocs-*")
	if err != nil {
		return "", err
	}
	os.Remove(temporary)
	defer os.RemoveAll(temporary)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "npm", "exec", "--yes", "create-fumadocs-app@"+fumadocsVersion, "--", filepath.Base(temporary), "--template", "+next+fuma-docs-mdx+static", "--pm", "npm", "--install", "--no-git")
	command.Dir = parent
	command.Env = append(os.Environ(), "CI=1", "NO_COLOR=1", "NEXT_TELEMETRY_DISABLED=1")
	if output, err := command.CombinedOutput(); err != nil {
		return "", fmt.Errorf("install Fumadocs: %s", strings.TrimSpace(string(output)))
	}
	if !fileExists(filepath.Join(temporary, "node_modules", ".bin", "next")) {
		return "", errors.New("Fumadocs dependency installation did not complete")
	}
	if err := os.RemoveAll(root); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, root); err != nil {
		return "", err
	}
	return root, nil
}

func toolchainRoot() string {
	if root := os.Getenv("FLUX_PUBLISH_TOOLCHAIN_DIR"); root != "" {
		return root
	}
	if root := os.Getenv("FLUX_APP_DATA_DIR"); root != "" {
		return filepath.Join(root, "publish")
	}
	if root, err := os.UserConfigDir(); err == nil {
		return filepath.Join(root, "Flux", "publish")
	}
	return filepath.Join(os.TempDir(), "flux-publish")
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func runExternal(ctx context.Context, executable string, args ...string) ([]byte, error) {
	return runExternalIn(ctx, "", executable, args...)
}

func runExternalIn(ctx context.Context, directory, executable string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = directory
	command.Env = append(os.Environ(), "NO_COLOR=1")
	output, err := command.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("%s: %s", executable, strings.TrimSpace(string(output)))
	}
	return output, nil
}

func copyMarkdownAsMDX(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil || relative == "." {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(filepath.Join(destination, relative), 0o700)
		}
		if strings.HasSuffix(relative, ".md") {
			relative = strings.TrimSuffix(relative, ".md") + ".mdx"
		}
		return copyFile(path, filepath.Join(destination, relative))
	})
}

func copyProject(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil || relative == "." {
			return err
		}
		if entry.IsDir() && (entry.Name() == ".git" || entry.Name() == ".next" || entry.Name() == "node_modules" || entry.Name() == "out") {
			return filepath.SkipDir
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		return copyFile(path, target)
	})
}

func copyFile(source, destination string) error {
	content, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	return os.WriteFile(destination, content, 0o600)
}
