package capability

import (
	"context"
	"errors"
	"testing"
)

func TestPolicyScopesCapabilitiesAndApprovals(t *testing.T) {
	principal := Principal{
		ID: "codex", Mode: Guided,
		Vaults:       map[string]bool{"vault-a": true},
		Capabilities: map[Capability]bool{VaultRead: true, VaultWrite: true},
	}
	policy, err := NewPolicy(principal, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := policy.Authorize(context.Background(), "vault-a", VaultRead, "read note.md"); err != nil {
		t.Fatalf("read denied: %v", err)
	}
	if err := policy.Authorize(context.Background(), "vault-b", VaultRead, "read note.md"); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("out-of-scope vault allowed: %v", err)
	}
	if err := policy.Authorize(context.Background(), "vault-a", VaultWrite, "save note.md"); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("guided write without UI allowed: %v", err)
	}

	policy, err = NewPolicy(principal, func(_ context.Context, request ApprovalRequest) (bool, error) {
		return request.ClientID == "codex" && request.Action == "save note.md", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := policy.Authorize(context.Background(), "vault-a", VaultWrite, "save note.md"); err != nil {
		t.Fatalf("approved write denied: %v", err)
	}
	if err := policy.Authorize(context.Background(), "vault-a", VaultDelete, "delete note.md"); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("missing delete capability allowed: %v", err)
	}
	policy.SetValidator(func(context.Context) error { return errors.New("revoked") })
	if err := policy.Authorize(context.Background(), "vault-a", VaultRead, "read note.md"); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("revoked principal allowed: %v", err)
	}
}
