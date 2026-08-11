package publish

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"

	"github.com/flux-pkm/server/internal/files"
)

type ContentDigest struct {
	Path string `json:"path"`
	Hash string `json:"hash"`
}

type SnapshotHashInput struct {
	SchemaVersion     int             `json:"schemaVersion"`
	PublicationName   string          `json:"publicationName"`
	PublicationTitle  string          `json:"publicationTitle"`
	Selection         SelectionConfig `json:"selection"`
	Pages             []ContentDigest `json:"pages"`
	Assets            []ContentDigest `json:"assets"`
	SemanticGraphHash string          `json:"semanticGraphHash"`
}

func SnapshotHash(input SnapshotHashInput) (string, error) {
	if input.SchemaVersion != 1 || !validHash(input.SemanticGraphHash) ||
		!validPatterns(input.Selection.Include) || !validPatterns(input.Selection.Exclude) {
		return "", errors.New("invalid snapshot hash input")
	}
	input.Selection.Include = sorted(input.Selection.Include)
	input.Selection.Exclude = sorted(input.Selection.Exclude)
	input.Pages = sortedDigests(input.Pages)
	input.Assets = sortedDigests(input.Assets)
	for _, item := range append(append([]ContentDigest{}, input.Pages...), input.Assets...) {
		if !isSafePublicPath(item.Path) || !validHash(item.Hash) {
			return "", errors.New("invalid snapshot content digest")
		}
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:]), nil
}

func sorted(values []string) []string {
	result := append([]string(nil), values...)
	sort.Strings(result)
	return result
}

func sortedDigests(values []ContentDigest) []ContentDigest {
	result := append([]ContentDigest(nil), values...)
	sort.Slice(result, func(i, j int) bool { return result[i].Path < result[j].Path })
	return result
}

func validHash(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func isSafePublicPath(value string) bool {
	normalized, err := files.NormalizePath(value)
	return err == nil && normalized == value && !hardExcluded(normalized)
}
