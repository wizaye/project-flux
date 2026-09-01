package agent

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrBusy             = errors.New("agent thread is already running")
	ErrInvalidRequest   = errors.New("invalid agent request")
	ErrNotFound         = errors.New("agent resource not found")
	ErrApprovalNotFound = errors.New("agent approval request not found")
)

type Configuration struct {
	ProviderID      string `json:"providerId"`
	Model           string `json:"model,omitempty"`
	Mode            string `json:"mode"`
	ReasoningEffort string `json:"reasoningEffort,omitempty"`
}

type ProviderCapabilities struct {
	Streaming bool `json:"streaming"`
	Reasoning bool `json:"reasoning"`
	Tools     bool `json:"tools"`
	Files     bool `json:"files"`
	Images    bool `json:"images"`
	Plans     bool `json:"plans"`
}

type Provider struct {
	ID           string               `json:"id"`
	Name         string               `json:"name"`
	Available    bool                 `json:"available"`
	Status       string               `json:"status"`
	Capabilities ProviderCapabilities `json:"capabilities"`
}

type Thread struct {
	ID                string        `json:"id"`
	VaultID           string        `json:"vaultId"`
	Title             string        `json:"title,omitempty"`
	Configuration     Configuration `json:"configuration"`
	Status            string        `json:"status"`
	ActiveTurnID      string        `json:"activeTurnId,omitempty"`
	ProviderSessionID string        `json:"-"`
	CreatedAt         time.Time     `json:"createdAt"`
	UpdatedAt         time.Time     `json:"updatedAt"`
}

type Turn struct {
	ID          string     `json:"id"`
	ThreadID    string     `json:"threadId"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

type Event struct {
	EventID   string          `json:"eventId"`
	Sequence  int64           `json:"sequence"`
	ThreadID  string          `json:"threadId"`
	TurnID    string          `json:"turnId,omitempty"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
}

type CreateThreadRequest struct {
	VaultID       string        `json:"vaultId"`
	Title         string        `json:"title,omitempty"`
	Configuration Configuration `json:"configuration"`
}

type StartTurnRequest struct {
	Prompt string `json:"prompt"`
}
