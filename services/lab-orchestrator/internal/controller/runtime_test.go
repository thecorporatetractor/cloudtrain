package controller

import (
	"context"
	"errors"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/utils/ptr"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func gradedTemplate() *labsv1.LabTemplate {
	lt := template()
	lt.Spec.Checks[0].Command = "test -f /etc/site"
	return lt
}

func TestGradingPublishesValidation(t *testing.T) {
	h := newHarness(t, gradedTemplate(), session(func(s *labsv1.LabSession) { s.Spec.ValidateRequest = 1 }))
	h.reconcile()
	s := h.get()
	v := s.Status.Validation
	if v == nil || v.ObservedRequest != 1 || v.Phase != labsv1.ValidationComplete || v.Score != 100 {
		t.Fatalf("validation = %+v", v)
	}
	if s.Status.Phase != labsv1.SessionReady || len(v.Checks) != 1 || !v.Checks[0].Passed || v.StartedAt == nil || v.CompletedAt == nil {
		t.Fatalf("phase %s checks %+v", s.Status.Phase, v.Checks)
	}
	// A new request regrades; a failing check is reported learner-safe.
	h.cont.execExit = 1
	s.Spec.ValidateRequest = 2
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	v = h.get().Status.Validation
	if v.ObservedRequest != 2 || v.Score != 0 || v.Checks[0].Passed || v.Checks[0].Message != "not satisfied yet" {
		t.Fatalf("validation = %+v", v)
	}
	// No new request: no regrade.
	calls := h.cont.execCalls
	h.reconcile()
	if h.cont.execCalls != calls {
		t.Error("graded again without a new request")
	}
}

func TestGradingRequested(t *testing.T) {
	s := session()
	if gradingRequested(s) {
		t.Error("request 0 means none")
	}
	s.Spec.ValidateRequest = 3
	if !gradingRequested(s) {
		t.Error("unanswered request")
	}
	s.Status.Validation = &labsv1.ValidationStatus{ObservedRequest: 3, Phase: labsv1.ValidationRunning}
	if !gradingRequested(s) {
		t.Error("an interrupted run (Running) must be graded again")
	}
	s.Status.Validation.Phase = labsv1.ValidationComplete
	if gradingRequested(s) {
		t.Error("answered request")
	}
}

func TestGradingRejectedWhenFailed(t *testing.T) {
	h := newHarness(t, template(), session(func(s *labsv1.LabSession) { s.Spec.ValidateRequest = 1 }))
	h.netdev.provErr["rtr"] = drivers.ErrUnsupported
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionFailed || s.Status.Validation == nil || s.Status.Validation.Phase != labsv1.ValidationFailed {
		t.Fatalf("phase %s validation %+v", s.Status.Phase, s.Status.Validation)
	}
}

type fakeSession struct {
	wired       bool
	destroyErr  error
	provisioned int
	destroyed   int
}

func (f *fakeSession) ProvisionTopology(context.Context, drivers.SessionRef) (bool, error) {
	f.provisioned++
	return true, nil
}

func (f *fakeSession) DestroyTopology(context.Context, drivers.SessionRef) error {
	f.destroyed++
	return f.destroyErr
}

func (f *fakeSession) WireEntry(context.Context, drivers.SessionRef) (bool, string, error) {
	if !f.wired {
		return false, "waiting for access to qm-x", nil
	}
	return true, "", nil
}

func TestSessionWiringGatesReady(t *testing.T) {
	h := newHarness(t, template(), session())
	fs := &fakeSession{}
	h.r.Session = fs
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionProvisioning || fs.provisioned == 0 {
		t.Fatalf("phase = %s", s.Status.Phase)
	}
	if c := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionNodesReady); c == nil || !strings.Contains(c.Message, "waiting for access to qm-x") {
		t.Errorf("NodesReady = %+v", c)
	}
	if len(h.cont.execs) != 0 {
		t.Error("setup ran before wiring")
	}
	fs.wired = true
	h.reconcile()
	if h.get().Status.Phase != labsv1.SessionReady {
		t.Fatalf("phase = %s", h.get().Status.Phase)
	}
}

func TestTeardownInProgressRequeues(t *testing.T) {
	h := newHarness(t, template(), session())
	fs := &fakeSession{wired: true, destroyErr: fmtInProgress()}
	h.r.Session = fs
	h.reconcile()
	if err := h.c.Delete(context.Background(), h.get()); err != nil {
		t.Fatal(err)
	}
	res := h.reconcile()
	if res.RequeueAfter != requeueTeardown || len(h.get().Finalizers) == 0 {
		t.Fatalf("res = %+v, finalizers %v", res, h.get().Finalizers)
	}
	fs.destroyErr = nil
	h.reconcile()
	s := &labsv1.LabSession{}
	if err := h.c.Get(context.Background(), h.sesName, s); err == nil {
		t.Errorf("session still present: %v", s.Finalizers)
	}
}

func fmtInProgress() error { return errors.Join(errors.New("subnets deleting"), drivers.ErrInProgress) }

func TestNodeExecutorRouting(t *testing.T) {
	h := newHarness(t)
	tpl := template().Spec
	ex := &NodeExecutor{Drivers: h.r.Drivers, Session: session(), Template: &tpl}
	if _, err := ex.Exec(context.Background(), "nope", drivers.ExecRequest{}); !errors.Is(err, drivers.ErrUnsupported) {
		t.Errorf("unknown node: %v", err)
	}
	if _, err := ex.RunAction(context.Background(), labsv1.Action{On: "rtr/member", Run: ptr.To("true")}); err != nil {
		t.Fatal(err)
	}
	if got := h.netdev.execs[0]; got.Member != "member" || got.User != labsv1.ActionAsAdmin {
		t.Errorf("req = %+v", got)
	}
	h.netdev.execExit = 2
	if _, err := ex.RunAction(context.Background(), labsv1.Action{On: "rtr", Run: ptr.To("false")}); !errors.Is(err, errActionFailed) {
		t.Errorf("non-zero exit: %v", err)
	}
}
