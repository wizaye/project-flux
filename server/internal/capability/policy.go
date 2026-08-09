package capability

import (
	"context"
	"errors"
	"fmt"
	"sort"
)

type Capability string

const (
	VaultRead   Capability = "vault.read"
	VaultWrite  Capability = "vault.write"
	VaultMove   Capability = "vault.move"
	VaultDelete Capability = "vault.delete"
)

type ApprovalMode string

const (
	ReadOnly ApprovalMode = "read_only"
	Guided   ApprovalMode = "guided_write"
	Trusted  ApprovalMode = "trusted_workspace"
)

var (
	ErrAccessDenied     = errors.New("access denied")
	ErrApprovalRequired = errors.New("approval required")
)

type Principal struct {
	ID           string
	Mode         ApprovalMode
	Vaults       map[string]bool
	Capabilities map[Capability]bool
}

type ApprovalRequest struct {
	ClientID   string
	VaultID    string
	Capability Capability
	Action     string
}

type Approver func(context.Context, ApprovalRequest) (bool, error)

type Policy struct {
	principal Principal
	approve   Approver
	validate  func(context.Context) error
}

func (p *Policy) SetValidator(validate func(context.Context) error) {
	p.validate = validate
}

func (p *Policy) Validate(ctx context.Context) error {
	if p.validate == nil {
		return nil
	}
	if err := p.validate(ctx); err != nil {
		return fmt.Errorf("%w: connection is invalid or revoked", ErrAccessDenied)
	}
	return nil
}

func NewPolicy(principal Principal, approve Approver) (*Policy, error) {
	if principal.ID == "" {
		return nil, fmt.Errorf("%w: missing client identity", ErrAccessDenied)
	}
	if principal.Mode != ReadOnly && principal.Mode != Guided && principal.Mode != Trusted {
		return nil, fmt.Errorf("%w: invalid approval mode", ErrAccessDenied)
	}
	return &Policy{principal: principal, approve: approve}, nil
}

func (p *Policy) VaultIDs() []string {
	ids := make([]string, 0, len(p.principal.Vaults))
	for id, allowed := range p.principal.Vaults {
		if allowed {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func (p *Policy) Authorize(ctx context.Context, vaultID string, capability Capability, action string) error {
	if err := p.Validate(ctx); err != nil {
		return err
	}
	if !p.principal.Vaults[vaultID] || !p.principal.Capabilities[capability] {
		return fmt.Errorf("%w: client %q lacks %s for vault %q", ErrAccessDenied, p.principal.ID, capability, vaultID)
	}
	if capability == VaultRead {
		return nil
	}
	switch p.principal.Mode {
	case ReadOnly:
		return fmt.Errorf("%w: client is read-only", ErrAccessDenied)
	case Trusted:
		return nil
	case Guided:
		if p.approve == nil {
			return ErrApprovalRequired
		}
		approved, err := p.approve(ctx, ApprovalRequest{
			ClientID: p.principal.ID, VaultID: vaultID, Capability: capability, Action: action,
		})
		if err != nil {
			return err
		}
		if !approved {
			return ErrAccessDenied
		}
		return nil
	default:
		return ErrAccessDenied
	}
}
