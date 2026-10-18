package controller

import (
	"context"
	"strings"
	"testing"

	"k8s.io/utils/ptr"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func answerTemplate() *labsv1.LabTemplate {
	t := template()
	t.Spec.Checks = append(t.Spec.Checks,
		labsv1.Check{ID: "q-count", Description: "How many?", Skills: []string{"s"}, Type: labsv1.CheckTypeAnswer,
			Answer: &labsv1.AnswerSpec{Match: labsv1.AnswerNumber, Points: 100, Compute: &labsv1.AnswerCompute{Command: "wc -l < /etc/site", TimeoutSec: 5}}},
		labsv1.Check{ID: "q-site", Description: "Which site?", Skills: []string{"s"}, Type: labsv1.CheckTypeAnswer,
			Answer: &labsv1.AnswerSpec{Match: labsv1.AnswerExact, Points: 100, Value: ptr.To("{{site}}")}},
	)
	return t
}

func TestComputedAnswersAfterSetup(t *testing.T) {
	h := newHarness(t, answerTemplate(), session())
	h.cont.stdout = func(req drivers.ExecRequest) string {
		if strings.Contains(strings.Join(req.Command, " "), "wc -l") {
			return "7\n"
		}
		return ""
	}
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionReady {
		t.Fatalf("phase = %s %+v", s.Status.Phase, s.Status.Conditions)
	}
	if got := s.Status.ComputedAnswers; len(got) != 1 || got["q-count"] != "7" {
		t.Fatalf("computedAnswers = %v", got)
	}
	// setup (1 container action) + 1 compute, as admin on the entry node.
	if n := len(h.cont.execs); n != 2 {
		t.Fatalf("container execs = %d", n)
	}
	c := h.cont.execs[1]
	if c.User != labsv1.ActionAsAdmin || c.Command[2] != "wc -l < /etc/site" || c.Timeout.Seconds() != 5 {
		t.Errorf("compute exec = %+v", c)
	}
	// Not recomputed on the next pass.
	h.reconcile()
	if n := len(h.cont.execs); n != 2 {
		t.Errorf("recomputed: %d execs", n)
	}
	// A reset recomputes after setup ran again.
	s = h.get()
	s.Spec.ResetGeneration = 1
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if n := len(h.cont.execs); n != 4 || h.get().Status.ComputedAnswers["q-count"] != "7" {
		t.Errorf("after reset: %d execs, %v", n, h.get().Status.ComputedAnswers)
	}
}

func TestComputedAnswerFailureFailsSession(t *testing.T) {
	for name, stdout := range map[string]string{"empty output": "  \n", "too long": strings.Repeat("x", 5000)} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, answerTemplate(), session())
			h.cont.stdout = func(drivers.ExecRequest) string { return stdout }
			h.reconcile()
			s := h.get()
			if s.Status.Phase != labsv1.SessionFailed || len(s.Status.ComputedAnswers) != 0 {
				t.Fatalf("phase = %s, answers = %v", s.Status.Phase, s.Status.ComputedAnswers)
			}
			if c := cond(s, labsv1.ConditionSetupComplete); c == nil || !strings.Contains(c.Message, "compute answer q-count") {
				t.Errorf("condition = %+v", c)
			}
		})
	}
}

func TestComputeAnswersExitCode(t *testing.T) {
	f := newFakeDriver(labsv1.DriverContainer)
	f.execExit = 3
	reg, _ := drivers.NewRegistry(f)
	tpl := answerTemplate()
	_, err := ComputeAnswers(context.Background(), &NodeExecutor{Drivers: reg, Session: session(), Template: &tpl.Spec}, &tpl.Spec)
	if err == nil || !strings.Contains(err.Error(), "exited 3") {
		t.Fatalf("err = %v", err)
	}
}

func TestGradingSkipsAnswerChecks(t *testing.T) {
	h := newHarness(t, answerTemplate(), session(func(s *labsv1.LabSession) { s.Spec.ValidateRequest = 1 }))
	h.cont.stdout = func(drivers.ExecRequest) string { return "7\n" }
	h.reconcile()
	v := h.get().Status.Validation
	if v == nil || v.Phase != labsv1.ValidationComplete {
		t.Fatalf("validation = %+v", v)
	}
	if len(v.Checks) != 1 || v.Checks[0].ID != "c" {
		t.Errorf("graded checks = %+v", v.Checks)
	}
}
