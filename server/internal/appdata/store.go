package appdata

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrNotFound = errors.New("app data not found")

type RecentVault struct {
	VaultID      string    `gorm:"primaryKey" json:"vaultId"`
	Path         string    `gorm:"not null" json:"path"`
	DisplayName  string    `gorm:"not null" json:"displayName"`
	LastOpenedAt time.Time `gorm:"not null;index" json:"lastOpenedAt"`
}

type WorkspaceSession struct {
	WindowID  string    `gorm:"primaryKey" json:"windowId"`
	VaultID   string    `gorm:"primaryKey" json:"vaultId"`
	StateJSON string    `gorm:"type:text;not null" json:"-"`
	UpdatedAt time.Time `gorm:"not null" json:"updatedAt"`
}

type AppSetting struct {
	Key       string    `gorm:"primaryKey" json:"key"`
	ValueJSON string    `gorm:"type:text;not null" json:"-"`
	UpdatedAt time.Time `gorm:"not null" json:"updatedAt"`
}

type Bootstrap struct {
	RecentVaults []RecentVault      `json:"recentVaults"`
	Workspace    *WorkspaceResponse `json:"workspace"`
	Settings     map[string]any     `json:"settings"`
}

type WorkspaceResponse struct {
	WindowID  string          `json:"windowId"`
	VaultID   string          `json:"vaultId"`
	State     json.RawMessage `json:"state"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type Store struct {
	db     *gorm.DB
	writer sync.Mutex
}

// Database lets feature tables share the one global app-data connection.
func (s *Store) Database() *gorm.DB { return s.db }

func Open(databasePath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		return nil, err
	}
	db, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	store := &Store{db: db}
	if err := os.Chmod(databasePath, 0o600); err != nil {
		_ = store.Close()
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
	if err := db.AutoMigrate(
		&RecentVault{},
		&WorkspaceSession{},
		&AppSetting{},
		&MCPConnection{},
		&MCPVaultGrant{},
	); err != nil {
		_ = store.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) RememberVault(vaultID, path, displayName string) error {
	if vaultID == "" || path == "" {
		return errors.New("vault ID and path are required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	record := RecentVault{
		VaultID:      vaultID,
		Path:         filepath.Clean(absolute),
		DisplayName:  displayName,
		LastOpenedAt: time.Now().UTC(),
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "vault_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"path", "display_name", "last_opened_at"}),
	}).Create(&record).Error
}

func (s *Store) RecentVaults() ([]RecentVault, error) {
	var records []RecentVault
	err := s.db.Order("last_opened_at DESC").Find(&records).Error
	return records, err
}

func (s *Store) ForgetVault(vaultID string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Delete(&RecentVault{}, "vault_id = ?", vaultID).Error
}

func (s *Store) SaveWorkspace(windowID, vaultID string, state json.RawMessage) error {
	if windowID == "" || vaultID == "" || !json.Valid(state) {
		return errors.New("window ID, vault ID, and valid state are required")
	}
	record := WorkspaceSession{
		WindowID:  windowID,
		VaultID:   vaultID,
		StateJSON: string(state),
		UpdatedAt: time.Now().UTC(),
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "window_id"}, {Name: "vault_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"vault_id", "state_json", "updated_at"}),
	}).Create(&record).Error
}

func (s *Store) Workspace(windowID, vaultID string) (*WorkspaceResponse, error) {
	if windowID == "" {
		return nil, ErrNotFound
	}
	var record WorkspaceSession
	query := s.db.Where("window_id = ?", windowID)
	if vaultID != "" {
		query = query.Where("vault_id = ?", vaultID)
	}
	if err := query.Order("updated_at DESC").First(&record).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &WorkspaceResponse{
		WindowID:  record.WindowID,
		VaultID:   record.VaultID,
		State:     json.RawMessage(record.StateJSON),
		UpdatedAt: record.UpdatedAt,
	}, nil
}

func (s *Store) PutSetting(key string, value json.RawMessage) error {
	if key == "" || !json.Valid(value) {
		return errors.New("setting key and valid value are required")
	}
	record := AppSetting{Key: key, ValueJSON: string(value), UpdatedAt: time.Now().UTC()}
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value_json", "updated_at"}),
	}).Create(&record).Error
}

func (s *Store) Settings() (map[string]any, error) {
	var records []AppSetting
	if err := s.db.Order("key").Find(&records).Error; err != nil {
		return nil, err
	}
	settings := make(map[string]any, len(records))
	for _, record := range records {
		var value any
		if err := json.Unmarshal([]byte(record.ValueJSON), &value); err != nil {
			return nil, err
		}
		settings[record.Key] = value
	}
	return settings, nil
}

func (s *Store) Bootstrap(windowID string) (Bootstrap, error) {
	recent, err := s.RecentVaults()
	if err != nil {
		return Bootstrap{}, err
	}
	settings, err := s.Settings()
	if err != nil {
		return Bootstrap{}, err
	}
	var workspace *WorkspaceResponse
	if windowID != "" {
		workspace, err = s.Workspace(windowID, "")
		if err != nil && !errors.Is(err, ErrNotFound) {
			return Bootstrap{}, err
		}
	}
	return Bootstrap{RecentVaults: recent, Workspace: workspace, Settings: settings}, nil
}

func (s *Store) Close() error {
	s.writer.Lock()
	defer s.writer.Unlock()
	_ = s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)").Error
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
