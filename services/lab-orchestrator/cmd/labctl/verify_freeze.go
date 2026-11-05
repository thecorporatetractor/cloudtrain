package main

// labctl verify --freeze: after the solution (or an alternative) is applied,
// freeze the session the way an exam does when time is up (spec.accessRevoked:
// endpoints withdrawn, the learner's processes ended, controller.RevokeScript),
// and only then grade. A lab whose correct solution depends on a process the
// freeze ends (a foreground loop, a daemon started from the learner's shell)
// then fails verification instead of failing candidates in an exam (#394).

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/api/meta"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/exam"
)

// Freeze modes (--freeze).
const (
	freezeOff      = "off"
	freezeExamPool = "exam-pool"
	freezeAll      = "all"
)

// FreezeReport is the exam freeze of one run (--freeze).
type FreezeReport struct {
	// ConfirmedSec is how long the controller took to confirm the freeze
	// (condition AccessRevoked).
	ConfirmedSec float64 `json:"confirmedSeconds"`
	// StillRunning is what the freeze reported (status.stillRunningAfterRevoke):
	// in an exam each entry holds the attempt for review.
	StillRunning []string `json:"stillRunning,omitempty"`
}

// parseFreezeMode validates --freeze.
func parseFreezeMode(s string) (string, error) {
	switch s {
	case "", freezeOff:
		return freezeOff, nil
	case freezeExamPool, freezeAll:
		return s, nil
	}
	return "", fmt.Errorf("--freeze must be %s, %s or %s, not %q", freezeOff, freezeExamPool, freezeAll, s)
}

// examPoolLabs returns the ids of every lab in the pool of an exam in the
// curriculum file.
func examPoolLabs(path string) (map[string]bool, error) {
	defs, _, err := exam.LoadFile(path)
	if err != nil && len(defs) == 0 {
		return nil, err
	}
	pool := map[string]bool{}
	for _, d := range defs {
		for _, o := range d.Blueprint {
			for _, id := range o.Pool {
				pool[id] = true
			}
		}
	}
	return pool, nil
}

// freezes reports whether a run freezes the session before grading: base
// and alternative runs (a correct solution must survive the freeze) of the
// labs the mode selects. Mutation runs are graded unfrozen: they must fail
// anyway, and the freeze could only make them fail for the wrong reason.
func (o *verifyOpts) freezes(r runSpec) bool {
	if r.kind != runBase && r.kind != runAlternative {
		return false
	}
	switch o.freeze {
	case freezeAll:
		return true
	case freezeExamPool:
		return o.examPool[r.lab.tpl.Spec.Source.ID]
	}
	return false
}

func (v *verifier) pollEvery() time.Duration {
	if v.poll > 0 {
		return v.poll
	}
	return 2 * time.Second
}

// freeze sets spec.accessRevoked, as the exam controller does at the
// deadline, and waits until the session confirms it.
func (v *verifier) freeze(ctx context.Context, s *labsv1.LabSession) (*FreezeReport, error) {
	start := time.Now()
	patch := client.RawPatch("application/merge-patch+json", []byte(`{"spec":{"accessRevoked":true}}`))
	if err := v.c.Patch(ctx, s, patch); err != nil {
		return nil, err
	}
	deadline := start.Add(v.o.freezeTimeout)
	for {
		cur := &labsv1.LabSession{}
		if err := v.c.Get(ctx, client.ObjectKeyFromObject(s), cur); err != nil {
			return nil, err
		}
		if meta.IsStatusConditionTrue(cur.Status.Conditions, labsv1.ConditionAccessRevoked) {
			running := append([]string(nil), cur.Status.StillRunningAfterRevoke...)
			sort.Strings(running)
			return &FreezeReport{ConfirmedSec: time.Since(start).Seconds(), StillRunning: running}, nil
		}
		if cur.Status.Phase == labsv1.SessionFailed || cur.Status.Phase == labsv1.SessionExpired {
			return nil, fmt.Errorf("session %s during the freeze", cur.Status.Phase)
		}
		if time.Now().After(deadline) {
			msg := "no AccessRevoked condition"
			if c := meta.FindStatusCondition(cur.Status.Conditions, labsv1.ConditionAccessRevoked); c != nil {
				msg = c.Reason + ": " + c.Message
			}
			// An exam would leave this attempt unscored.
			return nil, fmt.Errorf("not confirmed after %s (%s)", v.o.freezeTimeout, msg)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(v.pollEvery()):
		}
	}
}

// afterSteps runs once a run's steps are applied: in freeze mode the exam
// freeze first, then the grading, the checks a base or alternative run must
// pass and the repeat grading. It returns false when the run cannot go on.
func (v *verifier) afterSteps(ctx context.Context, r runSpec, sess *labsv1.LabSession, rep *RunReport, fail func(string, ...any)) bool {
	frozen := ""
	if v.o.freezes(r) {
		fr, err := v.freeze(ctx, sess)
		rep.Freeze = fr
		if err != nil {
			fail("exam freeze after the %s: %v", r.kind, err)
			return false
		}
		frozen = " and the exam freeze"
		for _, s := range fr.StillRunning {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("the exam freeze reports %s (an exam attempt solved this way is held for review)", s))
		}
		v.logf("%s/%s: frozen after %.0fs; reported: %s", sess.Namespace, sess.Name, fr.ConfirmedSec, strings.Join(fr.StillRunning, ", "))
	}
	after, err := v.grade(ctx, sess, 2)
	rep.After = after
	if err != nil {
		fail("grade after: %v", err)
		return false
	}
	if r.kind != runBase && r.kind != runAlternative {
		return true
	}
	for _, c := range after.Checks {
		if !c.Passed {
			fail("check %s fails after the %s%s (%s): %s", c.ID, r.kind, frozen, c.Message, tail(c.Output, 300))
		}
	}
	if d := gradeDuration(after); v.o.gradeBudget > 0 && d > v.o.gradeBudget {
		rep.Warnings = append(rep.Warnings, fmt.Sprintf("grading took %s, longer than the %s the workspace waits for a result", d.Round(time.Second), v.o.gradeBudget))
	}
	// Grading must not change what it grades: a second grading right away agrees.
	again, err := v.grade(ctx, sess, 3)
	rep.Again = again
	if err != nil {
		fail("grade again: %v", err)
		return false
	}
	for _, d := range regradeDiffs(after, again) {
		fail("grading is not repeatable: %s", d)
	}
	return true
}
