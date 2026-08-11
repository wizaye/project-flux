package publish

import (
	"errors"
	"fmt"
	"path/filepath"

	"github.com/flux-pkm/server/internal/files"
)

var ErrUnsafeSource = errors.New("unsafe publication source path")

func ResolveSourcePath(vaultRoot, relativePath string) (string, error) {
	normalized, err := files.NormalizePath(relativePath)
	if err != nil || hardExcluded(normalized) {
		return "", ErrUnsafeSource
	}
	resolved := filepath.Join(vaultRoot, filepath.FromSlash(normalized))
	if err := files.RejectSymlinks(vaultRoot, resolved); err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnsafeSource, err)
	}
	return resolved, nil
}
