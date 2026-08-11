package publish

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"github.com/flux-pkm/server/internal/domain"
	"github.com/goccy/go-yaml"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

type pageSource struct {
	path string
	body []byte
	page PublicationPage
}

type frontmatter struct {
	Title       string   `yaml:"title"`
	Description string   `yaml:"description"`
	Publish     *bool    `yaml:"publish"`
	Slug        string   `yaml:"slug"`
	Permalink   string   `yaml:"permalink"`
	Aliases     []string `yaml:"aliases"`
	Tags        []string `yaml:"tags"`
	Draft       bool     `yaml:"draft"`
}

type publicGraph struct {
	Nodes []publicGraphNode `json:"nodes"`
	Edges []publicGraphEdge `json:"edges"`
}

type publicGraphNode struct {
	PageID string `json:"pageId"`
	Label  string `json:"label"`
}

type publicGraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

var (
	markdownAssetPattern = regexp.MustCompile(`!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)`)
	wikiEmbedPattern     = regexp.MustCompile(`!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]`)
	markdownLinkPattern  = regexp.MustCompile(`(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)`)
	wikiLinkPattern      = regexp.MustCompile(`(!?)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]`)
)

func BuildSnapshot(vaultRoot string, publication Publication, entries []domain.FileEntry, graph domain.VaultGraph, production bool) (SnapshotResult, error) {
	if publication.ID == "" || publication.Name == "" || ValidateSelectionConfig(publication.Selection) != nil {
		return SnapshotResult{}, errors.New("invalid publication")
	}
	explicit := make(map[string]struct{}, len(publication.ExplicitPaths))
	for _, item := range publication.ExplicitPaths {
		explicit[path.Clean(strings.ReplaceAll(item, "\\", "/"))] = struct{}{}
	}

	pages := make([]pageSource, 0)
	assets := make([]PublicationAsset, 0)
	assetSources := make(map[string]string)
	assetPublicPaths := make(map[string]string)
	binaryEntries := make([]domain.FileEntry, 0)
	for _, entry := range entries {
		if entry.Kind == domain.FileKindDirectory {
			continue
		}
		resolved, err := ResolveSourcePath(vaultRoot, entry.Path)
		if err != nil {
			continue
		}
		_, selectedExplicitly := explicit[entry.Path]
		if entry.Kind != domain.FileKindMarkdown {
			binaryEntries = append(binaryEntries, entry)
			continue
		}

		content, err := os.ReadFile(resolved)
		if err != nil {
			return SnapshotResult{}, err
		}
		metadata, body, err := parseFrontmatter(content)
		if err != nil {
			return SnapshotResult{}, fmt.Errorf("parse frontmatter %s: %w", entry.Path, err)
		}
		decision := Select(entry.Path, selectedExplicitly, metadata.Publish, publication.Selection)
		if !decision.Published || production && metadata.Draft {
			continue
		}
		title := strings.TrimSpace(metadata.Title)
		if title == "" {
			title = strings.TrimSuffix(path.Base(entry.Path), path.Ext(entry.Path))
		}
		id := publicID(publication.ID, entry.Path)
		slug := publicSlug(entry.Path, metadata.Slug, metadata.Permalink, id)
		page := PublicationPage{
			ID: id, ContentPath: "pages/" + id + ".md", OutputPath: strings.TrimPrefix(slug, "/") + "/index.html",
			Slug: slug, Title: title, Description: metadata.Description, Tags: nonNil(metadata.Tags), Aliases: nonNil(metadata.Aliases),
			ModifiedAt: entry.ModifiedAt.UTC().Format("2006-01-02T15:04:05Z"), Outgoing: []PublicationLink{}, TableOfContents: []PublicationHeading{}, Draft: metadata.Draft,
		}
		page.ContentHash = publicPageHash(page, body)
		pages = append(pages, pageSource{
			path: entry.Path,
			body: body,
			page: page,
		})
	}
	referencedAssets := collectReferencedAssets(pages, binaryEntries)
	for _, entry := range binaryEntries {
		_, selectedExplicitly := explicit[entry.Path]
		_, referenced := referencedAssets[entry.Path]
		decision := Select(entry.Path, selectedExplicitly || referenced, nil, publication.Selection)
		if !decision.Published {
			continue
		}
		resolved, err := ResolveSourcePath(vaultRoot, entry.Path)
		if err != nil {
			continue
		}
		content, err := os.ReadFile(resolved)
		if err != nil {
			return SnapshotResult{}, err
		}
		id := publicID(publication.ID, entry.Path)
		output := "assets/" + id + strings.ToLower(filepath.Ext(entry.Path))
		assets = append(assets, PublicationAsset{ID: id, Path: output, ContentHash: contentHash(content), MediaType: mime.TypeByExtension(filepath.Ext(entry.Path)), SizeBytes: int64(len(content))})
		assetSources[output] = resolved
		assetPublicPaths[entry.Path] = output
	}

	sort.Slice(pages, func(i, j int) bool { return pages[i].page.Slug < pages[j].page.Slug })
	sort.Slice(assets, func(i, j int) bool { return assets[i].Path < assets[j].Path })
	pageByPath := make(map[string]PublicationPage, len(pages))
	for _, item := range pages {
		if existing, ok := pageByPath[item.path]; ok || hasSlug(pageByPath, item.page.Slug) {
			return SnapshotResult{}, fmt.Errorf("duplicate public page path or slug: %s", existing.Slug)
		}
		pageByPath[item.path] = item.page
	}
	for index := range pages {
		pages[index].body, pages[index].page.Outgoing = rewritePublicMarkdown(pages[index].path, pages[index].body, pageByPath, assetPublicPaths)
		pages[index].page.TableOfContents = markdownTableOfContents(pages[index].body)
		pages[index].page.ContentHash = publicPageHash(pages[index].page, pages[index].body)
		pageByPath[pages[index].path] = pages[index].page
	}

	publicKnowledge, backlinks, linkCount, unpublishedLinks := filterGraph(graph, pageByPath)
	graphBytes, err := json.Marshal(publicKnowledge)
	if err != nil {
		return SnapshotResult{}, err
	}
	backlinkBytes, err := json.Marshal(backlinks)
	if err != nil {
		return SnapshotResult{}, err
	}
	pageDigests := make([]ContentDigest, 0, len(pages))
	for _, item := range pages {
		pageDigests = append(pageDigests, ContentDigest{Path: item.page.ContentPath, Hash: item.page.ContentHash})
	}
	assetDigests := make([]ContentDigest, 0, len(assets))
	for _, item := range assets {
		assetDigests = append(assetDigests, ContentDigest{Path: item.Path, Hash: item.ContentHash})
	}
	snapshotID, err := SnapshotHash(SnapshotHashInput{SchemaVersion: 1, PublicationName: publication.Name, PublicationTitle: publication.Title, Selection: publication.Selection, Pages: pageDigests, Assets: assetDigests, SemanticGraphHash: contentHash(graphBytes)})
	if err != nil {
		return SnapshotResult{}, err
	}

	manifest := PublicationManifest{SchemaVersion: 1, Assets: assets, Graph: ArtifactReference{Path: "graph.json"}, Backlinks: ArtifactReference{Path: "backlinks.json"}}
	manifest.Publication.ID, manifest.Publication.Name, manifest.Publication.Title = publication.ID, publication.Name, publication.Title
	manifest.Snapshot.ID, manifest.Snapshot.ContentHash = snapshotID, snapshotID
	manifest.Pages = make([]PublicationPage, 0, len(pages))
	manifest.Navigation = make([]NavigationNode, 0, len(pages))
	for _, item := range pages {
		manifest.Pages = append(manifest.Pages, item.page)
		manifest.Navigation = append(manifest.Navigation, NavigationNode{Title: item.page.Title, PageID: item.page.ID, Slug: item.page.Slug})
	}

	output := filepath.Join(vaultRoot, ".flux", "cache", "publish", publication.ID, snapshotID)
	if _, err := os.Stat(filepath.Join(output, "manifest.json")); err == nil {
		return SnapshotResult{SnapshotID: snapshotID, OutputPath: output, PageCount: len(pages), AssetCount: len(assets), LinkCount: linkCount, Warnings: warnings(unpublishedLinks), AlreadyUpToDate: true}, nil
	}
	if err := writeSnapshot(output, manifest, pages, assetSources, graphBytes, backlinkBytes); err != nil {
		return SnapshotResult{}, err
	}
	return SnapshotResult{SnapshotID: snapshotID, OutputPath: output, PageCount: len(pages), AssetCount: len(assets), LinkCount: linkCount, Warnings: warnings(unpublishedLinks)}, nil
}

func markdownTableOfContents(source []byte) []PublicationHeading {
	document := goldmark.New(goldmark.WithParserOptions(parser.WithAutoHeadingID())).Parser().Parse(text.NewReader(source))
	result := make([]PublicationHeading, 0)
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		heading, ok := node.(*ast.Heading)
		if !entering || !ok || heading.Level < 2 || heading.Level > 3 {
			return ast.WalkContinue, nil
		}
		id, _ := heading.AttributeString("id")
		result = append(result, PublicationHeading{ID: string(id.([]byte)), Text: string(heading.Text(source)), Depth: heading.Level})
		return ast.WalkContinue, nil
	})
	return result
}

func parseFrontmatter(content []byte) (frontmatter, []byte, error) {
	metadata := frontmatter{}
	text := string(content)
	if !strings.HasPrefix(text, "---\n") && !strings.HasPrefix(text, "---\r\n") {
		return metadata, content, nil
	}
	lines := strings.SplitAfter(text, "\n")
	for index := 1; index < len(lines); index++ {
		if strings.TrimSpace(lines[index]) != "---" {
			continue
		}
		raw := strings.Join(lines[1:index], "")
		if err := yaml.Unmarshal([]byte(raw), &metadata); err != nil {
			return metadata, nil, err
		}
		return metadata, []byte(strings.Join(lines[index+1:], "")), nil
	}
	return metadata, nil, errors.New("unterminated frontmatter")
}

func filterGraph(graph domain.VaultGraph, pages map[string]PublicationPage) (publicGraph, map[string][]string, int, int) {
	result := publicGraph{Nodes: []publicGraphNode{}, Edges: []publicGraphEdge{}}
	backlinks := make(map[string][]string, len(pages))
	for sourcePath, page := range pages {
		result.Nodes = append(result.Nodes, publicGraphNode{PageID: page.ID, Label: page.Title})
		backlinks[page.ID] = []string{}
		_ = sourcePath
	}
	sort.Slice(result.Nodes, func(i, j int) bool { return result.Nodes[i].PageID < result.Nodes[j].PageID })
	unpublished := 0
	for _, edge := range graph.Edges {
		source, sourcePublic := pages[edge.Source]
		if !sourcePublic {
			continue
		}
		target, targetPublic := pages[edge.Target]
		if !targetPublic {
			unpublished++
			continue
		}
		result.Edges = append(result.Edges, publicGraphEdge{Source: source.ID, Target: target.ID})
		backlinks[target.ID] = append(backlinks[target.ID], source.ID)
	}
	sort.Slice(result.Edges, func(i, j int) bool {
		return result.Edges[i].Source < result.Edges[j].Source || result.Edges[i].Source == result.Edges[j].Source && result.Edges[i].Target < result.Edges[j].Target
	})
	for id := range backlinks {
		sort.Strings(backlinks[id])
	}
	return result, backlinks, len(result.Edges), unpublished
}

func writeSnapshot(output string, manifest PublicationManifest, pages []pageSource, assets map[string]string, graph, backlinks []byte) error {
	parent := filepath.Dir(output)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	temporary, err := os.MkdirTemp(parent, ".snapshot-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	writeJSON := func(name string, value any) error {
		content, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		return writeFile(temporary, name, append(content, '\n'))
	}
	if err := writeJSON("manifest.json", manifest); err != nil {
		return err
	}
	if err := writeFile(temporary, "graph.json", append(graph, '\n')); err != nil {
		return err
	}
	if err := writeFile(temporary, "backlinks.json", append(backlinks, '\n')); err != nil {
		return err
	}
	if err := writeJSON("navigation.json", manifest.Navigation); err != nil {
		return err
	}
	for _, item := range pages {
		if err := writeFile(temporary, item.page.ContentPath, item.body); err != nil {
			return err
		}
	}
	for destination, source := range assets {
		content, err := os.ReadFile(source)
		if err != nil {
			return err
		}
		if err := writeFile(temporary, destination, content); err != nil {
			return err
		}
	}
	if err := os.Rename(temporary, output); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	return nil
}

func collectReferencedAssets(pages []pageSource, entries []domain.FileEntry) map[string]struct{} {
	available := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		available[entry.Path] = struct{}{}
	}
	result := make(map[string]struct{})
	for _, page := range pages {
		matches := markdownAssetPattern.FindAllSubmatch(page.body, -1)
		matches = append(matches, wikiEmbedPattern.FindAllSubmatch(page.body, -1)...)
		for _, match := range matches {
			if len(match) < 2 {
				continue
			}
			target := strings.Trim(strings.TrimSpace(string(match[1])), "<>")
			if decoded, err := url.PathUnescape(target); err == nil {
				target = decoded
			}
			if cut := strings.IndexAny(target, "?#"); cut >= 0 {
				target = target[:cut]
			}
			if target == "" || strings.Contains(target, "://") || strings.HasPrefix(target, "data:") {
				continue
			}
			candidate := path.Clean(path.Join(path.Dir(page.path), strings.ReplaceAll(target, "\\", "/")))
			if _, exists := available[candidate]; exists {
				result[candidate] = struct{}{}
			}
		}
	}
	return result
}

func rewritePublicMarkdown(sourcePath string, body []byte, pages map[string]PublicationPage, assets map[string]string) ([]byte, []PublicationLink) {
	outgoing := make([]PublicationLink, 0)
	resolve := func(target string) (PublicationPage, bool) {
		target = strings.TrimSpace(strings.SplitN(target, "#", 2)[0])
		candidate := path.Clean(path.Join(path.Dir(sourcePath), strings.TrimPrefix(strings.ReplaceAll(target, "\\", "/"), "/")))
		for _, name := range []string{candidate, candidate + ".md", strings.TrimPrefix(target, "/"), strings.TrimPrefix(target, "/") + ".md"} {
			if page, ok := pages[name]; ok {
				return page, true
			}
		}
		return PublicationPage{}, false
	}
	resolveAsset := func(target string) (string, bool) {
		candidate := path.Clean(path.Join(path.Dir(sourcePath), strings.TrimPrefix(strings.ReplaceAll(target, "\\", "/"), "/")))
		value, ok := assets[candidate]
		return value, ok
	}
	text := markdownLinkPattern.ReplaceAllStringFunc(string(body), func(raw string) string {
		parts := markdownLinkPattern.FindStringSubmatch(raw)
		if len(parts) != 4 {
			return raw
		}
		if parts[1] == "!" {
			if target, ok := resolveAsset(parts[3]); ok {
				outgoing = append(outgoing, PublicationLink{Text: parts[2], RawTarget: target, Type: "attachment", Status: "published"})
				return "![" + parts[2] + "](" + target + ")"
			}
			outgoing = append(outgoing, PublicationLink{Text: parts[2], Type: "attachment", Status: "missing"})
			return parts[2]
		}
		if strings.Contains(parts[3], "://") || strings.HasPrefix(parts[3], "mailto:") || strings.HasPrefix(parts[3], "#") {
			return raw
		}
		if page, ok := resolve(parts[3]); ok {
			outgoing = append(outgoing, PublicationLink{Text: parts[2], RawTarget: page.Slug, Type: "markdown", ResolvedPageID: page.ID, ResolvedSlug: page.Slug, Status: "published"})
			return "[" + parts[2] + "](#" + page.Slug + ")"
		}
		outgoing = append(outgoing, PublicationLink{Text: parts[2], Type: "markdown", Status: "unpublished"})
		return parts[2]
	})
	text = wikiLinkPattern.ReplaceAllStringFunc(text, func(raw string) string {
		parts := wikiLinkPattern.FindStringSubmatch(raw)
		if len(parts) != 4 {
			return raw
		}
		explicitLabel := strings.TrimSpace(parts[3])
		label := explicitLabel
		if label == "" {
			label = path.Base(strings.TrimSpace(parts[2]))
		}
		if parts[1] == "!" {
			if target, ok := resolveAsset(parts[2]); ok {
				outgoing = append(outgoing, PublicationLink{Text: label, RawTarget: target, Type: "attachment", Status: "published"})
				return "![" + label + "](" + target + ")"
			}
			if page, ok := resolve(parts[2]); ok {
				outgoing = append(outgoing, PublicationLink{Text: label, RawTarget: page.Slug, Type: "embed", ResolvedPageID: page.ID, ResolvedSlug: page.Slug, Status: "published"})
				return "> Embedded note: [" + label + "](#" + page.Slug + ")"
			}
			outgoing = append(outgoing, PublicationLink{Text: "Unavailable embedded note", Type: "embed", Status: "unpublished"})
			return "> Unavailable embedded note"
		}
		if page, ok := resolve(parts[2]); ok {
			outgoing = append(outgoing, PublicationLink{Text: label, RawTarget: page.Slug, Type: "wiki", ResolvedPageID: page.ID, ResolvedSlug: page.Slug, Status: "published"})
			return "[" + label + "](#" + page.Slug + ")"
		}
		outgoing = append(outgoing, PublicationLink{Text: "Unpublished note", Type: "wiki", Status: "unpublished"})
		if explicitLabel != "" {
			return explicitLabel
		}
		return "Unpublished note"
	})
	return []byte(text), outgoing
}

func writeFile(root, relative string, content []byte) error {
	destination := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	return os.WriteFile(destination, content, 0o600)
}

func publicID(publicationID, sourcePath string) string {
	digest := sha256.Sum256([]byte(publicationID + "\x00" + sourcePath))
	return hex.EncodeToString(digest[:16])
}

func publicSlug(sourcePath, slug, permalink, fallback string) string {
	if permalink != "" {
		slug = permalink
	}
	if slug == "" {
		slug = strings.TrimSuffix(sourcePath, path.Ext(sourcePath))
	}
	segments := make([]string, 0)
	for _, segment := range strings.Split(strings.Trim(slug, "/"), "/") {
		if normalized := slugSegment(segment); normalized != "" {
			segments = append(segments, normalized)
		}
	}
	if len(segments) == 0 {
		segments = append(segments, fallback)
	}
	return "/" + strings.Join(segments, "/")
}

func slugSegment(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var result strings.Builder
	dash := false
	for _, character := range value {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			result.WriteRune(character)
			dash = false
		} else if result.Len() > 0 && !dash {
			result.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(result.String(), "-")
}

func contentHash(content []byte) string {
	digest := sha256.Sum256(content)
	return hex.EncodeToString(digest[:])
}

func publicPageHash(page PublicationPage, body []byte) string {
	metadata, _ := json.Marshal(struct {
		Slug        string            `json:"slug"`
		Title       string            `json:"title"`
		Description string            `json:"description"`
		Tags        []string          `json:"tags"`
		Aliases     []string          `json:"aliases"`
		Draft       bool              `json:"draft"`
		Outgoing    []PublicationLink `json:"outgoing"`
		BodyHash    string            `json:"bodyHash"`
	}{page.Slug, page.Title, page.Description, page.Tags, page.Aliases, page.Draft, page.Outgoing, contentHash(body)})
	return contentHash(metadata)
}

func hasSlug(pages map[string]PublicationPage, slug string) bool {
	for _, page := range pages {
		if page.Slug == slug {
			return true
		}
	}
	return false
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func warnings(unpublishedLinks int) []string {
	if unpublishedLinks == 0 {
		return []string{}
	}
	return []string{fmt.Sprintf("%d links point to unpublished or missing notes", unpublishedLinks)}
}
