package controller

// Claiming a pooled session: a LabSession with spec.warmPoolRef (the
// "claimant") takes over a Ready, unclaimed session of that WarmPool and
// fronts it from then on. The pooled session keeps running the nodes (its
// resources are named after it), the claimant forwards the learner-facing
// spec fields to it and mirrors its status.

import (
	"context"
	"errors"
	"fmt"
	"sort"

	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// Claim condition reasons.
const (
	ReasonClaimed           = "Claimed"
	ReasonPoolNotFound      = "PoolNotFound"
	ReasonPoolExhausted     = "PoolExhausted"
	ReasonTemplateMismatch  = "TemplateMismatch"
	ReasonPooledSessionLost = "PooledSessionLost"
)

// isPooled reports whether s was created by a WarmPool.
func isPooled(s *labsv1.LabSession) bool {
	_, ok := s.Labels[labsv1.LabelWarmPool]
	return ok
}

// unclaimedPooled reports whether s is a pooled session nobody claimed yet.
func unclaimedPooled(s *labsv1.LabSession) bool {
	_, claimed := s.Labels[labsv1.LabelClaimedBy]
	return isPooled(s) && !claimed
}

// isClaimant reports whether s asks to be served from a warm pool.
func isClaimant(s *labsv1.LabSession) bool {
	return s.Spec.WarmPoolRef != "" && !isPooled(s)
}

// poolReady reports whether a pooled session can be handed out.
func poolReady(s *labsv1.LabSession) bool {
	return s.DeletionTimestamp.IsZero() && s.Status.Phase == labsv1.SessionReady &&
		meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionReady)
}

func (r *LabSessionReconciler) reader() client.Reader {
	if r.Reader != nil {
		return r.Reader
	}
	return r.Client
}

// reconcileClaim serves a claimant from its pooled session. handled=false
// means the session provisions itself (no pool session was available when
// it was created).
func (r *LabSessionReconciler) reconcileClaim(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) (ctrl.Result, bool, error) {
	st := &s.Status
	if c := meta.FindStatusCondition(st.Conditions, labsv1.ConditionClaimed); c != nil && c.Status == metav1.ConditionFalse {
		return ctrl.Result{}, false, nil
	}
	if st.Phase == labsv1.SessionExpired {
		return ctrl.Result{}, true, nil
	}
	p, err := r.claimedSession(ctx, s)
	if err != nil {
		return ctrl.Result{}, true, err
	}
	if p == nil && st.PooledSession != "" {
		// Our pooled session is gone (deleted behind our back): nothing runs
		// this session any more.
		msg := fmt.Sprintf("pooled session %s no longer exists", st.PooledSession)
		if !r.now().Before(expiry(s, tpl).Time) {
			st.Phase, st.Endpoints = labsv1.SessionExpired, nil
			r.setCondition(s, labsv1.ConditionExpired, metav1.ConditionTrue, ReasonExpired, "session passed its expiry; resources released")
			r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonExpired, "session expired")
			return ctrl.Result{}, true, nil
		}
		r.event(s, "Warning", ReasonPooledSessionLost, msg)
		return r.fail(s, ReasonPooledSessionLost, msg), true, nil
	}
	if p == nil {
		var reason, msg string
		p, reason, msg, err = r.claim(ctx, s, tpl)
		if err != nil {
			return ctrl.Result{}, true, err
		}
		if p == nil {
			r.setCondition(s, labsv1.ConditionClaimed, metav1.ConditionFalse, reason, msg+"; provisioning a dedicated session")
			r.event(s, "Normal", reason, msg)
			if r.Metrics != nil {
				r.Metrics.claimed(s.Namespace, s.Spec.WarmPoolRef, false)
			}
			return ctrl.Result{}, false, nil
		}
		r.event(s, "Normal", ReasonClaimed, "claimed pooled session "+p.Name)
		if r.Metrics != nil {
			r.Metrics.claimed(s.Namespace, s.Spec.WarmPoolRef, true)
		}
	}
	res, err := r.mirror(ctx, s, p, tpl)
	return res, true, err
}

// claimedSession returns the pooled session claimed by s, if any. It reads
// uncached, so a claim whose status write was lost is still found and a
// claimant never claims twice.
func (r *LabSessionReconciler) claimedSession(ctx context.Context, s *labsv1.LabSession) (*labsv1.LabSession, error) {
	if s.UID == "" {
		return nil, nil
	}
	list := &labsv1.LabSessionList{}
	if err := r.reader().List(ctx, list, client.InNamespace(s.Namespace),
		client.MatchingLabels{labsv1.LabelClaimedBy: string(s.UID)}); err != nil {
		return nil, err
	}
	sort.Slice(list.Items, func(i, j int) bool { return list.Items[i].Name < list.Items[j].Name })
	for i := range list.Items {
		if list.Items[i].Name == s.Status.PooledSession || s.Status.PooledSession == "" {
			return &list.Items[i], nil
		}
	}
	return nil, nil
}

// claim takes over a Ready, unclaimed session of the pool. The take-over is
// one optimistic-locked patch (claimed-by label, controller owner, learner
// fields), so concurrent claimants never get the same pooled session: the
// loser sees a conflict and moves on to the next candidate.
func (r *LabSessionReconciler) claim(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) (*labsv1.LabSession, string, string, error) {
	pool := &labsv1.WarmPool{}
	if err := r.Get(ctx, client.ObjectKey{Namespace: s.Namespace, Name: s.Spec.WarmPoolRef}, pool); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, ReasonPoolNotFound, fmt.Sprintf("WarmPool %q not found", s.Spec.WarmPoolRef), nil
		}
		return nil, "", "", err
	}
	if pool.Spec.TemplateRef.Name != s.Spec.TemplateRef.Name {
		return nil, ReasonTemplateMismatch, fmt.Sprintf("WarmPool %q serves template %q, not %q",
			pool.Name, pool.Spec.TemplateRef.Name, s.Spec.TemplateRef.Name), nil
	}
	list := &labsv1.LabSessionList{}
	if err := r.List(ctx, list, client.InNamespace(s.Namespace), client.MatchingLabels{labsv1.LabelWarmPool: pool.Name}); err != nil {
		return nil, "", "", err
	}
	var cands []labsv1.LabSession
	for _, c := range list.Items {
		if unclaimedPooled(&c) && poolReady(&c) && metav1.IsControlledBy(&c, pool) &&
			c.Spec.TemplateRef.Name == pool.Spec.TemplateRef.Name {
			cands = append(cands, c)
		}
	}
	sort.Slice(cands, func(i, j int) bool {
		ti, tj := readyTime(&cands[i]), readyTime(&cands[j])
		if !ti.Equal(&tj) {
			return ti.Before(&tj)
		}
		return cands[i].Name < cands[j].Name
	})
	exp := expiry(s, tpl)
	for i := range cands {
		p := &cands[i]
		err := r.tryClaim(ctx, s, p, exp)
		switch {
		case err == nil:
			return p, ReasonClaimed, "", nil
		case apierrors.IsConflict(err) || apierrors.IsNotFound(err):
			continue // claimed (or changed) concurrently: next candidate
		default:
			return nil, "", "", err
		}
	}
	return nil, ReasonPoolExhausted, fmt.Sprintf("WarmPool %q has no ready session", pool.Name), nil
}

func readyTime(s *labsv1.LabSession) metav1.Time {
	if s.Status.ReadyAt != nil {
		return *s.Status.ReadyAt
	}
	return s.CreationTimestamp
}

// tryClaim marks p as claimed by s with an optimistic lock on p's
// resourceVersion and moves its ownership from the pool to s.
func (r *LabSessionReconciler) tryClaim(ctx context.Context, s, p *labsv1.LabSession, exp metav1.Time) error {
	orig := p.DeepCopy()
	if p.Labels == nil {
		p.Labels = map[string]string{}
	}
	p.Labels[labsv1.LabelClaimedBy] = string(s.UID)
	if p.Annotations == nil {
		p.Annotations = map[string]string{}
	}
	p.Annotations[labsv1.AnnotationClaimedByName] = s.Name
	var refs []metav1.OwnerReference
	for _, o := range p.OwnerReferences {
		if o.Controller == nil || !*o.Controller {
			refs = append(refs, o)
		}
	}
	p.OwnerReferences = refs
	if r.Scheme != nil {
		if err := controllerutil.SetControllerReference(s, p, r.Scheme); err != nil {
			return err
		}
	}
	forwardSpec(s, p, exp)
	return r.Patch(ctx, p, client.MergeFromWithOptions(orig, client.MergeFromWithOptimisticLock{}))
}

// forwardSpec copies the learner-facing spec of claimant s onto pooled p.
func forwardSpec(s, p *labsv1.LabSession, exp metav1.Time) {
	p.Spec.Learner = s.Spec.Learner
	p.Spec.TTL = nil
	p.Spec.ExpiresAt = &exp
	p.Spec.Hibernate = s.Spec.Hibernate
	p.Spec.ResetGeneration = s.Spec.ResetGeneration
	p.Spec.ValidateRequest = s.Spec.ValidateRequest
	p.Spec.AccessRevoked = p.Spec.AccessRevoked || s.Spec.AccessRevoked
}

// mirror forwards s's spec to its pooled session p and publishes p's state
// as s's status.
func (r *LabSessionReconciler) mirror(ctx context.Context, s, p *labsv1.LabSession, tpl *resolvedTemplate) (ctrl.Result, error) {
	want := p.DeepCopy()
	forwardSpec(s, want, expiry(s, tpl))
	if !apiequality.Semantic.DeepEqual(want.Spec, p.Spec) {
		if err := r.Patch(ctx, want, client.MergeFrom(p)); err != nil {
			return ctrl.Result{}, fmt.Errorf("forward spec to pooled session %s: %w", p.Name, err)
		}
		p = want
	}
	st, ps := &s.Status, &p.Status
	st.PooledSession = p.Name
	st.Phase = ps.Phase
	if st.Phase == "" {
		st.Phase = labsv1.SessionPending
	}
	st.ResolvedParams = ps.ResolvedParams
	st.Nodes = ps.Nodes
	st.Endpoints = ps.Endpoints
	st.EntryNode = ps.EntryNode
	st.Hibernated = ps.Hibernated
	st.Validation = ps.Validation
	st.Links = ps.Links
	st.SetupProgress = ps.SetupProgress
	st.ObservedResetGeneration = ps.ObservedResetGeneration
	st.ExpiresAt = p.Spec.ExpiresAt
	if ps.ExpiresAt != nil {
		st.ExpiresAt = ps.ExpiresAt
	}
	for _, c := range ps.Conditions {
		c.ObservedGeneration = s.Generation
		meta.SetStatusCondition(&st.Conditions, c)
	}
	r.setCondition(s, labsv1.ConditionClaimed, metav1.ConditionTrue, ReasonClaimed, "serving pooled session "+p.Name)
	if st.Phase == labsv1.SessionReady && st.ReadyAt == nil {
		t := metav1.NewTime(r.now())
		st.ReadyAt = &t
		r.event(s, "Normal", ReasonReady, "lab session is ready (pooled session "+p.Name+")")
	}
	if st.Phase == labsv1.SessionExpired {
		return ctrl.Result{}, nil
	}
	// The pooled session's changes arrive through the watch; requeue at
	// expiry in case it is gone by then.
	return r.requeueBeforeExpiry(s, 0), nil
}

// deletePooled deletes the pooled session(s) s claimed and reports
// ErrInProgress until they are gone (their own finalizers tear the nodes down).
func (r *LabSessionReconciler) deletePooled(ctx context.Context, s *labsv1.LabSession) error {
	if !isClaimant(s) || s.UID == "" {
		return nil
	}
	list := &labsv1.LabSessionList{}
	if err := r.reader().List(ctx, list, client.InNamespace(s.Namespace),
		client.MatchingLabels{labsv1.LabelClaimedBy: string(s.UID)}); err != nil {
		return err
	}
	if len(list.Items) == 0 {
		return nil
	}
	var errs error
	for i := range list.Items {
		p := &list.Items[i]
		if p.DeletionTimestamp.IsZero() {
			uid := p.UID
			if err := r.Delete(ctx, p, client.Preconditions{UID: &uid}); err != nil && !apierrors.IsNotFound(err) {
				errs = errors.Join(errs, err)
			}
		}
	}
	if errs != nil {
		return errs
	}
	return fmt.Errorf("pooled session %s is being torn down: %w", list.Items[0].Name, drivers.ErrInProgress)
}

// claimantOf maps a claimed pooled session to its claimant, so the claimant
// mirrors every change of it.
func claimantOf(_ context.Context, obj client.Object) []reconcile.Request {
	name := obj.GetAnnotations()[labsv1.AnnotationClaimedByName]
	if name == "" || obj.GetLabels()[labsv1.LabelClaimedBy] == "" {
		return nil
	}
	return []reconcile.Request{{NamespacedName: types.NamespacedName{Namespace: obj.GetNamespace(), Name: name}}}
}
