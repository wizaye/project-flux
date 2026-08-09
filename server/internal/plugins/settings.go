package plugins

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const maxPluginSettingsBytes = 1 << 20

func (m *Manager) ReadSettings(vaultRoot, pluginID string) (map[string]any, error) {
	manifest, err := m.activeManifest(pluginID)
	if err != nil {
		return nil, err
	}
	values := settingDefaults(manifest)
	paths, err := PathsForVault(vaultRoot, pluginID)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(paths.State, "settings.json"))
	if errors.Is(err, os.ErrNotExist) {
		return values, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) > maxPluginSettingsBytes {
		return nil, errors.New("plugin settings exceed 1 MiB")
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		return nil, fmt.Errorf("decode plugin settings: %w", err)
	}
	if err := validateSettings(manifest, stored); err != nil {
		return nil, err
	}
	for key, value := range stored {
		values[key] = value
	}
	return values, nil
}

func (m *Manager) WriteSettings(vaultRoot, pluginID string, values map[string]any) error {
	manifest, err := m.activeManifest(pluginID)
	if err != nil {
		return err
	}
	if err := validateSettings(manifest, values); err != nil {
		return err
	}
	data, err := json.Marshal(values)
	if err != nil {
		return err
	}
	if len(data) > maxPluginSettingsBytes {
		return errors.New("plugin settings exceed 1 MiB")
	}
	paths, err := EnsureVaultPaths(vaultRoot, pluginID)
	if err != nil {
		return err
	}
	target := filepath.Join(paths.State, "settings.json")
	temporary, err := os.CreateTemp(paths.State, ".settings-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, target)
}

func (m *Manager) activeManifest(pluginID string) (Manifest, error) {
	active, err := m.store.Active(pluginID)
	if err != nil {
		return Manifest{}, err
	}
	_, manifest, err := m.load(pluginID, active.ActiveVersion)
	return manifest, err
}

func settingDefaults(manifest Manifest) map[string]any {
	values := make(map[string]any)
	for _, setting := range manifest.Contributions.Settings {
		if len(setting.Default) == 0 {
			continue
		}
		var value any
		if json.Unmarshal(setting.Default, &value) == nil {
			values[setting.ID] = value
		}
	}
	return values
}

func validateSettings(manifest Manifest, values map[string]any) error {
	definitions := make(map[string]SettingContribution, len(manifest.Contributions.Settings))
	for _, setting := range manifest.Contributions.Settings {
		definitions[setting.ID] = setting
	}
	for key, value := range values {
		setting, ok := definitions[key]
		if !ok {
			return fmt.Errorf("plugin setting %q is not declared", key)
		}
		valid := false
		switch setting.Type {
		case "string":
			_, valid = value.(string)
		case "number":
			_, valid = value.(float64)
			if !valid {
				_, valid = value.(int)
			}
		case "boolean":
			_, valid = value.(bool)
		}
		if !valid {
			return fmt.Errorf("plugin setting %q must be %s", key, setting.Type)
		}
	}
	return nil
}
