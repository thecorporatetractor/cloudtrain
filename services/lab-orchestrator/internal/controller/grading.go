package controller

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/log"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/grader"
)

// gradingRequested reports whether spec.validateRequest has no finished
// answer yet. A result still marked Running for the current request was left
// behind by an interrupted run (reconciles of one session never overlap), so
// it is graded again.
func gradingRequested(s *labsv1.LabSession) bool {
	req := s.Spec.ValidateRequest
	if req == 0 {
		return false
	}
	v := s.Status.Validation
	return v == nil || v.ObservedRequest != req || v.Phase == labsv1.ValidationRunning
}

// gradingStillRequested confirms a grading request against the API server
// (r.Reader, uncached). The reconcile queued by grade's own "Running" status
// write can read the session from a cache that has not seen the "Complete"
// result yet; gradingRequested then takes it for an interrupted run and every
// check runs a second time. Checks with side effects break on that rerun (a
// failover check shuts a router's interface, and the rerun of the checks
// before it sees the backup already master), and a loaded host makes the
// cache lag long enough for it. Without a Reader, or when the read fails,
// the cached object decides.
func (r *LabSessionReconciler) gradingStillRequested(ctx context.Context, s *labsv1.LabSession) bool {
	if r.Reader == nil {
		return true
	}
	fresh := &labsv1.LabSession{}
	if err := r.Reader.Get(ctx, client.ObjectKeyFromObject(s), fresh); err != nil {
		return true
	}
	if fresh.Spec.ValidateRequest != s.Spec.ValidateRequest || !gradingRequested(fresh) {
		logf.FromContext(ctx).Info("grading request already answered; cache is behind", "request", s.Spec.ValidateRequest)
		return false
	}
	return true
}

// rejectGrading answers a pending grading request with phase Failed.
func (r *LabSessionReconciler) rejectGrading(s *labsv1.LabSession, msg string) {
	if !gradingRequested(s) {
		return
	}
	now := metav1.NewTime(r.now())
	s.Status.Validation = &labsv1.ValidationStatus{
		ObservedRequest: s.Spec.ValidateRequest, Phase: labsv1.ValidationFailed, Message: msg,
		StartedAt: &now, CompletedAt: &now,
	}
}

// grade runs every check once and publishes status.validation. The session
// shows phase Grading while the checks run.
func (r *LabSessionReconciler) grade(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate, save saveFunc) error {
	log := logf.FromContext(ctx)
	req := s.Spec.ValidateRequest
	start := metav1.NewTime(r.now())
	s.Status.Validation = &labsv1.ValidationStatus{ObservedRequest: req, Phase: labsv1.ValidationRunning, StartedAt: &start}
	s.Status.Phase = labsv1.SessionGrading
	if err := save(ctx); err != nil {
		return err
	}
	g := &grader.Grader{
		Exec:  &NodeExecutor{Drivers: r.Drivers, Session: s, Template: tpl.spec},
		Entry: tpl.spec.Topology.Entry,
		Now:   r.Now,
	}
	score, results := g.Grade(ctx, tpl.spec.Checks)
	done := metav1.NewTime(r.now())
	passed := 0
	for _, c := range results {
		if c.Passed {
			passed++
		}
	}
	s.Status.Validation = &labsv1.ValidationStatus{
		ObservedRequest: req, Phase: labsv1.ValidationComplete, StartedAt: &start, CompletedAt: &done,
		Score: score, Checks: results,
		Message: fmt.Sprintf("%d of %d checks passed", passed, len(results)),
	}
	if ctx.Err() != nil {
		s.Status.Validation.Phase = labsv1.ValidationFailed
		s.Status.Validation.Message = "grading was interrupted"
	}
	s.Status.Phase = labsv1.SessionReady
	r.event(s, "Normal", "Graded", fmt.Sprintf("request %d: score %d (%d/%d checks)", req, score, passed, len(results)))
	log.Info("graded session", "request", req, "score", score)
	return nil
}
