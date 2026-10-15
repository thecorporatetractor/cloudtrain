package drivers

import (
	"errors"
	"fmt"
	"testing"

	"k8s.io/streaming/pkg/httpstream"
)

// The WebSocket executor in client-go reports a failed upgrade with
// k8s.io/streaming's UpgradeFailureError; exec must fall back to SPDY on it.
func TestShouldFallbackToSPDY(t *testing.T) {
	upgrade := fmt.Errorf("exec: %w", &httpstream.UpgradeFailureError{Cause: errors.New("bad handshake")})
	if !shouldFallbackToSPDY(upgrade) {
		t.Fatal("wrapped streaming UpgradeFailureError should fall back to SPDY")
	}
	if !shouldFallbackToSPDY(errors.New("proxy: unknown scheme: https")) {
		t.Fatal("HTTPS proxy dial error should fall back to SPDY")
	}
	if shouldFallbackToSPDY(errors.New("command terminated with exit code 1")) || shouldFallbackToSPDY(nil) {
		t.Fatal("ordinary exec errors must not fall back")
	}
}
