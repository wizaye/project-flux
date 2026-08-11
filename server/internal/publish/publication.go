package publish

import "time"

type Publication struct {
	ID            string           `json:"id"`
	VaultID       string           `json:"vaultId"`
	Name          string           `json:"name"`
	Title         string           `json:"title"`
	Renderer      RendererConfig   `json:"renderer"`
	Selection     SelectionConfig  `json:"selection"`
	ExplicitPaths []string         `json:"explicitPaths,omitempty"`
	Deployment    DeploymentConfig `json:"deployment"`
	CreatedAt     time.Time        `json:"createdAt"`
	UpdatedAt     time.Time        `json:"updatedAt"`
	LastSnapshot  string           `json:"lastSnapshot,omitempty"`
	PublishedURL  string           `json:"publishedUrl,omitempty"`
	PublishedAt   *time.Time       `json:"publishedAt,omitempty"`
	State         string           `json:"state"`
}

type DeploymentConfig struct {
	Provider      string `json:"provider"`
	RepositoryURL string `json:"repositoryUrl,omitempty"`
	Branch        string `json:"branch,omitempty"`
	Project       string `json:"project,omitempty"`
}

type RendererConfig struct {
	ID string `json:"id"`
}

type Connector struct {
	Provider      string `json:"provider"`
	Command       string `json:"command"`
	Available     bool   `json:"available"`
	Authenticated bool   `json:"authenticated"`
	Managed       bool   `json:"managed"`
	Message       string `json:"message,omitempty"`
}

type CreatePublicationRequest struct {
	Name          string           `json:"name"`
	Title         string           `json:"title"`
	Include       []string         `json:"include"`
	Exclude       []string         `json:"exclude"`
	ExplicitPaths []string         `json:"explicitPaths"`
	Renderer      RendererConfig   `json:"renderer"`
	Deployment    DeploymentConfig `json:"deployment"`
}

type UpdatePublicationRequest struct {
	Name          *string           `json:"name,omitempty"`
	Title         *string           `json:"title,omitempty"`
	Include       []string          `json:"include"`
	Exclude       []string          `json:"exclude"`
	ExplicitPaths []string          `json:"explicitPaths"`
	Renderer      *RendererConfig   `json:"renderer,omitempty"`
	Deployment    *DeploymentConfig `json:"deployment,omitempty"`
}

type SnapshotResult struct {
	SnapshotID      string   `json:"snapshotId"`
	OutputPath      string   `json:"outputPath"`
	PageCount       int      `json:"pageCount"`
	AssetCount      int      `json:"assetCount"`
	LinkCount       int      `json:"linkCount"`
	Warnings        []string `json:"warnings"`
	AlreadyUpToDate bool     `json:"alreadyUpToDate"`
	SitePath        string   `json:"sitePath"`
	PublishedURL    string   `json:"publishedUrl,omitempty"`
	State           string   `json:"state"`
}

type Job struct {
	ID            string          `json:"id"`
	VaultID       string          `json:"-"`
	PublicationID string          `json:"publicationId"`
	Kind          string          `json:"kind"`
	Status        string          `json:"status"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
	Result        *SnapshotResult `json:"result,omitempty"`
	Error         string          `json:"error,omitempty"`
}

type PublicationManifest struct {
	SchemaVersion int `json:"schemaVersion"`
	Publication   struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Title string `json:"title"`
	} `json:"publication"`
	Snapshot struct {
		ID          string `json:"id"`
		ContentHash string `json:"contentHash"`
	} `json:"snapshot"`
	Pages      []PublicationPage  `json:"pages"`
	Assets     []PublicationAsset `json:"assets"`
	Navigation []NavigationNode   `json:"navigation"`
	Graph      ArtifactReference  `json:"graph"`
	Backlinks  ArtifactReference  `json:"backlinks"`
}

type PublicationPage struct {
	ID              string               `json:"id"`
	ContentPath     string               `json:"contentPath"`
	OutputPath      string               `json:"outputPath"`
	Slug            string               `json:"slug"`
	Title           string               `json:"title"`
	Description     string               `json:"description,omitempty"`
	Tags            []string             `json:"tags"`
	Aliases         []string             `json:"aliases"`
	ContentHash     string               `json:"contentHash"`
	CreatedAt       string               `json:"createdAt,omitempty"`
	ModifiedAt      string               `json:"modifiedAt,omitempty"`
	Outgoing        []PublicationLink    `json:"outgoing"`
	TableOfContents []PublicationHeading `json:"toc"`
	Draft           bool                 `json:"draft"`
}

type PublicationLink struct {
	Text           string `json:"text"`
	RawTarget      string `json:"rawTarget"`
	Type           string `json:"type"`
	ResolvedPageID string `json:"resolvedPageId,omitempty"`
	ResolvedSlug   string `json:"resolvedSlug,omitempty"`
	Status         string `json:"status"`
}

type PublicationHeading struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Depth int    `json:"depth"`
}

type PublicationAsset struct {
	ID          string `json:"id"`
	Path        string `json:"path"`
	ContentHash string `json:"contentHash"`
	MediaType   string `json:"mediaType,omitempty"`
	SizeBytes   int64  `json:"sizeBytes,omitempty"`
}

type NavigationNode struct {
	Title    string           `json:"title"`
	PageID   string           `json:"pageId,omitempty"`
	Slug     string           `json:"slug,omitempty"`
	Children []NavigationNode `json:"children,omitempty"`
}

type ArtifactReference struct {
	Path string `json:"path"`
}
