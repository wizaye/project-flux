package plugins

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrPluginNotFound           = errors.New("plugin not found")
	ErrPluginActive             = errors.New("active plugin version cannot be uninstalled")
	ErrPermissionApprovalNeeded = errors.New("plugin update requires permission approval")
)

type InstallStatus string

const (
	StatusStaged   InstallStatus = "staged"
	StatusActive   InstallStatus = "active"
	StatusPrevious InstallStatus = "previous"
	StatusFailed   InstallStatus = "failed"
	StatusRemoving InstallStatus = "removing"
)

type InstalledPlugin struct {
	PluginID      string        `gorm:"primaryKey" json:"pluginId"`
	Version       string        `gorm:"primaryKey" json:"version"`
	ManifestJSON  string        `gorm:"type:text;not null" json:"-"`
	Checksum      string        `gorm:"not null" json:"checksum"`
	InstallPath   string        `gorm:"not null" json:"-"`
	Development   bool          `gorm:"not null;default:false" json:"development"`
	Status        InstallStatus `gorm:"not null;index" json:"status"`
	InstalledAt   time.Time     `gorm:"not null" json:"installedAt"`
	ActivatedAt   *time.Time    `json:"activatedAt,omitempty"`
	FailureReason string        `gorm:"type:text" json:"failureReason,omitempty"`
}

func (InstalledPlugin) TableName() string { return "plugin_versions" }

type ActivePlugin struct {
	PluginID        string    `gorm:"primaryKey" json:"pluginId"`
	ActiveVersion   string    `gorm:"not null" json:"activeVersion"`
	PreviousVersion string    `gorm:"not null;default:''" json:"previousVersion,omitempty"`
	UpdatedAt       time.Time `gorm:"not null" json:"updatedAt"`
}

func (ActivePlugin) TableName() string { return "active_plugins" }

type VaultPlugin struct {
	VaultID            string    `gorm:"primaryKey" json:"vaultId"`
	PluginID           string    `gorm:"primaryKey" json:"pluginId"`
	Enabled            bool      `gorm:"not null;default:false" json:"enabled"`
	GrantedPermissions string    `gorm:"type:text;not null;default:'[]'" json:"-"`
	UpdatedAt          time.Time `gorm:"not null" json:"updatedAt"`
	FailureCount       int       `gorm:"not null;default:0" json:"failureCount"`
	LastError          string    `gorm:"type:text" json:"lastError,omitempty"`
}

func (VaultPlugin) TableName() string { return "vault_plugins" }

type VaultPluginResponse struct {
	VaultID            string    `json:"vaultId"`
	PluginID           string    `json:"pluginId"`
	Enabled            bool      `json:"enabled"`
	GrantedPermissions []string  `json:"grantedPermissions"`
	UpdatedAt          time.Time `json:"updatedAt"`
	FailureCount       int       `json:"failureCount"`
	LastError          string    `json:"lastError,omitempty"`
}

type MetadataStore struct {
	db     *gorm.DB
	writer sync.Mutex
	ownsDB bool
}

// OpenMetadataStore opens plugin tables in the global app database.
func OpenMetadataStore(databasePath string) (*MetadataStore, error) {
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		return nil, err
	}
	db, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	store, err := NewMetadataStore(db, true)
	if err != nil {
		return nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA journal_mode = WAL",
		"PRAGMA busy_timeout = 3000",
		"PRAGMA wal_autocheckpoint = 1000",
	} {
		if err := db.Exec(pragma).Error; err != nil {
			_ = store.Close()
			return nil, err
		}
	}
	return store, nil
}

// NewMetadataStore attaches plugin tables to an existing global app database.
// Pass ownsConnection=false when another component owns db lifecycle.
func NewMetadataStore(db *gorm.DB, ownsConnection bool) (*MetadataStore, error) {
	if db == nil {
		return nil, errors.New("plugin metadata database is required")
	}
	store := &MetadataStore{db: db, ownsDB: ownsConnection}
	if err := db.AutoMigrate(&InstalledPlugin{}, &ActivePlugin{}, &VaultPlugin{}); err != nil {
		if ownsConnection {
			_ = store.Close()
		}
		return nil, err
	}
	return store, nil
}

func (s *MetadataStore) Stage(plugin InstalledPlugin) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "plugin_id"}, {Name: "version"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"manifest_json", "checksum", "install_path", "development", "status", "installed_at", "failure_reason",
		}),
	}).Create(&plugin).Error
}

func (s *MetadataStore) Version(pluginID, version string) (InstalledPlugin, error) {
	var plugin InstalledPlugin
	if err := s.db.First(&plugin, "plugin_id = ? AND version = ?", pluginID, version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return InstalledPlugin{}, ErrPluginNotFound
		}
		return InstalledPlugin{}, err
	}
	return plugin, nil
}

func (s *MetadataStore) Active(pluginID string) (ActivePlugin, error) {
	var active ActivePlugin
	if err := s.db.First(&active, "plugin_id = ?", pluginID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ActivePlugin{}, ErrPluginNotFound
		}
		return ActivePlugin{}, err
	}
	return active, nil
}

func (s *MetadataStore) ListInstalled() ([]InstalledPlugin, error) {
	var plugins []InstalledPlugin
	err := s.db.Order("plugin_id, installed_at DESC").Find(&plugins).Error
	return plugins, err
}

func (s *MetadataStore) ListActive() ([]ActivePlugin, error) {
	var plugins []ActivePlugin
	err := s.db.Order("plugin_id").Find(&plugins).Error
	return plugins, err
}

func (s *MetadataStore) Activate(pluginID, version string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		var target InstalledPlugin
		if err := tx.First(&target, "plugin_id = ? AND version = ?", pluginID, version).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPluginNotFound
			}
			return err
		}
		if target.Status == StatusRemoving {
			return ErrPluginNotFound
		}
		var targetManifest Manifest
		if err := json.Unmarshal([]byte(target.ManifestJSON), &targetManifest); err != nil {
			return err
		}
		if err := targetManifest.Validate(); err != nil {
			return err
		}
		var enabled []VaultPlugin
		if err := tx.Where("plugin_id = ? AND enabled = ?", pluginID, true).Find(&enabled).Error; err != nil {
			return err
		}
		for _, vaultPlugin := range enabled {
			var granted []string
			if err := json.Unmarshal([]byte(vaultPlugin.GrantedPermissions), &granted); err != nil {
				return err
			}
			grantedSet := make(map[string]struct{}, len(granted))
			for _, permission := range granted {
				grantedSet[permission] = struct{}{}
			}
			for _, required := range targetManifest.RequiredPermissions {
				if _, ok := grantedSet[required]; !ok {
					return fmt.Errorf("%w: vault %s requires %s", ErrPermissionApprovalNeeded, vaultPlugin.VaultID, required)
				}
			}
		}

		var current ActivePlugin
		err := tx.First(&current, "plugin_id = ?", pluginID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil && current.ActiveVersion == version {
			return nil
		}

		previous := ""
		if err == nil {
			previous = current.ActiveVersion
			if update := tx.Model(&InstalledPlugin{}).
				Where("plugin_id = ? AND version = ?", pluginID, previous).
				Updates(map[string]any{"status": StatusPrevious}); update.Error != nil {
				return update.Error
			}
		}
		now := time.Now().UTC()
		if update := tx.Model(&InstalledPlugin{}).
			Where("plugin_id = ? AND version = ?", pluginID, version).
			Updates(map[string]any{"status": StatusActive, "activated_at": now, "failure_reason": ""}); update.Error != nil {
			return update.Error
		}
		active := ActivePlugin{PluginID: pluginID, ActiveVersion: version, PreviousVersion: previous, UpdatedAt: now}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "plugin_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"active_version", "previous_version", "updated_at"}),
		}).Create(&active).Error
	})
}

func (s *MetadataStore) MarkFailed(pluginID, version, reason string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	result := s.db.Model(&InstalledPlugin{}).
		Where("plugin_id = ? AND version = ?", pluginID, version).
		Updates(map[string]any{"status": StatusFailed, "failure_reason": reason})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrPluginNotFound
	}
	return nil
}

func (s *MetadataStore) Rollback(pluginID string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		var active ActivePlugin
		if err := tx.First(&active, "plugin_id = ?", pluginID).Error; err != nil {
			return ErrPluginNotFound
		}
		if active.PreviousVersion == "" {
			return errors.New("plugin has no previous version")
		}
		var previous InstalledPlugin
		if err := tx.First(&previous, "plugin_id = ? AND version = ?", pluginID, active.PreviousVersion).Error; err != nil {
			return ErrPluginNotFound
		}
		now := time.Now().UTC()
		if err := tx.Model(&InstalledPlugin{}).Where("plugin_id = ? AND version = ?", pluginID, active.ActiveVersion).
			Update("status", StatusPrevious).Error; err != nil {
			return err
		}
		if err := tx.Model(&InstalledPlugin{}).Where("plugin_id = ? AND version = ?", pluginID, active.PreviousVersion).
			Updates(map[string]any{"status": StatusActive, "activated_at": now, "failure_reason": ""}).Error; err != nil {
			return err
		}
		return tx.Model(&active).Updates(map[string]any{
			"active_version": active.PreviousVersion, "previous_version": active.ActiveVersion, "updated_at": now,
		}).Error
	})
}

func (s *MetadataStore) BeginUninstall(pluginID, version string) (InstallStatus, error) {
	s.writer.Lock()
	defer s.writer.Unlock()
	var plugin InstalledPlugin
	if err := s.db.First(&plugin, "plugin_id = ? AND version = ?", pluginID, version).Error; err != nil {
		return "", ErrPluginNotFound
	}
	var active int64
	if err := s.db.Model(&ActivePlugin{}).Where("plugin_id = ? AND active_version = ?", pluginID, version).Count(&active).Error; err != nil {
		return "", err
	}
	if active != 0 {
		return "", ErrPluginActive
	}
	oldStatus := plugin.Status
	if err := s.db.Model(&plugin).Update("status", StatusRemoving).Error; err != nil {
		return "", err
	}
	return oldStatus, nil
}

func (s *MetadataStore) RestoreStatus(pluginID, version string, status InstallStatus) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Model(&InstalledPlugin{}).Where("plugin_id = ? AND version = ?", pluginID, version).Update("status", status).Error
}

func (s *MetadataStore) DeleteVersion(pluginID, version string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&InstalledPlugin{}, "plugin_id = ? AND version = ?", pluginID, version).Error; err != nil {
			return err
		}
		return tx.Model(&ActivePlugin{}).Where("plugin_id = ? AND previous_version = ?", pluginID, version).Update("previous_version", "").Error
	})
}

func (s *MetadataStore) DeletePlugin(pluginID string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&ActivePlugin{}, "plugin_id = ?", pluginID).Error; err != nil {
			return err
		}
		if err := tx.Delete(&VaultPlugin{}, "plugin_id = ?", pluginID).Error; err != nil {
			return err
		}
		return tx.Delete(&InstalledPlugin{}, "plugin_id = ?", pluginID).Error
	})
}

func (s *MetadataStore) EnableVaultPlugin(vaultID, pluginID string, granted []string) error {
	if vaultID == "" || !pluginIDPattern.MatchString(pluginID) {
		return errors.New("vault ID and valid plugin ID are required")
	}
	grantedSet, err := validateCapabilities(granted)
	if err != nil {
		return err
	}
	sorted := append([]string(nil), granted...)
	sort.Strings(sorted)
	permissionsJSON, err := json.Marshal(sorted)
	if err != nil {
		return err
	}

	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		var active ActivePlugin
		if err := tx.First(&active, "plugin_id = ?", pluginID).Error; err != nil {
			return ErrPluginNotFound
		}
		var installed InstalledPlugin
		if err := tx.First(&installed, "plugin_id = ? AND version = ?", pluginID, active.ActiveVersion).Error; err != nil {
			return ErrPluginNotFound
		}
		var manifest Manifest
		if err := json.Unmarshal([]byte(installed.ManifestJSON), &manifest); err != nil {
			return err
		}
		if err := manifest.Validate(); err != nil {
			return err
		}
		allowed := make(map[string]struct{}, len(manifest.RequiredPermissions)+len(manifest.OptionalPermissions))
		for _, permission := range manifest.RequiredPermissions {
			allowed[permission] = struct{}{}
			if _, ok := grantedSet[permission]; !ok {
				return fmt.Errorf("required permission %q was not granted", permission)
			}
		}
		for _, permission := range manifest.OptionalPermissions {
			allowed[permission] = struct{}{}
		}
		for permission := range grantedSet {
			if _, ok := allowed[permission]; !ok {
				return fmt.Errorf("permission %q is not declared by plugin", permission)
			}
		}
		now := time.Now().UTC()
		record := VaultPlugin{
			VaultID: vaultID, PluginID: pluginID, Enabled: true,
			GrantedPermissions: string(permissionsJSON), UpdatedAt: now,
		}
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "vault_id"}, {Name: "plugin_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"enabled": true, "granted_permissions": string(permissionsJSON), "updated_at": now,
				"failure_count": 0, "last_error": "",
			}),
		}).Create(&record).Error
	})
}

// ApproveVaultPluginUpdate grants permissions declared by a staged version
// before Activate switches the global active pointer.
func (s *MetadataStore) ApproveVaultPluginUpdate(vaultID, pluginID, version string, granted []string) error {
	if vaultID == "" || !pluginIDPattern.MatchString(pluginID) || !versionPattern.MatchString(version) {
		return errors.New("vault ID, plugin ID, and version are required")
	}
	grantedSet, err := validateCapabilities(granted)
	if err != nil {
		return err
	}
	sorted := append([]string(nil), granted...)
	sort.Strings(sorted)
	permissionsJSON, err := json.Marshal(sorted)
	if err != nil {
		return err
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		var installed InstalledPlugin
		if err := tx.First(&installed, "plugin_id = ? AND version = ?", pluginID, version).Error; err != nil {
			return ErrPluginNotFound
		}
		var manifest Manifest
		if err := json.Unmarshal([]byte(installed.ManifestJSON), &manifest); err != nil {
			return err
		}
		if err := validateGrantSet(manifest, grantedSet); err != nil {
			return err
		}
		result := tx.Model(&VaultPlugin{}).
			Where("vault_id = ? AND plugin_id = ? AND enabled = ?", vaultID, pluginID, true).
			Updates(map[string]any{"granted_permissions": string(permissionsJSON), "updated_at": time.Now().UTC()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrPluginNotFound
		}
		return nil
	})
}

func (s *MetadataStore) DisableVaultPlugin(vaultID, pluginID string) error {
	if vaultID == "" || !pluginIDPattern.MatchString(pluginID) {
		return errors.New("vault ID and valid plugin ID are required")
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	now := time.Now().UTC()
	record := VaultPlugin{VaultID: vaultID, PluginID: pluginID, GrantedPermissions: "[]", UpdatedAt: now}
	return s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "vault_id"}, {Name: "plugin_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"enabled": false, "updated_at": now, "failure_count": 0, "last_error": "",
		}),
	}).Create(&record).Error
}

func (s *MetadataStore) ListForVault(vaultID string) ([]VaultPluginResponse, error) {
	var records []VaultPlugin
	if err := s.db.Where("vault_id = ?", vaultID).Order("plugin_id").Find(&records).Error; err != nil {
		return nil, err
	}
	result := make([]VaultPluginResponse, 0, len(records))
	for _, record := range records {
		var granted []string
		if err := json.Unmarshal([]byte(record.GrantedPermissions), &granted); err != nil {
			return nil, err
		}
		result = append(result, VaultPluginResponse{
			VaultID: record.VaultID, PluginID: record.PluginID, Enabled: record.Enabled,
			GrantedPermissions: granted, UpdatedAt: record.UpdatedAt,
			FailureCount: record.FailureCount, LastError: record.LastError,
		})
	}
	return result, nil
}

func (s *MetadataStore) RecordVaultFailure(vaultID, pluginID, message string, disableAfter int) error {
	if disableAfter < 1 {
		return errors.New("disable threshold must be positive")
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		var record VaultPlugin
		if err := tx.First(&record, "vault_id = ? AND plugin_id = ?", vaultID, pluginID).Error; err != nil {
			return ErrPluginNotFound
		}
		record.FailureCount++
		record.LastError = message
		record.UpdatedAt = time.Now().UTC()
		if record.FailureCount >= disableAfter {
			record.Enabled = false
		}
		return tx.Save(&record).Error
	})
}

func validateGrantSet(manifest Manifest, granted map[string]struct{}) error {
	if err := manifest.Validate(); err != nil {
		return err
	}
	allowed := make(map[string]struct{}, len(manifest.RequiredPermissions)+len(manifest.OptionalPermissions))
	for _, permission := range manifest.RequiredPermissions {
		allowed[permission] = struct{}{}
		if _, ok := granted[permission]; !ok {
			return fmt.Errorf("required permission %q was not granted", permission)
		}
	}
	for _, permission := range manifest.OptionalPermissions {
		allowed[permission] = struct{}{}
	}
	for permission := range granted {
		if _, ok := allowed[permission]; !ok {
			return fmt.Errorf("permission %q is not declared by plugin", permission)
		}
	}
	return nil
}

func (s *MetadataStore) Close() error {
	s.writer.Lock()
	defer s.writer.Unlock()
	if !s.ownsDB {
		return nil
	}
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
