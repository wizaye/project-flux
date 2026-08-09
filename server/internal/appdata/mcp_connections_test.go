package appdata

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestMCPConnectionCredentialLifecycle(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.RememberVault("vault-a", "/tmp/vault-a", "A"); err != nil {
		t.Fatal(err)
	}
	if err := store.RememberVault("vault-b", "/tmp/vault-b", "B"); err != nil {
		t.Fatal(err)
	}

	created, err := store.CreateMCPConnection(
		"VS Code",
		"guided_write",
		[]string{"vault-b", "vault-a", "vault-a"},
		`["vault.read","vault.write"]`,
	)
	if err != nil {
		t.Fatal(err)
	}
	if created.Secret == "" || len(created.VaultIDs) != 2 {
		t.Fatalf("unexpected credential: %#v", created)
	}
	if _, err := store.AuthenticateMCPConnection(created.ID, "wrong"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong secret should not authenticate: %v", err)
	}
	authenticated, err := store.AuthenticateMCPConnection(created.ID, created.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if authenticated.LastUsedAt == nil || authenticated.VaultIDs[0] != "vault-a" {
		t.Fatalf("unexpected authenticated connection: %#v", authenticated)
	}
	if err := store.RevokeMCPConnection(created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AuthenticateMCPConnection(created.ID, created.Secret); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked connection should not authenticate: %v", err)
	}
}
