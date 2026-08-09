package runtimecoord

import "errors"

var ErrLocked = errors.New("runtime is already owned by another process")
