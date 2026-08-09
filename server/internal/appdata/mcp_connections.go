package appdata

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MCPConnection struct {
	ID         string     `gorm:"primaryKey" json:"id"`
	Name       string     `gorm:"not null" json:"name"`
	SecretHash string     `gorm:"not null" json:"-"`
	Mode       string     `gorm:"not null" json:"mode"`
	CreatedAt  time.Time  `gorm:"not null" json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
}

type MCPVaultGrant struct {
	ConnectionID string `gorm:"primaryKey" json:"connectionId"`
	VaultID      string `gorm:"primaryKey" json:"vaultId"`
	Capabilities string `gorm:"type:text;not null" json:"capabilities"`
}

type MCPConnectionView struct {
	MCPConnection
	VaultIDs []string `json:"vaultIds"`
}

type MCPConnectionCredential struct {
	MCPConnectionView
	Secret string `json:"secret"`
}

func (s *Store) CreateMCPConnection(name, mode string, vaultIDs []string, capabilities string) (MCPConnectionCredential, error) {
	if name == "" || len(vaultIDs) == 0 {
		return MCPConnectionCredential{}, errors.New("connection name and vault grants are required")
	}
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return MCPConnectionCredential{}, err
	}
	secret := base64.RawURLEncoding.EncodeToString(secretBytes)
	digest := sha256.Sum256([]byte(secret))
	id, err := uuid.NewV7()
	if err != nil {
		return MCPConnectionCredential{}, err
	}
	record := MCPConnection{
		ID: id.String(), Name: name, SecretHash: hex.EncodeToString(digest[:]),
		Mode: mode, CreatedAt: time.Now().UTC(),
	}
	vaultSet := make(map[string]struct{}, len(vaultIDs))
	for _, vaultID := range vaultIDs {
		if vaultID == "" {
			return MCPConnectionCredential{}, errors.New("vault ID is required")
		}
		vaultSet[vaultID] = struct{}{}
	}
	vaultIDs = vaultIDs[:0]
	for vaultID := range vaultSet {
		vaultIDs = append(vaultIDs, vaultID)
	}
	sort.Strings(vaultIDs)
	s.writer.Lock()
	defer s.writer.Unlock()
	var knownVaults int64
	if err := s.db.Model(&RecentVault{}).Where("vault_id IN ?", vaultIDs).Count(&knownVaults).Error; err != nil {
		return MCPConnectionCredential{}, err
	}
	if knownVaults != int64(len(vaultIDs)) {
		return MCPConnectionCredential{}, errors.New("every grant must reference a known vault")
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		for _, vaultID := range vaultIDs {
			if err := tx.Create(&MCPVaultGrant{
				ConnectionID: record.ID, VaultID: vaultID, Capabilities: capabilities,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return MCPConnectionCredential{
		MCPConnectionView: MCPConnectionView{MCPConnection: record, VaultIDs: vaultIDs},
		Secret:            secret,
	}, err
}

func (s *Store) MCPConnections() ([]MCPConnectionView, error) {
	var records []MCPConnection
	if err := s.db.Order("created_at DESC").Find(&records).Error; err != nil {
		return nil, err
	}
	result := make([]MCPConnectionView, 0, len(records))
	for _, record := range records {
		var vaultIDs []string
		if err := s.db.Model(&MCPVaultGrant{}).Where("connection_id = ?", record.ID).
			Order("vault_id").Pluck("vault_id", &vaultIDs).Error; err != nil {
			return nil, err
		}
		result = append(result, MCPConnectionView{MCPConnection: record, VaultIDs: vaultIDs})
	}
	return result, nil
}

func (s *Store) AuthenticateMCPConnection(id, secret string) (MCPConnectionView, error) {
	var record MCPConnection
	if err := s.db.Where("id = ? AND revoked_at IS NULL", id).First(&record).Error; err != nil {
		return MCPConnectionView{}, ErrNotFound
	}
	digest := sha256.Sum256([]byte(secret))
	provided := hex.EncodeToString(digest[:])
	if subtle.ConstantTimeCompare([]byte(provided), []byte(record.SecretHash)) != 1 {
		return MCPConnectionView{}, ErrNotFound
	}
	var vaultIDs []string
	if err := s.db.Model(&MCPVaultGrant{}).Where("connection_id = ?", id).
		Order("vault_id").Pluck("vault_id", &vaultIDs).Error; err != nil {
		return MCPConnectionView{}, err
	}
	now := time.Now().UTC()
	_ = s.db.Model(&record).Update("last_used_at", now).Error
	record.LastUsedAt = &now
	return MCPConnectionView{MCPConnection: record, VaultIDs: vaultIDs}, nil
}

func (s *Store) RevokeMCPConnection(id string) error {
	now := time.Now().UTC()
	s.writer.Lock()
	defer s.writer.Unlock()
	result := s.db.Model(&MCPConnection{}).Where("id = ? AND revoked_at IS NULL", id).
		Update("revoked_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
