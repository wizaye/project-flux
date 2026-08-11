package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/domain"
	"github.com/flux-pkm/server/internal/publish"
	"github.com/flux-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

func TestPublicationRoutesBuildSafeBundle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "public.md"), []byte("---\npublish: true\n---\nPublic\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "private.md"), []byte("---\npublish: false\n---\nROUTE-SECRET\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	service := application.NewService(manager)
	info, err := service.OpenVault(root)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		current, currentErr := service.VaultInfo(info.ID)
		if currentErr == nil && current.State == domain.VaultStateActive {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	router := gin.New()
	RegisterRoutes(router, service)

	create := jsonRequest(t, router, http.MethodPost, "/api/v1/vaults/"+info.ID+"/publications", map[string]any{
		"name": "Garden", "include": []string{"**/*.md"},
	}, http.StatusCreated)
	var publication publish.Publication
	if err := json.Unmarshal(create, &publication); err != nil || publication.ID == "" {
		t.Fatalf("invalid publication: %#v, %v", publication, err)
	}
	update := jsonRequest(t, router, http.MethodPut, "/api/v1/vaults/"+info.ID+"/publications/"+publication.ID, map[string]any{
		"name": "Public garden", "title": "Public Garden", "include": []string{}, "exclude": []string{"private.md"}, "explicitPaths": []string{"public.md"},
	}, http.StatusOK)
	if err := json.Unmarshal(update, &publication); err != nil || len(publication.ExplicitPaths) != 1 || publication.Title != "Public Garden" {
		t.Fatalf("invalid publication update: %#v, %v", publication, err)
	}
	preview := jsonRequest(t, router, http.MethodPost, "/api/v1/vaults/"+info.ID+"/publications/"+publication.ID+"/preview", nil, http.StatusAccepted)
	var job publish.Job
	if err := json.Unmarshal(preview, &job); err != nil || job.ID == "" {
		t.Fatalf("invalid preview job: %#v, %v", job, err)
	}
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); {
		body := jsonRequest(t, router, http.MethodGet, "/api/v1/vaults/"+info.ID+"/publications/"+publication.ID+"/jobs/"+job.ID, nil, http.StatusOK)
		if err := json.Unmarshal(body, &job); err != nil {
			t.Fatal(err)
		}
		if job.Status == "ready" || job.Status == "failed" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if job.Status != "ready" || job.Result == nil || job.Result.PageCount != 1 {
		t.Fatalf("invalid preview result: %#v", job)
	}
	result := *job.Result
	restarted := gin.New()
	RegisterRoutes(restarted, application.NewService(manager))
	persisted := jsonRequest(t, restarted, http.MethodGet, "/api/v1/vaults/"+info.ID+"/publications/"+publication.ID+"/jobs/"+job.ID, nil, http.StatusOK)
	var persistedJob publish.Job
	if err := json.Unmarshal(persisted, &persistedJob); err != nil || persistedJob.Status != "ready" {
		t.Fatalf("publish job was not persisted: %#v, %v", persistedJob, err)
	}
	manifest, err := os.ReadFile(filepath.Join(result.OutputPath, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(manifest, []byte("private.md")) || bytes.Contains(manifest, []byte("ROUTE-SECRET")) {
		t.Fatal("publication route leaked private content")
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/vaults/"+info.ID+"/publications/"+publication.ID+"/previews/"+result.SnapshotID, nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte("Public")) || bytes.Contains(response.Body.Bytes(), []byte("ROUTE-SECRET")) {
		t.Fatalf("unsafe preview response %d: %s", response.Code, response.Body.String())
	}
}

func jsonRequest(t *testing.T, router http.Handler, method, url string, body any, status int) []byte {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, url, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != status {
		t.Fatalf("%s %s = %d: %s", method, url, response.Code, response.Body.String())
	}
	return response.Body.Bytes()
}
