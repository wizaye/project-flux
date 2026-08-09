package domain

type GitChange struct {
	Path           string `json:"path"`
	OriginalPath   string `json:"originalPath,omitempty"`
	IndexStatus    string `json:"indexStatus"`
	WorktreeStatus string `json:"worktreeStatus"`
}

type GitStatus struct {
	Available   bool        `json:"available"`
	Initialized bool        `json:"initialized"`
	Branch      string      `json:"branch,omitempty"`
	Upstream    string      `json:"upstream,omitempty"`
	Origin      string      `json:"origin,omitempty"`
	Remotes     []GitRemote `json:"remotes"`
	Ahead       int         `json:"ahead"`
	Behind      int         `json:"behind"`
	Changes     []GitChange `json:"changes"`
}

type GitRemote struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type GitDiff struct {
	Path    string `json:"path"`
	Staged  bool   `json:"staged"`
	Content string `json:"content"`
}

type GitBranch struct {
	Name    string `json:"name"`
	Current bool   `json:"current"`
}

type GitCommit struct {
	Hash      string `json:"hash"`
	ShortHash string `json:"shortHash"`
	Author    string `json:"author"`
	Date      string `json:"date"`
	Subject   string `json:"subject"`
}
