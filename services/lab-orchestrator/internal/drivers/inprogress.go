package drivers

import (
	"errors"
	"fmt"
)

// ErrInProgress means an operation was started but has not finished yet
// (e.g. VMs still terminating during Destroy). It is not a failure: callers
// requeue shortly instead of backing off.
var ErrInProgress = errors.New("in progress")

// inProgress returns an ErrInProgress with a reason.
func inProgress(format string, args ...any) error {
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), ErrInProgress)
}
