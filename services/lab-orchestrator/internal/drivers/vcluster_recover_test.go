package drivers

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// scriptedHelm answers helm commands by their first argument.
type scriptedHelm struct {
	status   string // helm status -o json output; "" = release not found
	history  string // helm history -o json output
	install  error
	commands []string
}

func (h *scriptedHelm) Helm(_ context.Context, args ...string) ([]byte, error) {
	h.commands = append(h.commands, strings.Join(args, " "))
	switch args[0] {
	case "upgrade":
		return nil, h.install
	case "status":
		if h.status == "" {
			return nil, errors.New("Error: release: not found")
		}
		return []byte(h.status), nil
	case "history":
		return []byte(h.history), nil
	}
	return nil, nil
}

func (h *scriptedHelm) ran(prefix string) bool {
	for _, c := range h.commands {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

func statusJSON(status string, deployed time.Time) string {
	return fmt.Sprintf(`{"name":"vc","info":{"status":%q,"last_deployed":%q}}`, status, deployed.Format(time.RFC3339Nano))
}

// A release an interrupted install left in pending-install is uninstalled,
// so the next install succeeds instead of failing until the provision
// timeout; a release that may still be installing, or in any other state,
// is left alone.
func TestHelmInstallRecoversPendingInstall(t *testing.T) {
	stuck := errors.New("helm upgrade --install: exit status 1: Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress")
	args := []string{"upgrade", "--install", "vc", "chart", "--namespace", "ct-vc-x"}
	cases := []struct {
		name          string
		status        string
		wantUninstall bool
	}{
		{"stuck pending-install", statusJSON("pending-install", time.Now().Add(-10*time.Minute)), true},
		{"pending-install just started", statusJSON("pending-install", time.Now()), false},
		{"deployed", statusJSON("deployed", time.Now().Add(-time.Hour)), false},
		{"pending-upgrade", statusJSON("pending-upgrade", time.Now().Add(-time.Hour)), false}, // rolled back instead
		{"no release", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &scriptedHelm{status: tc.status, install: stuck}
			err := helmInstall(context.Background(), h, "vc", "ct-vc-x", args)
			if !errors.Is(err, stuck) {
				t.Fatalf("err = %v, want the install error", err)
			}
			if got := h.ran("uninstall vc --namespace ct-vc-x"); got != tc.wantUninstall {
				t.Errorf("uninstalled = %v, want %v (commands %v)", got, tc.wantUninstall, h.commands)
			}
		})
	}
	h := &scriptedHelm{}
	if err := helmInstall(context.Background(), h, "vc", "ct-vc-x", args); err != nil || h.ran("status") {
		t.Errorf("successful install: err %v, commands %v", err, h.commands)
	}
}

// A reinstall over an existing release that was interrupted leaves it in
// pending-upgrade or pending-rollback: it is rolled back to its last
// deployed revision once the grace period is over.
func TestHelmInstallRollsBackPendingUpgrade(t *testing.T) {
	stuck := errors.New("helm upgrade --install: exit status 1: Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress")
	args := []string{"upgrade", "--install", "vc", "chart", "--namespace", "ct-vc-x"}
	history := `[{"revision":1,"status":"superseded"},{"revision":2,"status":"deployed"},{"revision":3,"status":"pending-upgrade"}]`
	cases := []struct {
		name, status, history, wantRollback string
	}{
		{"stuck pending-upgrade", statusJSON("pending-upgrade", time.Now().Add(-10*time.Minute)), history, "rollback vc 2 --namespace ct-vc-x --no-hooks"},
		{"stuck pending-rollback, none deployed", statusJSON("pending-rollback", time.Now().Add(-10*time.Minute)), `[{"revision":1,"status":"superseded"},{"revision":2,"status":"failed"},{"revision":3,"status":"pending-rollback"}]`, "rollback vc 1 --namespace ct-vc-x --no-hooks"},
		{"pending-upgrade just started", statusJSON("pending-upgrade", time.Now()), history, ""},
		{"no revision to roll back to", statusJSON("pending-upgrade", time.Now().Add(-10*time.Minute)), `[{"revision":1,"status":"pending-upgrade"}]`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &scriptedHelm{status: tc.status, history: tc.history, install: stuck}
			err := helmInstall(context.Background(), h, "vc", "ct-vc-x", args)
			if !errors.Is(err, stuck) {
				t.Fatalf("err = %v, want the install error", err)
			}
			if h.ran("uninstall") {
				t.Errorf("an existing release was uninstalled: %v", h.commands)
			}
			if tc.wantRollback == "" {
				if h.ran("rollback") {
					t.Errorf("rolled back: %v", h.commands)
				}
				return
			}
			if !h.ran(tc.wantRollback) {
				t.Errorf("commands %v, want %q", h.commands, tc.wantRollback)
			}
		})
	}
}
