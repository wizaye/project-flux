package agent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type pendingApproval struct {
	threadID string
	turnID   string
	decision chan string
}

type Service struct {
	store     *Store
	vaultPath func(string) (string, error)
	mu        sync.Mutex
	wg        sync.WaitGroup
	running   map[string]context.CancelFunc
	approvals map[string]pendingApproval
	wake      map[string]chan struct{}
	sessions  map[string]*acpRuntime
}

func NewService(db *gorm.DB, vaultPath ...func(string) (string, error)) (*Service, error) {
	store, err := NewStore(db)
	if err != nil {
		return nil, err
	}
	service := &Service{
		store: store, running: make(map[string]context.CancelFunc),
		approvals: make(map[string]pendingApproval), wake: make(map[string]chan struct{}),
		sessions: make(map[string]*acpRuntime),
	}
	if len(vaultPath) > 0 {
		service.vaultPath = vaultPath[0]
	}
	return service, nil
}

func (s *Service) CreateThread(request CreateThreadRequest) (Thread, error) {
	request.VaultID = strings.TrimSpace(request.VaultID)
	request.Configuration.ProviderID = strings.TrimSpace(request.Configuration.ProviderID)
	if request.VaultID == "" || request.Configuration.ProviderID == "" || !validMode(request.Configuration.Mode) {
		return Thread{}, ErrInvalidRequest
	}
	if request.Configuration.ProviderID != "demo" {
		if _, available := findProvider(request.Configuration.ProviderID); !available {
			return Thread{}, ErrInvalidRequest
		}
	}
	now := time.Now().UTC()
	thread := Thread{
		ID: uuid.NewString(), VaultID: request.VaultID, Title: strings.TrimSpace(request.Title),
		Configuration: request.Configuration, Status: "idle", CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.CreateThread(thread); err != nil {
		return Thread{}, err
	}
	return thread, nil
}

func (s *Service) Thread(id string) (Thread, error) { return s.store.Thread(id) }

func (s *Service) Threads(vaultID string) ([]Thread, error) {
	if strings.TrimSpace(vaultID) == "" {
		return nil, ErrInvalidRequest
	}
	return s.store.Threads(vaultID)
}

func (s *Service) UpdateConfiguration(id string, configuration Configuration) (Thread, error) {
	configuration.ProviderID = strings.TrimSpace(configuration.ProviderID)
	if configuration.ProviderID == "" || !validMode(configuration.Mode) {
		return Thread{}, ErrInvalidRequest
	}
	if configuration.ProviderID != "demo" {
		if _, available := findProvider(configuration.ProviderID); !available {
			return Thread{}, ErrInvalidRequest
		}
	}
	thread, err := s.store.Thread(id)
	if err != nil {
		return Thread{}, err
	}
	if thread.ActiveTurnID != "" {
		return Thread{}, ErrBusy
	}
	s.closeSession(id)
	thread.Configuration, thread.ProviderSessionID, thread.UpdatedAt = configuration, "", time.Now().UTC()
	if err := s.store.UpdateThread(thread); err != nil {
		return Thread{}, err
	}
	return thread, nil
}

func (s *Service) RenameThread(id, title string) (Thread, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return Thread{}, ErrInvalidRequest
	}
	thread, err := s.store.Thread(id)
	if err != nil {
		return Thread{}, err
	}
	thread.Title, thread.UpdatedAt = truncateTitle(title, 120), time.Now().UTC()
	if err := s.store.UpdateThread(thread); err != nil {
		return Thread{}, err
	}
	return thread, nil
}

func (s *Service) DeleteThread(id string) error {
	thread, err := s.store.Thread(id)
	if err != nil {
		return err
	}
	if thread.ActiveTurnID != "" {
		return ErrBusy
	}
	s.closeSession(id)
	return s.store.DeleteThread(id)
}

func (s *Service) StartTurn(threadID string, request StartTurnRequest) (Turn, error) {
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return Turn{}, ErrInvalidRequest
	}
	thread, err := s.store.Thread(threadID)
	if err != nil {
		return Turn{}, err
	}
	if thread.ActiveTurnID != "" || thread.Status == "running" || thread.Status == "waiting" {
		return Turn{}, ErrBusy
	}
	now := time.Now().UTC()
	turn := Turn{ID: uuid.NewString(), ThreadID: threadID, Status: "running", CreatedAt: now}
	if thread.Title == "" || strings.EqualFold(strings.TrimSpace(thread.Title), "New chat") {
		thread.Title = truncateTitle(strings.Join(strings.Fields(strings.SplitN(prompt, "\n", 2)[0]), " "), 60)
	}
	thread.Status, thread.ActiveTurnID, thread.UpdatedAt = "running", turn.ID, now
	if err := s.store.UpdateThread(thread); err != nil {
		return Turn{}, err
	}
	if _, err := s.emit(threadID, turn.ID, "turn.started", map[string]any{"prompt": prompt}); err != nil {
		thread.Status, thread.ActiveTurnID, thread.UpdatedAt = "error", "", time.Now().UTC()
		_ = s.store.UpdateThread(thread)
		return Turn{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.wg.Add(1)
	s.running[turn.ID] = cancel
	go s.runTurn(ctx, thread, turn, prompt)
	s.mu.Unlock()
	return turn, nil
}

func truncateTitle(title string, limit int) string {
	runes := []rune(title)
	if len(runes) <= limit {
		return title
	}
	return strings.TrimSpace(string(runes[:limit-1])) + "…"
}

func (s *Service) InterruptTurn(threadID, turnID string) error {
	thread, err := s.store.Thread(threadID)
	if err != nil {
		return err
	}
	if thread.ActiveTurnID != turnID {
		return ErrNotFound
	}
	s.mu.Lock()
	cancel := s.running[turnID]
	s.mu.Unlock()
	if cancel == nil {
		return ErrNotFound
	}
	cancel()
	s.mu.Lock()
	runtime := s.sessions[threadID]
	s.mu.Unlock()
	if runtime != nil {
		runtime.Cancel()
	}
	return nil
}

func (s *Service) RespondApproval(threadID, requestID, optionID string) error {
	if strings.TrimSpace(optionID) == "" {
		return ErrInvalidRequest
	}
	s.mu.Lock()
	pending, ok := s.approvals[requestID]
	if ok && pending.threadID == threadID {
		delete(s.approvals, requestID)
	}
	s.mu.Unlock()
	if !ok || pending.threadID != threadID {
		return ErrApprovalNotFound
	}
	pending.decision <- optionID
	return nil
}

func (s *Service) EventsAfter(threadID string, sequence int64) ([]Event, error) {
	if _, err := s.store.Thread(threadID); err != nil {
		return nil, err
	}
	return s.store.EventsAfter(threadID, sequence)
}

func (s *Service) WaitEvents(ctx context.Context, threadID string, sequence int64) ([]Event, error) {
	for {
		events, err := s.EventsAfter(threadID, sequence)
		if err != nil || len(events) > 0 {
			return events, err
		}
		s.mu.Lock()
		wake := s.wake[threadID]
		if wake == nil {
			wake = make(chan struct{})
			s.wake[threadID] = wake
		}
		s.mu.Unlock()
		events, err = s.EventsAfter(threadID, sequence)
		if err != nil || len(events) > 0 {
			return events, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-wake:
		}
	}
}

func (s *Service) Close() {
	s.mu.Lock()
	for _, cancel := range s.running {
		cancel()
	}
	s.mu.Unlock()
	s.wg.Wait()
	s.mu.Lock()
	sessions := s.sessions
	s.sessions = make(map[string]*acpRuntime)
	s.mu.Unlock()
	for _, runtime := range sessions {
		runtime.Close()
	}
}

func (s *Service) emit(threadID, turnID, eventType string, payload any) (Event, error) {
	event, err := s.store.AppendEvent(threadID, turnID, eventType, payload)
	if err != nil {
		return Event{}, err
	}
	s.mu.Lock()
	if wake := s.wake[threadID]; wake != nil {
		close(wake)
		delete(s.wake, threadID)
	}
	s.mu.Unlock()
	return event, nil
}

func (s *Service) runTurn(ctx context.Context, thread Thread, turn Turn, prompt string) {
	if thread.Configuration.ProviderID == "demo" {
		s.runDemo(ctx, thread, turn)
		return
	}
	defer s.wg.Done()
	defer func() {
		s.mu.Lock()
		delete(s.running, turn.ID)
		s.mu.Unlock()
	}()
	runtime, err := s.agentSession(ctx, &thread)
	if err != nil {
		s.failTurn(thread, turn, err)
		return
	}
	response, err := runtime.Prompt(ctx, turn.ID, prompt)
	runtime.client.completeContent(turn.ID)
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			s.finishTurn(thread, turn, "interrupted", nil)
			return
		}
		s.closeSession(thread.ID)
		s.failTurn(thread, turn, err)
		return
	}
	status := "completed"
	if response.StopReason == "cancelled" {
		status = "interrupted"
	}
	var usage map[string]any
	if response.Usage != nil {
		usage = map[string]any{
			"inputTokens":  response.Usage.InputTokens,
			"outputTokens": response.Usage.OutputTokens,
			"durationMs":   time.Since(turn.CreatedAt).Milliseconds(),
		}
	}
	s.finishTurn(thread, turn, status, usage)
}

func (s *Service) agentSession(ctx context.Context, thread *Thread) (*acpRuntime, error) {
	s.mu.Lock()
	if runtime := s.sessions[thread.ID]; runtime != nil {
		select {
		case <-runtime.done:
			delete(s.sessions, thread.ID)
		default:
			s.mu.Unlock()
			return runtime, nil
		}
	}
	s.mu.Unlock()
	spec, available := findProvider(thread.Configuration.ProviderID)
	if !available {
		return nil, fmt.Errorf("agent provider %q is not installed", thread.Configuration.ProviderID)
	}
	root, err := os.Getwd()
	if s.vaultPath != nil {
		root, err = s.vaultPath(thread.VaultID)
	}
	if err != nil {
		return nil, err
	}
	runtime, err := startACPRuntime(ctx, s, thread, root, spec)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.sessions[thread.ID] = runtime
	s.mu.Unlock()
	return runtime, nil
}

func (s *Service) failTurn(thread Thread, turn Turn, err error) {
	_, _ = s.emit(thread.ID, turn.ID, "runtime.error", map[string]any{"message": err.Error()})
	s.finishTurn(thread, turn, "error", nil)
}

func (s *Service) closeSession(threadID string) {
	s.mu.Lock()
	runtime := s.sessions[threadID]
	delete(s.sessions, threadID)
	s.mu.Unlock()
	if runtime != nil {
		runtime.Close()
	}
}

func (s *Service) runDemo(ctx context.Context, thread Thread, turn Turn) {
	defer s.wg.Done()
	defer func() {
		s.mu.Lock()
		delete(s.running, turn.ID)
		s.mu.Unlock()
	}()
	fail := func(err error) {
		if errors.Is(err, context.Canceled) {
			s.finishTurn(thread, turn, "interrupted", nil)
			return
		}
		_, _ = s.emit(thread.ID, turn.ID, "runtime.error", map[string]any{"message": err.Error()})
		s.finishTurn(thread, turn, "error", nil)
	}
	emit := func(eventType string, payload any) bool {
		if err := wait(ctx, 15*time.Millisecond); err != nil {
			fail(err)
			return false
		}
		if _, err := s.emit(thread.ID, turn.ID, eventType, payload); err != nil {
			fail(err)
			return false
		}
		return true
	}
	if !emit("reasoning.delta", map[string]any{"itemId": "reasoning-1", "delta": "Inspecting the workspace and planning a focused change."}) ||
		!emit("reasoning.completed", map[string]any{"itemId": "reasoning-1"}) ||
		!emit("tool.started", map[string]any{"toolCallId": "search-1", "name": "web_search", "title": "Researching the relevant API"}) ||
		!emit("source.added", map[string]any{"sourceId": "source-1", "title": "Primary documentation", "url": "https://example.com/docs"}) ||
		!emit("tool.updated", map[string]any{"toolCallId": "search-1", "status": "completed", "detail": "Found the relevant documentation"}) ||
		!emit("message.delta", map[string]any{"messageId": "assistant-1", "delta": "I found the integration point and prepared a small typed change.\n\n```ts\nexport function createFeature() {\n  return { ready: true };\n}\n```\n"}) {
		return
	}
	requestID := uuid.NewString()
	decision := make(chan string, 1)
	s.mu.Lock()
	s.approvals[requestID] = pendingApproval{threadID: thread.ID, turnID: turn.ID, decision: decision}
	s.mu.Unlock()
	if !emit("approval.requested", map[string]any{
		"requestId": requestID, "title": "Apply the proposed file change",
		"detail": "The demo runtime will simulate writing src/feature.ts.",
		"options": []map[string]any{
			{"id": "approve", "label": "Apply patch", "kind": "allow_once"},
			{"id": "decline", "label": "Keep read-only", "kind": "reject_once"},
			{"id": "always_allow_session", "label": "Always allow this session", "kind": "allow_always"},
		},
	}) {
		s.removeApproval(requestID)
		return
	}
	thread.Status, thread.UpdatedAt = "waiting", time.Now().UTC()
	if err := s.store.UpdateThread(thread); err != nil {
		s.removeApproval(requestID)
		fail(err)
		return
	}
	var answer string
	select {
	case <-ctx.Done():
		s.removeApproval(requestID)
		fail(ctx.Err())
		return
	case answer = <-decision:
	}
	thread.Status, thread.UpdatedAt = "running", time.Now().UTC()
	if err := s.store.UpdateThread(thread); err != nil {
		fail(err)
		return
	}
	if !emit("approval.resolved", map[string]any{"requestId": requestID, "optionId": answer}) {
		return
	}
	if answer == "decline" {
		if !emit("tool.updated", map[string]any{"toolCallId": "write-1", "status": "declined"}) ||
			!emit("message.delta", map[string]any{"messageId": "assistant-1", "delta": "\nNo files were changed."}) {
			return
		}
	} else if !emit("tool.started", map[string]any{"toolCallId": "write-1", "name": "apply_patch", "title": "Updating src/feature.ts"}) ||
		!emit("tool.updated", map[string]any{"toolCallId": "write-1", "status": "completed"}) ||
		!emit("files.changed", map[string]any{"paths": []string{"src/feature.ts"}}) ||
		!emit("message.delta", map[string]any{"messageId": "assistant-1", "delta": "\nThe change is applied and ready to verify."}) {
		return
	}
	if !emit("message.completed", map[string]any{"messageId": "assistant-1"}) {
		return
	}
	s.finishTurn(thread, turn, "completed", map[string]any{
		"inputTokens": 128, "outputTokens": 96, "durationMs": time.Since(turn.CreatedAt).Milliseconds(),
	})
}

func (s *Service) finishTurn(thread Thread, turn Turn, status string, usage map[string]any) {
	thread.Status, thread.ActiveTurnID, thread.UpdatedAt = "idle", "", time.Now().UTC()
	if status == "error" {
		thread.Status = "error"
	}
	_ = s.store.UpdateThread(thread)
	payload := map[string]any{"status": status}
	if usage != nil {
		payload["usage"] = usage
	}
	_, _ = s.emit(thread.ID, turn.ID, "turn.completed", payload)
}

func (s *Service) removeApproval(requestID string) {
	s.mu.Lock()
	delete(s.approvals, requestID)
	s.mu.Unlock()
}

func validMode(mode string) bool {
	return mode == "ask" || mode == "plan" || mode == "agent" || mode == "tutor"
}

func wait(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
