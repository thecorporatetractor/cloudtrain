package drivers

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// helmPendingGrace: a release stuck in a pending-* status for longer than
// this was left behind by an interrupted helm process (the manager killed
// mid-install); a running install of ours finishes in seconds (no --wait).
var helmPendingGrace = 2 * time.Minute

// recoverPendingRelease is called after `helm upgrade --install` failed for a
// release whose control plane does not exist yet. An install interrupted at
// the wrong moment leaves the release in pending-install, and every later
// install fails ("another operation is in progress") until the provision
// timeout. Such a release is uninstalled, so the next reconcile installs it
// again. A reinstall over an existing release that was interrupted leaves
// pending-upgrade (or pending-rollback): that release is rolled back to its
// last deployed revision instead. It reports whether it recovered anything.
func recoverPendingRelease(ctx context.Context, h HelmRunner, release, namespace string, now time.Time) (bool, error) {
	out, err := h.Helm(ctx, "status", release, "--namespace", namespace, "-o", "json")
	if err != nil {
		return false, nil //nolint:nilerr // no release (or helm down): nothing to recover, the install error stands
	}
	var st struct {
		Info struct {
			Status       string    `json:"status"`
			LastDeployed time.Time `json:"last_deployed"`
		} `json:"info"`
	}
	if err := json.Unmarshal(out, &st); err != nil {
		return false, nil //nolint:nilerr // unexpected output: leave the release alone
	}
	switch st.Info.Status {
	case "pending-install", "pending-upgrade", "pending-rollback":
	default:
		return false, nil
	}
	if !st.Info.LastDeployed.IsZero() && now.Sub(st.Info.LastDeployed) < helmPendingGrace {
		return false, nil // possibly still running
	}
	if st.Info.Status != "pending-install" {
		return rollbackRelease(ctx, h, release, namespace, st.Info.Status)
	}
	if _, err := h.Helm(ctx, "uninstall", release, "--namespace", namespace, "--no-hooks"); err != nil {
		return false, fmt.Errorf("uninstall release %s stuck in %s: %w", release, st.Info.Status, err)
	}
	return true, nil
}

// rollbackRelease rolls a release stuck in pending-upgrade or pending-rollback
// back to its last deployed revision (the newest deployed one, else the
// newest superseded one); with none, the release is left alone.
func rollbackRelease(ctx context.Context, h HelmRunner, release, namespace, status string) (bool, error) {
	out, err := h.Helm(ctx, "history", release, "--namespace", namespace, "-o", "json")
	if err != nil {
		return false, fmt.Errorf("history of release %s stuck in %s: %w", release, status, err)
	}
	var revs []struct {
		Revision int    `json:"revision"`
		Status   string `json:"status"`
	}
	if err := json.Unmarshal(out, &revs); err != nil {
		return false, nil //nolint:nilerr // unexpected output: leave the release alone
	}
	target := 0
	for _, want := range []string{"deployed", "superseded"} {
		for _, r := range revs {
			if r.Status == want && r.Revision > target {
				target = r.Revision
			}
		}
		if target > 0 {
			break
		}
	}
	if target == 0 {
		return false, nil
	}
	if _, err := h.Helm(ctx, "rollback", release, strconv.Itoa(target), "--namespace", namespace, "--no-hooks"); err != nil {
		return false, fmt.Errorf("roll back release %s stuck in %s: %w", release, status, err)
	}
	return true, nil
}

// helmInstall runs `helm upgrade --install` and, when it fails, clears a
// release an interrupted install, upgrade or rollback left pending.
func helmInstall(ctx context.Context, h HelmRunner, release, namespace string, args []string) error {
	_, err := h.Helm(ctx, args...)
	if err == nil {
		return nil
	}
	recovered, rerr := recoverPendingRelease(ctx, h, release, namespace, time.Now())
	switch {
	case rerr != nil:
		return fmt.Errorf("%w; %v", err, rerr)
	case recovered:
		return fmt.Errorf("%w; release %s was stuck in a pending operation and was recovered (uninstalled, or rolled back to its last deployed revision): it is installed again on the next attempt", err, release)
	}
	return err
}
