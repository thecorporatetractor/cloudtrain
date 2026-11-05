package main

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// fakeController plays the in-cluster controller for a verifier session: it
// confirms a freeze (AccessRevoked, with what the freeze reports) and grades
// on every validateRequest. The check "daemon" passes only while the session
// is not frozen: a solution that depends on a process the freeze ends.
type fakeController struct {
	mu sync.Mutex
	// confirm: the freeze is confirmed (false: it never is).
	confirm bool
	// reported is status.stillRunningAfterRevoke after the freeze.
	reported []string
	// events in order: "freeze", "grade <n> frozen=<bool>".
	events []string
}

func (f *fakeController) client(t *testing.T, s *labsv1.LabSession) client.Client {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := labsv1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	base := fake.NewClientBuilder().WithScheme(scheme).WithObjects(s).WithStatusSubresource(&labsv1.LabSession{}).Build()
	return interceptor.NewClient(base.(client.WithWatch), interceptor.Funcs{
		Patch: func(ctx context.Context, c client.WithWatch, obj client.Object, patch client.Patch, opts ...client.PatchOption) error {
			if err := c.Patch(ctx, obj, patch, opts...); err != nil {
				return err
			}
			cur := &labsv1.LabSession{}
			if err := c.Get(ctx, client.ObjectKeyFromObject(obj), cur); err != nil {
				return err
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			frozen := meta.IsStatusConditionTrue(cur.Status.Conditions, labsv1.ConditionAccessRevoked)
			switch {
			case cur.Spec.AccessRevoked && !frozen:
				f.events = append(f.events, "freeze")
				if !f.confirm {
					meta.SetStatusCondition(&cur.Status.Conditions, metav1.Condition{Type: labsv1.ConditionAccessRevoked, Status: metav1.ConditionFalse, Reason: "RevokePending", Message: "revoking learner access: vm1 unreachable"})
					return c.Status().Update(ctx, cur)
				}
				meta.SetStatusCondition(&cur.Status.Conditions, metav1.Condition{Type: labsv1.ConditionAccessRevoked, Status: metav1.ConditionTrue, Reason: "AccessRevoked"})
				cur.Status.StillRunningAfterRevoke = f.reported
				return c.Status().Update(ctx, cur)
			case cur.Status.Validation == nil || cur.Status.Validation.ObservedRequest != cur.Spec.ValidateRequest:
				f.events = append(f.events, fmt.Sprintf("grade %d frozen=%v", cur.Spec.ValidateRequest, frozen))
				cur.Status.Validation = &labsv1.ValidationStatus{ObservedRequest: cur.Spec.ValidateRequest, Phase: labsv1.ValidationComplete, Checks: []labsv1.CheckResult{
					{ID: "file", Passed: true},
					{ID: "daemon", Passed: !frozen, Message: "the daemon does not answer"},
				}}
				return c.Status().Update(ctx, cur)
			}
			return nil
		},
	})
}

func freezeVerifier(c client.Client, mode string, pool map[string]bool) *verifier {
	return &verifier{
		o:      verifyOpts{freeze: mode, examPool: pool, freezeTimeout: 200 * time.Millisecond, gradeTimeout: 2 * time.Second},
		c:      c,
		poll:   10 * time.Millisecond,
		logOut: io.Discard,
	}
}

func freezeRun(kind string) runSpec {
	lt := &labsv1.LabTemplate{Spec: labsv1.LabTemplateSpec{Source: labsv1.LabSource{ID: "xel-daemon"}}}
	return runSpec{lab: &labUnderTest{tpl: lt}, kind: kind, id: "seed-1", seed: 1}
}

func freezeSession() *labsv1.LabSession {
	return &labsv1.LabSession{ObjectMeta: metav1.ObjectMeta{Name: "verify", Namespace: "ctv-x"}}
}

type failures []string

func (f *failures) fail(format string, args ...any) {
	*f = append(*f, strings.TrimSpace(strings.ReplaceAll(fmt.Sprintf(format, args...), "\n", " ")))
}

// #394: with --freeze, a solution that depends on a process the freeze ends
// fails verification: the freeze runs after the steps and before grading,
// and every grading after it sees the frozen session.
func TestAfterStepsFreezeThenGrade(t *testing.T) {
	for _, kind := range []string{runBase, runAlternative} {
		t.Run(kind, func(t *testing.T) {
			fc := &fakeController{confirm: true, reported: []string{"vm1: kept job[42] uid=1002"}}
			s := freezeSession()
			v := freezeVerifier(fc.client(t, s), freezeAll, nil)
			var errs failures
			rep := RunReport{}
			if !v.afterSteps(context.Background(), freezeRun(kind), s, &rep, errs.fail) {
				t.Fatalf("run stopped: %v", errs)
			}
			if got := strings.Join(fc.events, ", "); got != "freeze, grade 2 frozen=true, grade 3 frozen=true" {
				t.Errorf("order: %s", got)
			}
			if len(errs) != 1 || !strings.Contains(errs[0], "check daemon fails after the "+kind+" and the exam freeze") {
				t.Errorf("failures: %v", errs)
			}
			if rep.Freeze == nil || len(rep.Freeze.StillRunning) != 1 || len(rep.Warnings) != 1 || !strings.Contains(rep.Warnings[0], "vm1: kept job[42] uid=1002") {
				t.Errorf("freeze report %+v, warnings %v", rep.Freeze, rep.Warnings)
			}
		})
	}
}

// Without --freeze (or for a lab outside the exam pools) nothing is frozen
// and the same solution passes.
func TestAfterStepsNoFreeze(t *testing.T) {
	for name, v := range map[string]func(client.Client) *verifier{
		"off": func(c client.Client) *verifier { return freezeVerifier(c, freezeOff, nil) },
		"not in a pool": func(c client.Client) *verifier {
			return freezeVerifier(c, freezeExamPool, map[string]bool{"other": true})
		},
	} {
		t.Run(name, func(t *testing.T) {
			fc := &fakeController{confirm: true}
			s := freezeSession()
			var errs failures
			rep := RunReport{}
			if !v(fc.client(t, s)).afterSteps(context.Background(), freezeRun(runBase), s, &rep, errs.fail) || len(errs) > 0 {
				t.Fatalf("failures: %v", errs)
			}
			if got := strings.Join(fc.events, ", "); got != "grade 2 frozen=false, grade 3 frozen=false" || rep.Freeze != nil {
				t.Errorf("order: %s, freeze %+v", got, rep.Freeze)
			}
		})
	}
}

// A freeze the controller does not confirm fails the run before grading (an
// exam would leave the attempt unscored).
func TestAfterStepsFreezeUnconfirmed(t *testing.T) {
	fc := &fakeController{confirm: false}
	s := freezeSession()
	v := freezeVerifier(fc.client(t, s), freezeExamPool, map[string]bool{"xel-daemon": true})
	var errs failures
	rep := RunReport{}
	if v.afterSteps(context.Background(), freezeRun(runAlternative), s, &rep, errs.fail) {
		t.Fatal("run went on after an unconfirmed freeze")
	}
	if len(errs) != 1 || !strings.Contains(errs[0], "exam freeze after the alternative: not confirmed") || !strings.Contains(errs[0], "vm1 unreachable") {
		t.Errorf("failures: %v", errs)
	}
	if strings.Join(fc.events, ", ") != "freeze" || rep.After != nil {
		t.Errorf("graded after an unconfirmed freeze: %v", fc.events)
	}
}

func TestFreezesSelectsRuns(t *testing.T) {
	o := verifyOpts{freeze: freezeExamPool, examPool: map[string]bool{"xel-daemon": true}}
	for kind, want := range map[string]bool{runBase: true, runAlternative: true, runMutation: false} {
		if got := o.freezes(freezeRun(kind)); got != want {
			t.Errorf("exam-pool %s: %v", kind, got)
		}
	}
	other := freezeRun(runBase)
	other.lab.tpl.Spec.Source.ID = "not-pooled"
	if o.freezes(other) {
		t.Error("lab outside every exam pool frozen")
	}
	if !(&verifyOpts{freeze: freezeAll}).freezes(other) || (&verifyOpts{freeze: freezeOff}).freezes(freezeRun(runBase)) {
		t.Error("all/off")
	}
	for in, want := range map[string]string{"": freezeOff, "off": freezeOff, "exam-pool": freezeExamPool, "all": freezeAll, "yes": ""} {
		got, err := parseFreezeMode(in)
		if got != want || (want == "") != (err != nil) {
			t.Errorf("parseFreezeMode(%q) = %q, %v", in, got, err)
		}
	}
}

func TestExamPoolLabs(t *testing.T) {
	pool, err := examPoolLabs("../../testdata/exams/exams.yaml")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"xt-scale-manifest-api", "xt-set-image-tally", "xt-configmap-key", "xt-service-selector-tier"} {
		if !pool[id] {
			t.Errorf("%s not in %v", id, pool)
		}
	}
	// The default for --freeze exam-pool: the real curriculum has pools.
	if pool, err := examPoolLabs("../../../../content/curriculum.yaml"); err != nil || len(pool) == 0 {
		t.Errorf("content/curriculum.yaml: %d pool labs, %v", len(pool), err)
	}
	if _, err := examPoolLabs(filepath.Join(t.TempDir(), "missing.yaml")); err == nil {
		t.Error("missing curriculum accepted")
	}
}
