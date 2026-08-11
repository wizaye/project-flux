package publish

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

var branchPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$`)
var githubRemotePattern = regexp.MustCompile(`^(https://github\.com/|git@github\.com:)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$`)

func ValidateDeployment(config DeploymentConfig) error {
	if config.Provider == "" || config.Provider == "bundle" {
		return nil
	}
	if config.Provider == "flowershow" {
		if !projectPattern.MatchString(config.Project) {
			return errors.New("Flowershow site name is required")
		}
		return nil
	}
	if config.Provider == "vercel" || config.Provider == "cloudflare-pages" || config.Provider == "netlify" {
		if !projectPattern.MatchString(config.Project) {
			return errors.New("deployment project name is required")
		}
		return nil
	}
	if config.Provider != "github-pages" {
		return errors.New("unsupported deployment provider")
	}
	if !githubRemotePattern.MatchString(config.RepositoryURL) {
		return errors.New("GitHub repository URL must use HTTPS or SSH")
	}
	branch := config.Branch
	if branch == "" {
		branch = "gh-pages"
	}
	if !branchPattern.MatchString(branch) || branch == "main" || branch == "master" || strings.Contains(branch, "..") || strings.Contains(branch, "//") || strings.HasSuffix(branch, "/") || strings.HasSuffix(branch, ".") || strings.HasSuffix(branch, ".lock") {
		return errors.New("publish branch must be a safe non-default branch")
	}
	return nil
}

var projectPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)

var connectorInstallMu sync.Mutex

var connectorPackages = map[string]struct {
	Command string
	Package string
	Version string
	Login   []string
	Whoami  []string
}{
	"vercel":           {"vercel", "vercel", "58.9.1", []string{"login"}, []string{"whoami"}},
	"cloudflare-pages": {"wrangler", "wrangler", "4.120.1", []string{"login"}, []string{"whoami"}},
	"netlify":          {"netlify", "netlify-cli", "27.1.1", []string{"login"}, []string{"status", "--json"}},
}

func Connectors() []Connector {
	items := []Connector{
		{Provider: "github-pages", Command: "git"},
		{Provider: "vercel", Command: "vercel"},
		{Provider: "cloudflare-pages", Command: "wrangler"},
		{Provider: "netlify", Command: "netlify"},
		{Provider: "flowershow", Command: "fl"},
	}
	for index := range items {
		path, managed, err := connectorPath(items[index].Provider, items[index].Command)
		items[index].Available, items[index].Managed = err == nil, managed
		if err != nil {
			items[index].Message = "Not set up"
			continue
		}
		if items[index].Provider == "github-pages" {
			items[index].Authenticated = true
			items[index].Message = "Ready"
			continue
		}
		items[index].Authenticated = connectorAuthenticated(path, items[index].Provider)
		if items[index].Authenticated {
			items[index].Message = "Connected"
		} else {
			items[index].Message = "Sign in required"
		}
	}
	return items
}

func SetupConnector(ctx context.Context, provider string) (Connector, error) {
	if provider == "github-pages" {
		if _, err := exec.LookPath("git"); err != nil {
			return Connector{}, errors.New("Git is required for GitHub Pages")
		}
		return connectorByProvider(provider), nil
	}
	command := "fl"
	if config, ok := connectorPackages[provider]; ok {
		command = config.Command
	} else if provider != "flowershow" {
		return Connector{}, errors.New("unsupported publishing connector")
	}
	path, _, err := connectorPath(provider, command)
	if err != nil {
		if provider == "flowershow" {
			path, err = installFlowershow(ctx)
		} else {
			path, err = installNPMConnector(ctx, provider)
		}
	}
	if err != nil {
		return Connector{}, err
	}
	if !connectorAuthenticated(path, provider) {
		args := []string{"login"}
		if config, ok := connectorPackages[provider]; ok {
			args = config.Login
		}
		command := exec.Command(path, args...)
		command.Env = append(os.Environ(), "NO_COLOR=1")
		if err := command.Start(); err != nil {
			return Connector{}, fmt.Errorf("start %s sign in: %w", provider, err)
		}
		go command.Wait()
	}
	result := connectorByProvider(provider)
	if !result.Authenticated {
		result.Message = "Finish signing in in your browser"
	}
	return result, nil
}

func connectorByProvider(provider string) Connector {
	for _, connector := range Connectors() {
		if connector.Provider == provider {
			return connector
		}
	}
	return Connector{Provider: provider}
}

func connectorAuthenticated(path, provider string) bool {
	args := []string{"whoami"}
	if config, ok := connectorPackages[provider]; ok {
		args = config.Whoami
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, path, args...)
	command.Env = append(os.Environ(), "NO_COLOR=1")
	return command.Run() == nil
}

func connectorPath(provider, command string) (string, bool, error) {
	if path, err := exec.LookPath(command); err == nil {
		return path, false, nil
	}
	path := filepath.Join(toolchainRoot(), "connectors", provider, "node_modules", ".bin", command)
	if provider == "flowershow" {
		path = filepath.Join(toolchainRoot(), "connectors", "flowershow", executableName("fl"))
	} else if runtime.GOOS == "windows" {
		path += ".cmd"
	}
	if !fileExists(path) {
		return "", false, os.ErrNotExist
	}
	return path, true, nil
}

func installNPMConnector(ctx context.Context, provider string) (string, error) {
	config, ok := connectorPackages[provider]
	if !ok {
		return "", errors.New("unsupported publishing connector")
	}
	if _, err := exec.LookPath("npm"); err != nil {
		return "", errors.New("connector setup requires Node.js")
	}
	connectorInstallMu.Lock()
	defer connectorInstallMu.Unlock()
	if path, _, err := connectorPath(provider, config.Command); err == nil {
		return path, nil
	}
	root := filepath.Join(toolchainRoot(), "connectors", provider)
	parent := filepath.Dir(root)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return "", err
	}
	temporary, err := os.MkdirTemp(parent, "."+provider+"-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	if _, err := runExternal(ctx, "npm", "install", "--prefix", temporary, "--no-audit", "--no-fund", config.Package+"@"+config.Version); err != nil {
		return "", fmt.Errorf("install %s connector: %w", provider, err)
	}
	if err := os.RemoveAll(root); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, root); err != nil {
		return "", err
	}
	return connectorPathOnly(provider, config.Command)
}

func connectorPathOnly(provider, command string) (string, error) {
	path, _, err := connectorPath(provider, command)
	return path, err
}

var flowershowChecksums = map[string]string{
	"darwin/amd64":  "e547dfeb80cb7e9b21edfac113ab9545faa8b4ed0b2db3c3907e0109d87db2c1",
	"darwin/arm64":  "9a0099680bff5801cd2f160960b80dc80d6f2d6340ccd3a3dc133cb1f83c033b",
	"linux/amd64":   "9315c07f030f98ef0b69f19c93fce9279b01eade6adc44d02bcb2319ae589153",
	"linux/arm64":   "3a757009a441df94de8b31b8d68ba8989aef2afa3a4074e74460e3f7a9001cfa",
	"windows/amd64": "471de34d18f7f2af746241e5a312299269557bdb643b9eee5b527f4ec100133e",
	"windows/arm64": "dde0c691da1be4c2ee8a397829aba67f23fb96f9133ba9474adbcfad7a0bfd5e",
}

func installFlowershow(ctx context.Context) (string, error) {
	connectorInstallMu.Lock()
	defer connectorInstallMu.Unlock()
	if path, _, err := connectorPath("flowershow", "fl"); err == nil {
		return path, nil
	}
	platform := runtime.GOOS + "/" + runtime.GOARCH
	expected, ok := flowershowChecksums[platform]
	if !ok {
		return "", errors.New("Flowershow does not provide a CLI for this platform")
	}
	extension := ".tar.gz"
	if runtime.GOOS == "windows" {
		extension = ".zip"
	}
	asset := fmt.Sprintf("fl_%s_%s%s", runtime.GOOS, runtime.GOARCH, extension)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://github.com/flowershow/flowershow/releases/download/cli/v2.2.0/"+asset, nil)
	if err != nil {
		return "", err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download Flowershow CLI: %s", response.Status)
	}
	archive, err := io.ReadAll(io.LimitReader(response.Body, 100<<20))
	if err != nil {
		return "", err
	}
	if digest := fmt.Sprintf("%x", sha256.Sum256(archive)); digest != expected {
		return "", errors.New("Flowershow CLI checksum mismatch")
	}
	binary, err := extractFlowershow(archive, extension)
	if err != nil {
		return "", err
	}
	root := filepath.Join(toolchainRoot(), "connectors", "flowershow")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(root, executableName("fl"))
	if err := os.WriteFile(path, binary, 0o700); err != nil {
		return "", err
	}
	return path, nil
}

func extractFlowershow(content []byte, extension string) ([]byte, error) {
	if extension == ".zip" {
		reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
		if err != nil {
			return nil, err
		}
		for _, file := range reader.File {
			if filepath.Base(file.Name) != executableName("fl") {
				continue
			}
			opened, err := file.Open()
			if err != nil {
				return nil, err
			}
			defer opened.Close()
			return io.ReadAll(io.LimitReader(opened, 100<<20))
		}
		return nil, errors.New("Flowershow archive does not contain fl")
	}
	gzipReader, err := gzip.NewReader(bytes.NewReader(content))
	if err != nil {
		return nil, err
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if filepath.Base(header.Name) == "fl" && header.Size <= 100<<20 {
			return io.ReadAll(io.LimitReader(tarReader, 100<<20))
		}
	}
	return nil, errors.New("Flowershow archive does not contain fl")
}

func executableName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func Deploy(ctx context.Context, sitePath, repositoryPath string, config DeploymentConfig) (string, error) {
	switch config.Provider {
	case "github-pages":
		return DeployGitHubPages(ctx, sitePath, repositoryPath, config)
	case "vercel":
		return deployCommand(ctx, "vercel", []string{"deploy", sitePath, "--prod", "--yes", "--name", config.Project}, func(output []byte) (string, error) {
			return lastURL(output, "vercel.app")
		})
	case "cloudflare-pages":
		if _, err := runCommand(ctx, "wrangler", "pages", "project", "create", config.Project, "--production-branch", "main"); err != nil && !strings.Contains(strings.ToLower(err.Error()), "already exists") {
			return "", err
		}
		return deployCommand(ctx, "wrangler", []string{"pages", "deploy", sitePath, "--project-name", config.Project}, func(output []byte) (string, error) {
			return lastURL(output, "pages.dev")
		})
	case "netlify":
		siteID, err := netlifySiteID(ctx, config.Project, true)
		if err != nil {
			return "", err
		}
		return deployCommand(ctx, "netlify", []string{"deploy", "--dir", sitePath, "--prod", "--site", siteID, "--json"}, func(output []byte) (string, error) {
			var result struct {
				URL    string `json:"url"`
				SSLURL string `json:"ssl_url"`
			}
			if err := json.Unmarshal(output, &result); err != nil {
				return "", errors.New("Netlify did not return deployment JSON")
			}
			if result.SSLURL != "" {
				return result.SSLURL, nil
			}
			return result.URL, nil
		})
	default:
		return "", errors.New("unsupported deployment provider")
	}
}

func Unpublish(ctx context.Context, repositoryPath string, config DeploymentConfig) error {
	switch config.Provider {
	case "github-pages":
		return UnpublishGitHubPages(ctx, repositoryPath, config)
	case "vercel":
		_, err := runCommand(ctx, "vercel", "remove", config.Project, "--yes")
		return err
	case "cloudflare-pages":
		_, err := runCommand(ctx, "wrangler", "pages", "project", "delete", config.Project, "--yes")
		return err
	case "netlify":
		siteID, resolveErr := netlifySiteID(ctx, config.Project, false)
		if resolveErr != nil {
			return resolveErr
		}
		_, err := runCommand(ctx, "netlify", "sites:delete", "--site", siteID, "--force")
		return err
	case "flowershow":
		_, err := runCommand(ctx, "fl", "delete", config.Project, "--yes")
		return err
	default:
		return errors.New("unsupported deployment provider")
	}
}

func netlifySiteID(ctx context.Context, name string, create bool) (string, error) {
	output, err := runCommand(ctx, "netlify", "sites:list", "--json")
	if err != nil {
		return "", err
	}
	var sites []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(output, &sites); err != nil {
		return "", errors.New("Netlify did not return a valid site list")
	}
	for _, site := range sites {
		if site.Name == name {
			return site.ID, nil
		}
	}
	if !create {
		return "", errors.New("Netlify site was not found")
	}
	output, err = runCommand(ctx, "netlify", "sites:create", "--name", name, "--json")
	if err != nil {
		return "", err
	}
	var site struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(output, &site); err != nil || site.ID == "" {
		return "", errors.New("Netlify did not return the created site ID")
	}
	return site.ID, nil
}

func DeployFlowershow(ctx context.Context, contentPath string, config DeploymentConfig) (string, error) {
	return deployCommand(ctx, "fl", []string{"--name", config.Project, "--yes", contentPath}, func(output []byte) (string, error) {
		return lastURL(output, "flowershow")
	})
}

func deployCommand(ctx context.Context, executable string, args []string, parse func([]byte) (string, error)) (string, error) {
	output, err := runCommand(ctx, executable, args...)
	if err != nil {
		return "", err
	}
	url, err := parse(output)
	if err != nil || url == "" {
		return "", errors.New("deployment completed without a public URL")
	}
	return url, nil
}

func runCommand(ctx context.Context, executable string, args ...string) ([]byte, error) {
	provider := map[string]string{"vercel": "vercel", "wrangler": "cloudflare-pages", "netlify": "netlify", "fl": "flowershow"}[executable]
	path, _, err := connectorPath(provider, executable)
	if err != nil {
		return nil, fmt.Errorf("%s connector is not set up", executable)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, path, args...)
	command.Env = append(os.Environ(), "NO_COLOR=1")
	output, err := command.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("%s: %s", executable, strings.TrimSpace(string(output)))
	}
	return output, nil
}

func lastURL(output []byte, hostHint string) (string, error) {
	fields := strings.Fields(string(output))
	for index := len(fields) - 1; index >= 0; index-- {
		candidate := strings.Trim(fields[index], "()[]{}<>,.;\"'")
		parsed, err := url.Parse(candidate)
		if err == nil && parsed.Scheme == "https" && strings.Contains(parsed.Host, hostHint) {
			return parsed.String(), nil
		}
	}
	return "", errors.New("public URL not found in connector output")
}

func DeployGitHubPages(ctx context.Context, sitePath, repositoryPath string, config DeploymentConfig) (string, error) {
	if err := ValidateDeployment(config); err != nil {
		return "", err
	}
	if _, err := exec.LookPath("git"); err != nil {
		return "", errors.New("Git is required for GitHub Pages publishing")
	}
	branch := config.Branch
	if branch == "" {
		branch = "gh-pages"
	}
	if err := os.MkdirAll(repositoryPath, 0o700); err != nil {
		return "", err
	}
	if _, err := os.Stat(filepath.Join(repositoryPath, ".git")); errors.Is(err, os.ErrNotExist) {
		if _, err := runGit(ctx, repositoryPath, "init"); err != nil {
			return "", err
		}
		if _, err := runGit(ctx, repositoryPath, "remote", "add", "origin", config.RepositoryURL); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else if _, err := runGit(ctx, repositoryPath, "remote", "set-url", "origin", config.RepositoryURL); err != nil {
		return "", err
	}
	if _, err := runGit(ctx, repositoryPath, "fetch", "origin", branch); err == nil {
		if _, err := runGit(ctx, repositoryPath, "checkout", "-B", branch, "origin/"+branch); err != nil {
			return "", err
		}
	} else if _, err := runGit(ctx, repositoryPath, "checkout", "-B", branch); err != nil {
		return "", err
	}
	if err := replaceWorkingTree(repositoryPath, sitePath); err != nil {
		return "", err
	}
	if _, err := runGit(ctx, repositoryPath, "add", "--all"); err != nil {
		return "", err
	}
	changed, err := runGit(ctx, repositoryPath, "status", "--porcelain")
	if err != nil {
		return "", err
	}
	if len(bytes.TrimSpace(changed)) > 0 {
		_, _ = runGit(ctx, repositoryPath, "config", "user.name", "Flux Publish")
		_, _ = runGit(ctx, repositoryPath, "config", "user.email", "publish@flux.local")
		if _, err := runGit(ctx, repositoryPath, "commit", "-m", "publish: update public site"); err != nil {
			return "", err
		}
	}
	if _, err := runGit(ctx, repositoryPath, "push", "--set-upstream", "origin", branch); err != nil {
		return "", err
	}
	return githubPagesURL(config.RepositoryURL), nil
}

func UnpublishGitHubPages(ctx context.Context, repositoryPath string, config DeploymentConfig) error {
	if err := ValidateDeployment(config); err != nil {
		return err
	}
	branch := config.Branch
	if branch == "" {
		branch = "gh-pages"
	}
	if _, err := os.Stat(filepath.Join(repositoryPath, ".git")); err != nil {
		return errors.New("local publication repository is unavailable")
	}
	_, err := runGit(ctx, repositoryPath, "push", "origin", "--delete", branch)
	return err
}

func runGit(ctx context.Context, directory string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "git", args...)
	command.Dir = directory
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := command.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("git %s: %s", args[0], strings.TrimSpace(string(output)))
	}
	return output, nil
}

func replaceWorkingTree(repositoryPath, sitePath string) error {
	entries, err := os.ReadDir(repositoryPath)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == ".git" {
			continue
		}
		if err := os.RemoveAll(filepath.Join(repositoryPath, entry.Name())); err != nil {
			return err
		}
	}
	return filepath.WalkDir(sitePath, func(source string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(sitePath, source)
		if err != nil || relative == "." {
			return err
		}
		destination := filepath.Join(repositoryPath, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o700)
		}
		content, err := os.ReadFile(source)
		if err != nil {
			return err
		}
		return os.WriteFile(destination, content, 0o600)
	})
}

func githubPagesURL(repositoryURL string) string {
	trimmed := strings.TrimSuffix(strings.TrimSuffix(repositoryURL, ".git"), "/")
	if strings.HasPrefix(trimmed, "git@github.com:") {
		trimmed = "https://github.com/" + strings.TrimPrefix(trimmed, "git@github.com:")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 2 {
		return ""
	}
	if parts[1] == parts[0]+".github.io" {
		return "https://" + parts[1] + "/"
	}
	return "https://" + parts[0] + ".github.io/" + parts[1] + "/"
}
