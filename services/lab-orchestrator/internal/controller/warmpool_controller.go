package controller

import (
	"context"
	"fmt"
	"math/rand/v2"
	"sort"
	"time"

	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/tools/events"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// WarmPool condition reasons.
const (
	ReasonPoolFilled       = "Filled"
	ReasonPoolFilling      = "Filling"
	ReasonPoolHealthy      = "Healthy"
	ReasonPooledFailed     = "PooledSessionFailed"
	ReasonPoolTemplateGone = "TemplateNotFound"

	// requeuePoolBackoff delays replacements after a pooled session failed,
	// so a broken template does not provision in a tight loop.
	requeuePoolBackoff = 30 * time.Second
	// PooledLearnerPrefix is the learner id of unclaimed pooled sessions.
	PooledLearnerPrefix = "warmpool:"
)

// WarmPoolReconciler keeps spec.size Ready, unclaimed pooled sessions per
// WarmPool: it creates them (at most spec.maxSurge provisioning at once),
// replaces failed and idle ones, deletes surplus ones when the pool shrinks
// (not-ready ones first, then the newest), and reports counts in status.
// Pooled sessions are owned by the pool, so deleting the pool garbage-
// collects every unclaimed one; a claim moves ownership to the claimant.
type WarmPoolReconciler struct {
	client.Client
	Scheme   *runtime.Scheme
	Recorder events.EventRecorder
	// Now is injectable for tests; defaults to time.Now.
	Now func() time.Time
	// Seed returns the seed of a new pooled session; defaults to random.
	Seed    func() int64
	Metrics *PoolMetrics
}

// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=warmpools,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=warmpools/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions,verbs=create;delete

func (r *WarmPoolReconciler) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *WarmPoolReconciler) seed() int64 {
	if r.Seed != nil {
		return r.Seed()
	}
	return rand.Int64N(1 << 31)
}

// Reconcile converges one WarmPool.
func (r *WarmPoolReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := logf.FromContext(ctx)
	pool := &labsv1.WarmPool{}
	if err := r.Get(ctx, req.NamespacedName, pool); err != nil {
		if apierrors.IsNotFound(err) && r.Metrics != nil {
			r.Metrics.forget(req.Namespace, req.Name)
		}
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	if !pool.DeletionTimestamp.IsZero() {
		return ctrl.Result{}, nil // owner references garbage-collect the pooled sessions
	}
	base := pool.DeepCopy()
	st := &pool.Status
	now := r.now()

	list := &labsv1.LabSessionList{}
	if err := r.List(ctx, list, client.InNamespace(pool.Namespace), client.MatchingLabels{labsv1.LabelWarmPool: pool.Name}); err != nil {
		return ctrl.Result{}, err
	}
	var ready, provisioning []*labsv1.LabSession
	var claimed int32
	var failed []string
	var requeue time.Duration
	for i := range list.Items {
		s := &list.Items[i]
		if !unclaimedPooled(s) {
			if s.Labels[labsv1.LabelClaimedBy] != "" && s.DeletionTimestamp.IsZero() {
				claimed++
			}
			continue
		}
		if !metav1.IsControlledBy(s, pool) || !s.DeletionTimestamp.IsZero() {
			continue
		}
		switch {
		case s.Status.Phase == labsv1.SessionFailed || s.Status.Phase == labsv1.SessionExpired ||
			s.Spec.TemplateRef.Name != pool.Spec.TemplateRef.Name:
			// Broken, or from an earlier template of the pool: replace.
			if s.Status.Phase == labsv1.SessionFailed {
				msg := "pooled session failed"
				if c := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionReady); c != nil {
					msg = c.Message
				}
				failed = append(failed, fmt.Sprintf("%s: %s", s.Name, msg))
				r.event(pool, "Warning", ReasonPooledFailed, fmt.Sprintf("deleting failed pooled session %s: %s", s.Name, msg))
			}
			if err := r.deleteSession(ctx, s); err != nil {
				return ctrl.Result{}, err
			}
		case pool.Spec.MaxIdle != nil && pool.Spec.MaxIdle.Duration > 0 && poolReady(s) &&
			!now.Before(s.CreationTimestamp.Add(pool.Spec.MaxIdle.Duration)):
			log.Info("recycling idle pooled session", "session", s.Name)
			if err := r.deleteSession(ctx, s); err != nil {
				return ctrl.Result{}, err
			}
		case poolReady(s):
			ready = append(ready, s)
			if pool.Spec.MaxIdle != nil && pool.Spec.MaxIdle.Duration > 0 {
				requeue = minPositive(requeue, s.CreationTimestamp.Add(pool.Spec.MaxIdle.Duration).Sub(now))
			}
		default:
			provisioning = append(provisioning, s)
		}
	}

	size := int(pool.Spec.Size)
	// Shrink: drop not-ready sessions first (newest first), then the newest ready ones.
	newestFirst := func(ss []*labsv1.LabSession) {
		sort.SliceStable(ss, func(i, j int) bool {
			if !ss[i].CreationTimestamp.Equal(&ss[j].CreationTimestamp) {
				return ss[j].CreationTimestamp.Before(&ss[i].CreationTimestamp)
			}
			return ss[i].Name > ss[j].Name
		})
	}
	newestFirst(provisioning)
	newestFirst(ready)
	for len(ready)+len(provisioning) > size {
		var victim *labsv1.LabSession
		if len(provisioning) > 0 {
			victim, provisioning = provisioning[0], provisioning[1:]
		} else {
			victim, ready = ready[0], ready[1:]
		}
		if err := r.deleteSession(ctx, victim); err != nil {
			return ctrl.Result{}, err
		}
		r.event(pool, "Normal", "ScaledDown", "deleted pooled session "+victim.Name)
	}

	// Grow: at most maxSurge sessions provisioning at once; after a failure,
	// wait before replacing.
	tplErr := r.Get(ctx, client.ObjectKey{Namespace: pool.Namespace, Name: pool.Spec.TemplateRef.Name}, &labsv1.LabTemplate{})
	if tplErr != nil && !apierrors.IsNotFound(tplErr) {
		return ctrl.Result{}, tplErr
	}
	created := 0
	if tplErr == nil && len(failed) == 0 {
		want := size - len(ready) - len(provisioning)
		if room := maxSurge(pool) - len(provisioning); want > room {
			want = room
		}
		for ; created < want; created++ {
			s, err := r.createSession(ctx, pool)
			if err != nil {
				return ctrl.Result{}, err
			}
			log.Info("created pooled session", "session", s.Name)
		}
	}

	st.Ready = int32(len(ready))
	st.Provisioning = int32(len(provisioning) + created)
	st.Claimed = claimed
	st.ObservedGeneration = pool.Generation
	switch {
	case len(ready) >= size:
		r.setCondition(pool, labsv1.PoolConditionReady, metav1.ConditionTrue, ReasonPoolFilled,
			fmt.Sprintf("%d/%d sessions ready", len(ready), size))
	default:
		r.setCondition(pool, labsv1.PoolConditionReady, metav1.ConditionFalse, ReasonPoolFilling,
			fmt.Sprintf("%d/%d sessions ready, %d provisioning", len(ready), size, st.Provisioning))
	}
	switch {
	case apierrors.IsNotFound(tplErr):
		r.setCondition(pool, labsv1.PoolConditionDegraded, metav1.ConditionTrue, ReasonPoolTemplateGone,
			fmt.Sprintf("LabTemplate %q not found", pool.Spec.TemplateRef.Name))
		requeue = minPositive(requeue, requeueTemplateWait)
	case len(failed) > 0:
		r.setCondition(pool, labsv1.PoolConditionDegraded, metav1.ConditionTrue, ReasonPooledFailed, failed[0])
		requeue = minPositive(requeue, requeuePoolBackoff)
	default:
		if c := meta.FindStatusCondition(st.Conditions, labsv1.PoolConditionDegraded); c != nil && c.Status == metav1.ConditionTrue &&
			c.Reason == ReasonPooledFailed && now.Sub(c.LastTransitionTime.Time) < requeuePoolBackoff {
			break // keep reporting the failure for a while
		}
		r.setCondition(pool, labsv1.PoolConditionDegraded, metav1.ConditionFalse, ReasonPoolHealthy, "no failed pooled sessions")
	}
	if r.Metrics != nil {
		r.Metrics.observe(pool)
	}
	if !apiEqualPoolStatus(&base.Status, st) {
		if err := r.Status().Patch(ctx, pool, client.MergeFrom(base)); err != nil {
			return ctrl.Result{}, err
		}
	}
	return ctrl.Result{RequeueAfter: requeue}, nil
}

func minPositive(a, b time.Duration) time.Duration {
	if b <= 0 {
		b = time.Second
	}
	if a == 0 || b < a {
		return b
	}
	return a
}

func maxSurge(p *labsv1.WarmPool) int {
	if p.Spec.MaxSurge != nil && *p.Spec.MaxSurge > 0 {
		return int(*p.Spec.MaxSurge)
	}
	return 1
}

// createSession creates one pooled session: the pool's labels plus the
// warm-pool label, owned by the pool, a fresh random seed.
func (r *WarmPoolReconciler) createSession(ctx context.Context, pool *labsv1.WarmPool) (*labsv1.LabSession, error) {
	labels := map[string]string{}
	for k, v := range pool.Labels {
		labels[k] = v
	}
	labels[labsv1.LabelWarmPool] = pool.Name
	s := &labsv1.LabSession{
		ObjectMeta: metav1.ObjectMeta{GenerateName: pool.Name + "-", Namespace: pool.Namespace, Labels: labels},
		Spec: labsv1.LabSessionSpec{
			TemplateRef: pool.Spec.TemplateRef,
			Learner:     labsv1.LearnerRef{ID: PooledLearnerPrefix + pool.Name},
			Seed:        r.seed(),
		},
	}
	if r.Scheme != nil {
		if err := controllerutil.SetControllerReference(pool, s, r.Scheme); err != nil {
			return nil, err
		}
	}
	if err := r.Create(ctx, s); err != nil {
		return nil, fmt.Errorf("create pooled session: %w", err)
	}
	return s, nil
}

func (r *WarmPoolReconciler) deleteSession(ctx context.Context, s *labsv1.LabSession) error {
	uid, rv := s.UID, s.ResourceVersion
	// Preconditions: never delete a session that was claimed in the meantime.
	err := r.Delete(ctx, s, client.Preconditions{UID: &uid, ResourceVersion: &rv})
	if apierrors.IsNotFound(err) || apierrors.IsConflict(err) {
		return nil
	}
	return err
}

func (r *WarmPoolReconciler) event(obj runtime.Object, typ, reason, msg string) {
	if r.Recorder != nil {
		r.Recorder.Eventf(obj, nil, typ, reason, reason, "%s", msg)
	}
}

func (r *WarmPoolReconciler) setCondition(p *labsv1.WarmPool, typ string, status metav1.ConditionStatus, reason, msg string) {
	meta.SetStatusCondition(&p.Status.Conditions, metav1.Condition{
		Type: typ, Status: status, Reason: reason, Message: msg,
		ObservedGeneration: p.Generation, LastTransitionTime: metav1.NewTime(r.now()),
	})
}

func apiEqualPoolStatus(a, b *labsv1.WarmPoolStatus) bool {
	ac, bc := a.DeepCopy(), b.DeepCopy()
	for i := range ac.Conditions {
		ac.Conditions[i].LastTransitionTime = metav1.Time{}
	}
	for i := range bc.Conditions {
		bc.Conditions[i].LastTransitionTime = metav1.Time{}
	}
	return apiequality.Semantic.DeepEqual(ac, bc)
}

// poolOf maps a pooled session to its WarmPool.
func poolOf(_ context.Context, obj client.Object) []reconcile.Request {
	name := obj.GetLabels()[labsv1.LabelWarmPool]
	if name == "" {
		return nil
	}
	return []reconcile.Request{{NamespacedName: types.NamespacedName{Namespace: obj.GetNamespace(), Name: name}}}
}

// SetupWithManager registers the reconciler; it watches pooled sessions
// (by label, so claimed ones still update the claimed count) and templates.
func (r *WarmPoolReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&labsv1.WarmPool{}).
		Watches(&labsv1.LabSession{}, handler.EnqueueRequestsFromMapFunc(poolOf)).
		Watches(&labsv1.LabTemplate{}, handler.EnqueueRequestsFromMapFunc(r.poolsOfTemplate)).
		Named("warmpool").
		Complete(r)
}

// poolsOfTemplate maps a LabTemplate to the pools that use it.
func (r *WarmPoolReconciler) poolsOfTemplate(ctx context.Context, obj client.Object) []reconcile.Request {
	pools := &labsv1.WarmPoolList{}
	if err := r.List(ctx, pools, client.InNamespace(obj.GetNamespace())); err != nil {
		return nil
	}
	var out []reconcile.Request
	for _, p := range pools.Items {
		if p.Spec.TemplateRef.Name == obj.GetName() {
			out = append(out, reconcile.Request{NamespacedName: types.NamespacedName{Namespace: p.Namespace, Name: p.Name}})
		}
	}
	return out
}
