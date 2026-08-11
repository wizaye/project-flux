package publish

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/flux-pkm/server/internal/domain"
)

func TestValidatePublicationTargets(t *testing.T) {
	tests := []struct {
		name       string
		renderer   RendererConfig
		deployment DeploymentConfig
		valid      bool
	}{
		{"flux export", RendererConfig{ID: "flux"}, DeploymentConfig{Provider: "bundle"}, true},
		{"managed fumadocs", RendererConfig{ID: "fumadocs"}, DeploymentConfig{Provider: "bundle"}, true},
		{"managed quartz", RendererConfig{ID: "quartz"}, DeploymentConfig{Provider: "bundle"}, true},
		{"flux vercel", RendererConfig{ID: "flux"}, DeploymentConfig{Provider: "vercel", Project: "garden"}, true},
		{"flowershow", RendererConfig{ID: "flowershow"}, DeploymentConfig{Provider: "flowershow", Project: "garden"}, true},
		{"flowershow wrong host", RendererConfig{ID: "flowershow"}, DeploymentConfig{Provider: "bundle"}, false},
		{"flowershow wrong renderer", RendererConfig{ID: "flux"}, DeploymentConfig{Provider: "flowershow", Project: "garden"}, false},
		{"missing connector project", RendererConfig{ID: "flux"}, DeploymentConfig{Provider: "netlify"}, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateTarget(test.renderer, test.deployment); (err == nil) != test.valid {
				t.Fatalf("ValidateTarget() error = %v, valid = %v", err, test.valid)
			}
		})
	}
}

func TestManagedRenderersIntegration(t *testing.T) {
	if os.Getenv("FLUX_PUBLISH_INTEGRATION") != "1" {
		t.Skip("set FLUX_PUBLISH_INTEGRATION=1 to download and build managed renderers")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello-world.md"), []byte("---\npublish: true\ntitle: Hello World\n---\n\n# Hello World\n\n## Details\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := BuildSnapshot(root, Publication{ID: "integration", Name: "Garden", Title: "Garden", Selection: SelectionConfig{Include: []string{"**/*.md"}}}, []domain.FileEntry{{Path: "hello-world.md", Kind: domain.FileKindMarkdown, ModifiedAt: time.Now()}}, domain.VaultGraph{}, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, renderer := range []string{"quartz", "fumadocs"} {
		t.Run(renderer, func(t *testing.T) {
			if renderer == "fumadocs" {
				t.Setenv("NODE_ENV", "development")
			}
			site, err := Render(context.Background(), result.OutputPath, RendererConfig{ID: renderer})
			if err != nil {
				t.Fatal(err)
			}
			if !fileExists(filepath.Join(site, "index.html")) {
				t.Fatal("renderer did not create index.html")
			}
			rootNote := fileExists(filepath.Join(site, "hello-world.html")) || fileExists(filepath.Join(site, "hello-world", "index.html"))
			if renderer == "fumadocs" && (!rootNote || !fileExists(filepath.Join(site, "flux", "graph.json"))) {
				t.Fatal("Fumadocs did not create root note routes and knowledge artifacts")
			}
		})
	}
	flowershow, err := installFlowershow(context.Background())
	if err != nil || !fileExists(flowershow) {
		t.Fatalf("Flowershow setup = %q, %v", flowershow, err)
	}
}

func TestCopyMarkdownAsMDX(t *testing.T) {
	source, destination := t.TempDir(), t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "guide"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "guide", "start.md"), []byte("# Start"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := copyMarkdownAsMDX(source, destination); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(destination, "guide", "start.mdx"))
	if err != nil || string(content) != "# Start" {
		t.Fatalf("MDX copy = %q, %v", content, err)
	}
}

func TestPortableRendererLinks(t *testing.T) {
	if got := string(portableRendererMarkdown([]byte("[Next](#/guide/next)"))); got != "[Next](./guide/next)" {
		t.Fatal(got)
	}
}

func TestEnsureFumadocsIndex(t *testing.T) {
	root := t.TempDir()
	manifest := `{"publication":{"title":"Garden"},"pages":[{"title":"Start","slug":"start"}]}`
	for name, content := range map[string]string{"manifest.json": manifest, "graph.json": `{"nodes":[],"edges":[]}`, "backlinks.json": `{}`} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	work := filepath.Join(root, "work")
	destination := filepath.Join(work, "content", "docs", "index.mdx")
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(work, "lib"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(work, "app", "docs", "[[...slug]]"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(work, "app", "(home)"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work, "lib", "shared.ts"), []byte("export const appName = 'My App';\nexport const docsRoute = '/docs';"), 0o600); err != nil {
		t.Fatal(err)
	}
	page := "import { notFound } from 'next/navigation';\nexport default function Page(props: PageProps<'/docs/[[...slug]]'>) { return <DocsPage toc={page.data.toc} full={page.data.full}><DocsBody>body\n      </DocsBody></DocsPage> }"
	if err := os.WriteFile(filepath.Join(work, "app", "docs", "[[...slug]]", "page.tsx"), []byte(page), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work, "app", "docs", "layout.tsx"), []byte("export default function Layout(props: LayoutProps<'/docs'>) {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := configureFumadocs(root, work); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(destination)
	if err != nil || string(content) != "---\ntitle: \"Garden\"\n---\n\n- [Start](./start)\n" {
		t.Fatalf("index = %q, %v", content, err)
	}
	page, err = stringFile(filepath.Join(work, "app", "[[...slug]]", "page.tsx"))
	if err != nil || !strings.Contains(page, "tableOfContent={{ footer: <FluxKnowledge /> }}") || !strings.Contains(page, "mt-10 xl:hidden") || !strings.Contains(page, "'/[[...slug]]'") {
		t.Fatalf("root page = %q, %v", page, err)
	}
	shared, err := stringFile(filepath.Join(work, "lib", "shared.ts"))
	if err != nil || !strings.Contains(shared, "docsRoute = '/'") {
		t.Fatalf("shared = %q, %v", shared, err)
	}
	if fileExists(filepath.Join(work, "app", "docs")) || fileExists(filepath.Join(work, "app", "(home)")) {
		t.Fatal("old Fumadocs routes remain")
	}
}

func stringFile(path string) (string, error) {
	content, err := os.ReadFile(path)
	return string(content), err
}
