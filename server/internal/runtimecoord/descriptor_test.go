package runtimecoord

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestDescriptorRoundTripAndLockExclusion(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "runtime.json")
	want := Descriptor{PID: 42, Origin: "http://127.0.0.1:1234", Token: "secret", Version: "test", Protocol: 1}
	if err := WriteDescriptor(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := ReadDescriptor(path)
	if err != nil || got != want {
		t.Fatalf("descriptor mismatch: got %#v, err %v", got, err)
	}

	lockPath := filepath.Join(directory, "runtime.lock")
	first, err := Acquire(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if _, err := Acquire(lockPath); !errors.Is(err, ErrLocked) {
		t.Fatalf("second owner should fail with ErrLocked, got %v", err)
	}
}
