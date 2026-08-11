package publish

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveSourcePathRejectsInternalAndSymlinkPaths(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	for _, relativePath := range []string{".flux/index.db", "notes/.git/config.md", "escape/secret.md", "../secret.md"} {
		if _, err := ResolveSourcePath(root, relativePath); !errors.Is(err, ErrUnsafeSource) {
			t.Errorf("ResolveSourcePath(%q) error = %v, want ErrUnsafeSource", relativePath, err)
		}
	}
}
