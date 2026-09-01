package agent

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type threadRecord struct {
	ID                string `gorm:"primaryKey"`
	VaultID           string `gorm:"not null;index"`
	Title             string
	ConfigurationJSON string `gorm:"type:text;not null"`
	Status            string `gorm:"not null;index"`
	ActiveTurnID      string
	ProviderSessionID string
	CreatedAt         time.Time `gorm:"not null"`
	UpdatedAt         time.Time `gorm:"not null"`
}

func (threadRecord) TableName() string { return "agent_threads" }

type eventRecord struct {
	EventID     string    `gorm:"primaryKey"`
	ThreadID    string    `gorm:"not null;uniqueIndex:agent_event_sequence;index"`
	Sequence    int64     `gorm:"not null;uniqueIndex:agent_event_sequence"`
	TurnID      string    `gorm:"index"`
	Type        string    `gorm:"not null;index"`
	PayloadJSON string    `gorm:"type:text;not null"`
	CreatedAt   time.Time `gorm:"not null"`
}

func (eventRecord) TableName() string { return "agent_events" }

type Store struct {
	db     *gorm.DB
	writer sync.Mutex
}

func NewStore(db *gorm.DB) (*Store, error) {
	store := &Store{db: db}
	if err := db.AutoMigrate(&threadRecord{}, &eventRecord{}); err != nil {
		return nil, err
	}
	// A process restart cannot resume an in-memory provider session.
	if err := db.Model(&threadRecord{}).
		Where("status IN ?", []string{"running", "waiting"}).
		Updates(map[string]any{"status": "error", "active_turn_id": "", "updated_at": time.Now().UTC()}).Error; err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) CreateThread(thread Thread) error {
	configuration, err := json.Marshal(thread.Configuration)
	if err != nil {
		return err
	}
	record := threadRecord{
		ID: thread.ID, VaultID: thread.VaultID, Title: thread.Title,
		ConfigurationJSON: string(configuration), Status: thread.Status,
		ActiveTurnID: thread.ActiveTurnID, ProviderSessionID: thread.ProviderSessionID,
		CreatedAt: thread.CreatedAt, UpdatedAt: thread.UpdatedAt,
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Create(&record).Error
}

func (s *Store) Thread(id string) (Thread, error) {
	var record threadRecord
	if err := s.db.First(&record, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return Thread{}, ErrNotFound
		}
		return Thread{}, err
	}
	return decodeThread(record)
}

func (s *Store) Threads(vaultID string) ([]Thread, error) {
	var records []threadRecord
	if err := s.db.Where("vault_id = ?", vaultID).Order("updated_at DESC").Find(&records).Error; err != nil {
		return nil, err
	}
	threads := make([]Thread, 0, len(records))
	for _, record := range records {
		thread, err := decodeThread(record)
		if err != nil {
			return nil, err
		}
		threads = append(threads, thread)
	}
	return threads, nil
}

func (s *Store) UpdateThread(thread Thread) error {
	configuration, err := json.Marshal(thread.Configuration)
	if err != nil {
		return err
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	result := s.db.Model(&threadRecord{}).Where("id = ?", thread.ID).Updates(map[string]any{
		"title": thread.Title, "status": thread.Status, "configuration_json": string(configuration),
		"active_turn_id": thread.ActiveTurnID, "provider_session_id": thread.ProviderSessionID,
		"updated_at": thread.UpdatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteThread(id string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&eventRecord{}, "thread_id = ?", id).Error; err != nil {
			return err
		}
		result := tx.Delete(&threadRecord{}, "id = ?", id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		return nil
	})
}

func (s *Store) AppendEvent(threadID, turnID, eventType string, payload any) (Event, error) {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return Event{}, err
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	var sequence int64
	if err := s.db.Model(&eventRecord{}).Where("thread_id = ?", threadID).
		Select("COALESCE(MAX(sequence), 0)").Scan(&sequence).Error; err != nil {
		return Event{}, err
	}
	sequence++
	record := eventRecord{
		EventID: uuid.NewString(), ThreadID: threadID, Sequence: sequence,
		TurnID: turnID, Type: eventType, PayloadJSON: string(payloadJSON), CreatedAt: time.Now().UTC(),
	}
	if err := s.db.Create(&record).Error; err != nil {
		return Event{}, err
	}
	return decodeEvent(record), nil
}

func (s *Store) EventsAfter(threadID string, sequence int64) ([]Event, error) {
	var records []eventRecord
	if err := s.db.Where("thread_id = ? AND sequence > ?", threadID, sequence).
		Order("sequence ASC").Find(&records).Error; err != nil {
		return nil, err
	}
	events := make([]Event, 0, len(records))
	for _, record := range records {
		events = append(events, decodeEvent(record))
	}
	return events, nil
}

func decodeThread(record threadRecord) (Thread, error) {
	var configuration Configuration
	if err := json.Unmarshal([]byte(record.ConfigurationJSON), &configuration); err != nil {
		return Thread{}, err
	}
	return Thread{
		ID: record.ID, VaultID: record.VaultID, Title: record.Title, Configuration: configuration,
		Status: record.Status, ActiveTurnID: record.ActiveTurnID,
		ProviderSessionID: record.ProviderSessionID,
		CreatedAt:         record.CreatedAt, UpdatedAt: record.UpdatedAt,
	}, nil
}

func decodeEvent(record eventRecord) Event {
	return Event{
		EventID: record.EventID, Sequence: record.Sequence, ThreadID: record.ThreadID,
		TurnID: record.TurnID, Type: record.Type, Payload: json.RawMessage(record.PayloadJSON),
		CreatedAt: record.CreatedAt,
	}
}
