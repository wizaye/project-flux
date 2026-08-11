package publish

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/flux-pkm/server/internal/domain"
)

func TestBuildSnapshotDoesNotLeakPrivateContent(t *testing.T) {
	root := t.TempDir()
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("draft.md", "---\npublish: true\ndraft: true\n---\nDraft text\n")
	write("image.png", "PUBLIC-IMAGE")
	write("secret.png", "PRIVATE-IMAGE")
	write("public.md", "---\npublish: true\ntitle: Public Note\n---\nSee [[private]].\n![diagram](image.png)\n")
	write("private.md", "---\npublish: false\ntitle: Private Passwords\n---\nTOP-SECRET-CONTENT\n![](secret.png)\n")
	now := time.Now()
	entries := []domain.FileEntry{
		{Path: "public.md", Kind: domain.FileKindMarkdown, ModifiedAt: now},
		{Path: "private.md", Kind: domain.FileKindMarkdown, ModifiedAt: now},
		{Path: "draft.md", Kind: domain.FileKindMarkdown, ModifiedAt: now},
		{Path: "image.png", Kind: domain.FileKindBinary, ModifiedAt: now},
		{Path: "secret.png", Kind: domain.FileKindBinary, ModifiedAt: now},
	}
	graph := domain.VaultGraph{
		Nodes: []domain.GraphNode{{ID: "public.md", Path: "public.md"}, {ID: "private.md", Path: "private.md"}},
		Edges: []domain.GraphEdge{{Source: "public.md", Target: "private.md"}, {Source: "private.md", Target: "public.md"}, {Source: "public.md", Target: "public.md"}},
	}
	publication := Publication{ID: "publication", Name: "Garden", Title: "Garden", Selection: SelectionConfig{Include: []string{"**/*.md"}}}
	result, err := BuildSnapshot(root, publication, entries, graph, false)
	if err != nil {
		t.Fatal(err)
	}
	if result.PageCount != 2 || result.AssetCount != 1 || len(result.Warnings) != 1 {
		t.Fatalf("BuildSnapshot() = %#v, want 2 preview pages, public image, and private-link warning", result)
	}
	var output strings.Builder
	if err := filepath.WalkDir(result.OutputPath, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return walkErr
		}
		content, err := os.ReadFile(path)
		if err == nil {
			output.Write(content)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private.md", "[[private]]", "Private Passwords", "TOP-SECRET-CONTENT", "PRIVATE-IMAGE"} {
		if strings.Contains(output.String(), private) {
			t.Fatalf("snapshot leaked %q", private)
		}
	}
	repeated, err := BuildSnapshot(root, publication, entries, graph, false)
	if err != nil || !repeated.AlreadyUpToDate || repeated.SnapshotID != result.SnapshotID {
		t.Fatalf("idempotent build = %#v, %v", repeated, err)
	}
	write("public.md", "---\npublish: true\ntitle: Renamed Public Note\n---\nSee [[private]].\n![diagram](image.png)\n\n> [!NOTE] Public callout\n")
	renamed, err := BuildSnapshot(root, publication, entries, graph, false)
	if err != nil || renamed.SnapshotID == result.SnapshotID {
		t.Fatalf("public metadata change did not change snapshot: %#v, %v", renamed, err)
	}
	production, err := BuildSnapshot(root, publication, entries, graph, true)
	if err != nil || production.PageCount != 1 || production.SnapshotID == result.SnapshotID {
		t.Fatalf("production build = %#v, %v", production, err)
	}
	site, err := RenderStaticSite(production.OutputPath)
	if err != nil {
		t.Fatal(err)
	}
	html, err := os.ReadFile(filepath.Join(site, "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(html), "Renamed Public Note") || !strings.Contains(string(html), "data:image/png;base64,") || !strings.Contains(string(html), "On this page") || !strings.Contains(string(html), `"Backlinks":[{"Slug":"/public"`) || !strings.Contains(string(html), `id="theme"`) || !strings.Contains(string(html), "function buildNav") || !strings.Contains(string(html), "Public callout") || strings.Contains(string(html), "TOP-SECRET-CONTENT") || strings.Contains(string(html), "private.md") || strings.Contains(string(html), "image.png") {
		t.Fatal("rendered site is incomplete or leaked private content")
	}
	manifestPath := filepath.Join(production.OutputPath, "manifest.json")
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest PublicationManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Pages[0].Outgoing) != 2 || manifest.Pages[0].Outgoing[0].Status != "published" || manifest.Pages[0].Outgoing[1].Status != "unpublished" || manifest.Pages[0].Outgoing[1].RawTarget != "" {
		t.Fatalf("unsafe or incomplete outgoing links: %#v", manifest.Pages[0].Outgoing)
	}
	manifest.Pages[0].ContentPath = "../private.md"
	manifestBytes, _ = json.Marshal(manifest)
	if err := os.WriteFile(manifestPath, manifestBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := RenderStaticSite(production.OutputPath); err == nil {
		t.Fatal("renderer accepted unsafe publication path")
	}
}

func TestMarkdownTableOfContents(t *testing.T) {
	got := markdownTableOfContents([]byte("# Title\n\n## First section\n\n### Details\n"))
	if len(got) != 2 || got[0] != (PublicationHeading{ID: "first-section", Text: "First section", Depth: 2}) || got[1].ID != "details" {
		t.Fatalf("table of contents = %#v", got)
	}
}

func TestValidateDeploymentRejectsDangerousBranch(t *testing.T) {
	for _, branch := range []string{"main", "master", "../main", "-force"} {
		if ValidateDeployment(DeploymentConfig{Provider: "github-pages", RepositoryURL: "https://github.com/acme/garden.git", Branch: branch}) == nil {
			t.Fatalf("accepted dangerous branch %q", branch)
		}
	}
}
