package runtimecoord

import (
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
)

type Descriptor struct {
	PID      int    `json:"pid"`
	Origin   string `json:"origin"`
	Token    string `json:"token"`
	Version  string `json:"version"`
	Protocol int    `json:"protocol"`
}

func ReadDescriptor(path string) (Descriptor, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Descriptor{}, err
	}
	var descriptor Descriptor
	if err := json.Unmarshal(content, &descriptor); err != nil {
		return Descriptor{}, err
	}
	if err := descriptor.Validate(); err != nil {
		return Descriptor{}, err
	}
	return descriptor, nil
}

func WriteDescriptor(path string, descriptor Descriptor) error {
	if err := descriptor.Validate(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	content, err := json.Marshal(descriptor)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".runtime-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(content, '\n')); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func (d Descriptor) Validate() error {
	parsed, err := url.Parse(d.Origin)
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" || d.Token == "" || d.PID <= 0 || d.Protocol <= 0 {
		return errors.New("invalid runtime descriptor")
	}
	host, _, err := net.SplitHostPort(parsed.Host)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return errors.New("runtime origin must use a loopback IP")
	}
	return nil
}
