package publish

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestGitHubPagesDeployAndUnpublish(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	root := t.TempDir()
	remote := filepath.Join(root, "remote.git")
	if output, err := exec.Command("git", "init", "--bare", remote).CombinedOutput(); err != nil {
		t.Fatalf("init bare repo: %v: %s", err, output)
	}
	configPath := filepath.Join(root, "gitconfig")
	config := "[url \"file://" + remote + "\"]\n\tinsteadOf = https://github.com/acme/garden.git\n"
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", configPath)
	site := filepath.Join(root, "site")
	if err := os.Mkdir(site, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(site, "index.html"), []byte("public site"), 0o600); err != nil {
		t.Fatal(err)
	}
	deployment := DeploymentConfig{Provider: "github-pages", RepositoryURL: "https://github.com/acme/garden.git", Branch: "gh-pages"}
	url, err := DeployGitHubPages(context.Background(), site, filepath.Join(root, "checkout"), deployment)
	if err != nil || url != "https://acme.github.io/garden/" {
		t.Fatalf("deploy = %q, %v", url, err)
	}
	if output, err := exec.Command("git", "--git-dir", remote, "rev-parse", "refs/heads/gh-pages").CombinedOutput(); err != nil {
		t.Fatalf("published branch missing: %v: %s", err, output)
	}
	if err := UnpublishGitHubPages(context.Background(), filepath.Join(root, "checkout"), deployment); err != nil {
		t.Fatal(err)
	}
	if err := exec.Command("git", "--git-dir", remote, "show-ref", "--verify", "refs/heads/gh-pages").Run(); err == nil {
		t.Fatal("publish branch still exists after unpublish")
	}
}
