package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/flux-pkm/server/internal/files"
	"github.com/flux-pkm/server/internal/publish"
	"github.com/google/uuid"
)

var ErrPublicationNotFound = errors.New("publication not found")

type publishConfig struct {
	Publications []publish.Publication `json:"publications"`
}

func (s *Service) ListPublications(vaultID string) ([]publish.Publication, error) {
	_, config, err := s.readPublishConfig(vaultID)
	if err != nil {
		return nil, err
	}
	if config.Publications == nil {
		return []publish.Publication{}, nil
	}
	return config.Publications, nil
}

func (s *Service) CreatePublication(vaultID string, request publish.CreatePublicationRequest) (publish.Publication, error) {
	name := strings.TrimSpace(request.Name)
	if name == "" || len(name) > 120 {
		return publish.Publication{}, errors.New("publication name is required")
	}
	selection := publish.SelectionConfig{Include: request.Include, Exclude: request.Exclude}
	if err := publish.ValidateSelectionConfig(selection); err != nil {
		return publish.Publication{}, err
	}
	if err := publish.ValidateTarget(request.Renderer, request.Deployment); err != nil {
		return publish.Publication{}, err
	}
	for _, relativePath := range request.ExplicitPaths {
		if _, err := files.NormalizePath(relativePath); err != nil {
			return publish.Publication{}, fmt.Errorf("invalid selected path: %s", relativePath)
		}
	}
	id, err := uuid.NewV7()
	if err != nil {
		return publish.Publication{}, err
	}
	now := time.Now().UTC()
	publication := publish.Publication{ID: id.String(), VaultID: vaultID, Name: name, Title: strings.TrimSpace(request.Title), Renderer: request.Renderer, Selection: selection, ExplicitPaths: request.ExplicitPaths, Deployment: request.Deployment, CreatedAt: now, UpdatedAt: now, State: "draft"}
	if publication.Renderer.ID == "" {
		publication.Renderer.ID = "flux"
	}
	if publication.Deployment.Provider == "" {
		publication.Deployment.Provider = "bundle"
	}
	if publication.Deployment.Provider == "github-pages" && publication.Deployment.Branch == "" {
		publication.Deployment.Branch = "gh-pages"
	}
	if publication.Title == "" {
		publication.Title = name
	}

	s.publishMu.Lock()
	defer s.publishMu.Unlock()
	root, config, err := s.readPublishConfig(vaultID)
	if err != nil {
		return publish.Publication{}, err
	}
	config.Publications = append(config.Publications, publication)
	if err := s.writePublishConfig(vaultID, root, config); err != nil {
		return publish.Publication{}, err
	}
	return publication, nil
}

func (s *Service) DeletePublication(vaultID, publicationID string) error {
	s.publishMu.Lock()
	defer s.publishMu.Unlock()
	root, config, err := s.readPublishConfig(vaultID)
	if err != nil {
		return err
	}
	for index, publication := range config.Publications {
		if publication.ID != publicationID {
			continue
		}
		if publication.State == "published" {
			return errors.New("unpublish before deleting this publication")
		}
		config.Publications = append(config.Publications[:index], config.Publications[index+1:]...)
		return s.writePublishConfig(vaultID, root, config)
	}
	return ErrPublicationNotFound
}

func (s *Service) UpdatePublication(vaultID, publicationID string, request publish.UpdatePublicationRequest) (publish.Publication, error) {
	selection := publish.SelectionConfig{Include: request.Include, Exclude: request.Exclude}
	if err := publish.ValidateSelectionConfig(selection); err != nil {
		return publish.Publication{}, err
	}
	for _, relativePath := range request.ExplicitPaths {
		if _, err := files.NormalizePath(relativePath); err != nil {
			return publish.Publication{}, fmt.Errorf("invalid selected path: %s", relativePath)
		}
	}
	publication, err := s.publication(vaultID, publicationID)
	if err != nil {
		return publish.Publication{}, err
	}
	if request.Name != nil {
		name := strings.TrimSpace(*request.Name)
		if name == "" || len(name) > 120 {
			return publish.Publication{}, errors.New("publication name is required")
		}
		publication.Name = name
	}
	if request.Title != nil {
		publication.Title = strings.TrimSpace(*request.Title)
		if publication.Title == "" {
			publication.Title = publication.Name
		}
	}
	if request.Deployment != nil {
		publication.Deployment = *request.Deployment
		if publication.Deployment.Provider == "" {
			publication.Deployment.Provider = "bundle"
		}
		if publication.Deployment.Provider == "github-pages" && publication.Deployment.Branch == "" {
			publication.Deployment.Branch = "gh-pages"
		}
	}
	if request.Renderer != nil {
		publication.Renderer = *request.Renderer
	}
	if err := publish.ValidateTarget(publication.Renderer, publication.Deployment); err != nil {
		return publish.Publication{}, err
	}
	publication.Selection, publication.ExplicitPaths, publication.UpdatedAt = selection, request.ExplicitPaths, time.Now().UTC()
	if err := s.savePublication(vaultID, publication); err != nil {
		return publish.Publication{}, err
	}
	return publication, nil
}

func (s *Service) BuildPublication(ctx context.Context, vaultID, publicationID string, production bool) (publish.SnapshotResult, error) {
	return s.buildPublication(ctx, vaultID, publicationID, production, nil)
}

func (s *Service) buildPublication(ctx context.Context, vaultID, publicationID string, production bool, progress func(string)) (publish.SnapshotResult, error) {
	// ponytail: one build at a time prevents cache/deploy collisions; split per publication if throughput matters.
	s.publishBuildMu.Lock()
	defer s.publishBuildMu.Unlock()
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return publish.SnapshotResult{}, err
	}
	if vaultContext.Index == nil || vaultContext.VaultInfo().State != "active" {
		return publish.SnapshotResult{}, errors.New("vault index is not ready")
	}
	publications, err := s.ListPublications(vaultID)
	if err != nil {
		return publish.SnapshotResult{}, err
	}
	var publication *publish.Publication
	for index := range publications {
		if publications[index].ID == publicationID {
			publication = &publications[index]
			break
		}
	}
	if publication == nil {
		return publish.SnapshotResult{}, ErrPublicationNotFound
	}
	for attempt := 0; attempt < 3; attempt++ {
		revision := vaultContext.Revision.Load()
		entries, err := vaultContext.ListFiles()
		if err != nil {
			return publish.SnapshotResult{}, err
		}
		// ponytail: one graph snapshot is enough for V1A; add bulk excerpts/search projection with renderer work.
		graph, err := vaultContext.Index.Graph()
		if err != nil {
			return publish.SnapshotResult{}, err
		}
		result, err := publish.BuildSnapshot(vaultContext.RootPath(), *publication, entries, graph, production)
		if err != nil {
			return publish.SnapshotResult{}, err
		}
		if revision == vaultContext.Revision.Load() {
			if progress != nil {
				progress("rendering")
			}
			result.SitePath, err = publish.Render(ctx, result.OutputPath, publication.Renderer)
			if err != nil {
				return publish.SnapshotResult{}, err
			}
			result.State = "ready"
			if production && publication.Deployment.Provider != "bundle" {
				if progress != nil {
					progress("deploying")
				}
				repositoryPath := filepath.Join(vaultContext.RootPath(), ".flux", "cache", "publish", publication.ID, "repository")
				if publication.Deployment.Provider == "flowershow" {
					contentPath, contentErr := publish.MaterializeMarkdown(result.OutputPath)
					if contentErr != nil {
						return publish.SnapshotResult{}, contentErr
					}
					result.PublishedURL, err = publish.DeployFlowershow(ctx, contentPath, publication.Deployment)
				} else {
					result.PublishedURL, err = publish.Deploy(ctx, result.SitePath, repositoryPath, publication.Deployment)
				}
				if err != nil {
					return publish.SnapshotResult{}, err
				}
				result.State = "published"
			}
			if production {
				now := time.Now().UTC()
				publication.LastSnapshot, publication.PublishedURL, publication.State, publication.UpdatedAt = result.SnapshotID, result.PublishedURL, result.State, now
				if result.State == "published" {
					publication.PublishedAt = &now
				}
				if err := s.savePublication(vaultID, *publication); err != nil {
					return publish.SnapshotResult{}, err
				}
			}
			return result, nil
		}
	}
	return publish.SnapshotResult{}, errors.New("vault is changing; retry publication")
}

func (s *Service) StartPublicationJob(vaultID, publicationID string, production bool) (publish.Job, error) {
	if _, err := s.publication(vaultID, publicationID); err != nil {
		return publish.Job{}, err
	}
	if err := s.ensurePublicationJobs(vaultID); err != nil {
		return publish.Job{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return publish.Job{}, err
	}
	now := time.Now().UTC()
	kind := "preview"
	if production {
		kind = "publish"
	}
	job := publish.Job{ID: id.String(), VaultID: vaultID, PublicationID: publicationID, Kind: kind, Status: "queued", CreatedAt: now, UpdatedAt: now}
	s.publishJobsMu.Lock()
	s.publishJobs[job.ID] = job
	if err := s.persistPublicationJobsLocked(vaultID); err != nil {
		delete(s.publishJobs, job.ID)
		s.publishJobsMu.Unlock()
		return publish.Job{}, err
	}
	s.publishJobsMu.Unlock()
	go s.runPublicationJob(job.ID, production)
	return job, nil
}

func (s *Service) PublicationJob(vaultID, publicationID, jobID string) (publish.Job, error) {
	if err := s.ensurePublicationJobs(vaultID); err != nil {
		return publish.Job{}, err
	}
	s.publishJobsMu.RLock()
	job, ok := s.publishJobs[jobID]
	s.publishJobsMu.RUnlock()
	if !ok || job.VaultID != vaultID || job.PublicationID != publicationID {
		return publish.Job{}, ErrPublicationNotFound
	}
	return job, nil
}

func (s *Service) ListPublicationJobs(vaultID, publicationID string) ([]publish.Job, error) {
	if _, err := s.publication(vaultID, publicationID); err != nil {
		return nil, err
	}
	if err := s.ensurePublicationJobs(vaultID); err != nil {
		return nil, err
	}
	s.publishJobsMu.RLock()
	jobs := make([]publish.Job, 0)
	for _, job := range s.publishJobs {
		if job.VaultID == vaultID && job.PublicationID == publicationID {
			jobs = append(jobs, job)
		}
	}
	s.publishJobsMu.RUnlock()
	slices.SortFunc(jobs, func(a, b publish.Job) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return jobs, nil
}

func (s *Service) runPublicationJob(jobID string, production bool) {
	s.updatePublicationJob(jobID, func(job *publish.Job) { job.Status = "snapshotting" })
	job := s.publicationJob(jobID)
	result, err := s.buildPublication(context.Background(), job.VaultID, job.PublicationID, production, func(status string) {
		s.updatePublicationJob(jobID, func(job *publish.Job) { job.Status = status })
	})
	if err != nil {
		s.updatePublicationJob(jobID, func(job *publish.Job) {
			job.Status = "failed"
			job.Error = err.Error()
		})
		return
	}
	s.updatePublicationJob(jobID, func(job *publish.Job) {
		job.Result = &result
		if production {
			job.Status = "succeeded"
		} else {
			job.Status = "ready"
		}
	})
}

func (s *Service) publicationJob(jobID string) publish.Job {
	s.publishJobsMu.RLock()
	defer s.publishJobsMu.RUnlock()
	return s.publishJobs[jobID]
}

func (s *Service) updatePublicationJob(jobID string, update func(*publish.Job)) {
	s.publishJobsMu.Lock()
	defer s.publishJobsMu.Unlock()
	job := s.publishJobs[jobID]
	update(&job)
	job.UpdatedAt = time.Now().UTC()
	s.publishJobs[jobID] = job
	_ = s.persistPublicationJobsLocked(job.VaultID)
}

func (s *Service) ensurePublicationJobs(vaultID string) error {
	s.publishJobsMu.Lock()
	defer s.publishJobsMu.Unlock()
	if s.publishJobsLoaded[vaultID] {
		return nil
	}
	root, err := s.VaultPath(vaultID)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(filepath.Join(root, ".flux", "cache", "publish", "jobs.json"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	var jobs []publish.Job
	if len(content) > 0 {
		if err := json.Unmarshal(content, &jobs); err != nil {
			return errors.New("invalid publish job history")
		}
	}
	now := time.Now().UTC()
	for _, job := range jobs {
		job.VaultID = vaultID
		if job.Status == "queued" || job.Status == "snapshotting" || job.Status == "rendering" || job.Status == "deploying" {
			job.Status, job.Error, job.UpdatedAt = "failed", "Flux closed before this build completed", now
		}
		s.publishJobs[job.ID] = job
	}
	s.publishJobsLoaded[vaultID] = true
	return s.persistPublicationJobsLocked(vaultID)
}

func (s *Service) persistPublicationJobsLocked(vaultID string) error {
	root, err := s.VaultPath(vaultID)
	if err != nil {
		return err
	}
	jobs := make([]publish.Job, 0)
	for _, job := range s.publishJobs {
		if job.VaultID == vaultID {
			jobs = append(jobs, job)
		}
	}
	slices.SortFunc(jobs, func(a, b publish.Job) int { return b.CreatedAt.Compare(a.CreatedAt) })
	if len(jobs) > 100 {
		for _, job := range jobs[100:] {
			delete(s.publishJobs, job.ID)
		}
		jobs = jobs[:100]
	}
	directory := filepath.Join(root, ".flux", "cache", "publish")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, "jobs-*.json")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(jobs); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, filepath.Join(directory, "jobs.json"))
}

func (s *Service) PublicationPreview(vaultID, publicationID, snapshotID string) ([]byte, error) {
	if len(snapshotID) != 64 || strings.Trim(snapshotID, "0123456789abcdef") != "" {
		return nil, errors.New("invalid snapshot id")
	}
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	if _, err := s.publication(vaultID, publicationID); err != nil {
		return nil, err
	}
	content, err := os.ReadFile(filepath.Join(vaultContext.RootPath(), ".flux", "cache", "publish", publicationID, snapshotID, "site", "index.html"))
	if err != nil {
		return nil, err
	}
	return bytes.Replace(content, []byte("<head>"), []byte(`<head><base href="about:srcdoc">`), 1), nil
}

func (s *Service) UnpublishPublication(ctx context.Context, vaultID, publicationID string) error {
	publication, err := s.publication(vaultID, publicationID)
	if err != nil {
		return err
	}
	if publication.State != "published" {
		return nil
	}
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	repositoryPath := filepath.Join(vaultContext.RootPath(), ".flux", "cache", "publish", publication.ID, "repository")
	if err := publish.Unpublish(ctx, repositoryPath, publication.Deployment); err != nil {
		return err
	}
	publication.State, publication.PublishedURL, publication.PublishedAt = "draft", "", nil
	publication.UpdatedAt = time.Now().UTC()
	return s.savePublication(vaultID, publication)
}

func (s *Service) publication(vaultID, publicationID string) (publish.Publication, error) {
	publications, err := s.ListPublications(vaultID)
	if err != nil {
		return publish.Publication{}, err
	}
	for _, publication := range publications {
		if publication.ID == publicationID {
			return publication, nil
		}
	}
	return publish.Publication{}, ErrPublicationNotFound
}

func (s *Service) savePublication(vaultID string, updated publish.Publication) error {
	s.publishMu.Lock()
	defer s.publishMu.Unlock()
	root, config, err := s.readPublishConfig(vaultID)
	if err != nil {
		return err
	}
	for index := range config.Publications {
		if config.Publications[index].ID == updated.ID {
			config.Publications[index] = updated
			return s.writePublishConfig(vaultID, root, config)
		}
	}
	return ErrPublicationNotFound
}

func (s *Service) readPublishConfig(vaultID string) (map[string]json.RawMessage, publishConfig, error) {
	raw, err := s.VaultConfig(vaultID)
	if err != nil {
		return nil, publishConfig{}, err
	}
	root := make(map[string]json.RawMessage)
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, publishConfig{}, err
	}
	config := publishConfig{Publications: []publish.Publication{}}
	if value := root["publish"]; len(value) > 0 {
		if err := json.Unmarshal(value, &config); err != nil {
			return nil, publishConfig{}, errors.New("invalid publish config")
		}
	}
	return root, config, nil
}

func (s *Service) writePublishConfig(vaultID string, root map[string]json.RawMessage, config publishConfig) error {
	value, err := json.Marshal(config)
	if err != nil {
		return err
	}
	root["publish"] = value
	content, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return err
	}
	return s.SaveVaultConfig(vaultID, content)
}
