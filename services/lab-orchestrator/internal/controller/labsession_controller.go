// Package controller contains the lab-orchestrator reconcilers.
package controller

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/tools/events"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	logf "sigs.k8s.io/controller-runtime/pkg/log"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/gate"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/rbac"
)

const (
	// Finalizer ensures driver resources are destroyed before a session goes away.
	Finalizer = "labs.cloudtrain.dev/session-cleanup"

	// MinDefaultTTL is the floor of the default session TTL.
	MinDefaultTTL = 30 * time.Minute

	// Requeue intervals.
	requeueProvisioning  = 5 * time.Second
	requeueTemplateWait  = 30 * time.Second
	requeueTeardown      = 3 * time.Second
	defaultActionTimeout = 2 * time.Minute
	// maxActionTimeout caps a single setup action (the schema leaves
	// timeoutSec unbounded) so one session cannot pin a worker indefinitely.
	maxActionTimeout = 10 * time.Minute

	// DefaultProvisionTimeout fails a session whose nodes are not ready in time
	// (ImagePullBackOff, CrashLoopBackOff, a VM that never boots).
	DefaultProvisionTimeout = 15 * time.Minute
	// DefaultMaxConcurrentReconciles bounds parallel session reconciles.
	DefaultMaxConcurrentReconciles = 8

	// DefaultProvisionDeadline bounds one provisioning attempt as a whole
	// (topology, waiting for capacity, nodes, setup, answers): a session not
	// ready by then fails instead of sitting in Provisioning until its TTL.
	DefaultProvisionDeadline = 60 * time.Minute
	// DefaultFailedRelease is how long a failed session keeps its resources
	// (pods, VMs, disks, networks) before they are torn down; the session
	// object stays, Failed, until it expires.
	DefaultFailedRelease = 5 * time.Minute
	// DefaultExpiredRetention is how long an Expired LabSession object is
	// kept (its resources are already gone) before it is deleted.
	DefaultExpiredRetention = 7 * 24 * time.Hour
	// DefaultReadyRecheck is how often a Ready session is reconciled again, so
	// a crashed or replaced VM, a restarted pod or a dead vcluster is noticed
	// (and setup re-run) between other events.
	DefaultReadyRecheck = 2 * time.Minute
	// DefaultSetupSlice is how long one Reconcile keeps starting setup
	// actions before it hands the worker back and requeues (an action that
	// started always finishes). Deletion, hibernation and reset are checked
	// between actions.
	DefaultSetupSlice = 30 * time.Second
	// requeueSetupStep: the requeue after a setup slice ended; the session
	// goes to the back of the work queue, so other sessions get a turn.
	requeueSetupStep = 100 * time.Millisecond

	// AnnotationKeepFailed on a LabSession ("true") keeps a failed session's
	// resources until expiry, for debugging. Sessions of labctl verify
	// (label labs.cloudtrain.dev/verify=true) keep them too.
	AnnotationKeepFailed = "labs.cloudtrain.dev/keep-failed"
	// LabelVerifySession marks the LabSessions of labctl verify.
	LabelVerifySession = "labs.cloudtrain.dev/verify"
)

// Condition reasons.
const (
	ReasonTemplateNotFound = "TemplateNotFound"
	ReasonResolveFailed    = "ParamResolutionFailed"
	ReasonResolved         = "Resolved"
	ReasonProvisioning     = "Provisioning"
	ReasonNodesReady       = "NodesReady"
	ReasonNodeFailed       = "NodeFailed"
	ReasonSetupPending     = "SetupPending"
	ReasonSetupComplete    = "SetupComplete"
	ReasonSetupFailed      = "SetupFailed"
	ReasonReady            = "Ready"
	ReasonNotReady         = "NotReady"
	ReasonHibernated       = "Hibernated"
	ReasonAwake            = "Awake"
	ReasonExpired          = "Expired"
	ReasonActive           = "Active"
	ReasonExpiring         = "TeardownPending"
	ReasonHibernating      = "Hibernating"
	ReasonNodeReplaced     = "NodeReplaced"
	ReasonResetRequested   = "ResetRequested"
	ReasonResetFailed      = "ResetFailed"
	ReasonProvisionTimeout = "ProvisionTimeout"
	// ReasonProvisionDeadline: the session was not ready within the
	// session-level provisioning deadline.
	ReasonProvisionDeadline = "ProvisionDeadline"
	ReasonInProgress        = "InProgress"
	ReasonWaitingCapacity   = "WaitingForCapacity"
	ReasonScheduled         = "Scheduled"
	ReasonReleasePending    = "ReleasePending"
	ReasonReleased          = "Released"
	ReasonKeptForDebugging  = "KeptForDebugging"
	// Sandboxed condition reasons.
	ReasonSandboxed          = "Sandboxed"
	ReasonVMFallback         = "VMFallback"
	ReasonSandboxUnavailable = "SandboxUnavailable"
)

// LabSessionReconciler walks a session's topology nodes through their
// drivers and maintains its status.
type LabSessionReconciler struct {
	client.Client
	Scheme   *runtime.Scheme
	Drivers  *drivers.Registry
	Recorder events.EventRecorder
	// Sandboxes and Catalog: tier sandboxes and their vmFallback rewrite
	// (nil Sandboxes = off).
	Sandboxes *drivers.Sandboxes
	Catalog   *drivers.ImageCatalog
	// Now is injectable for tests; defaults to time.Now.
	Now func() time.Time
	// ProvisionTimeout defaults to DefaultProvisionTimeout.
	ProvisionTimeout time.Duration
	// Gate: every create of a lab object during a reconcile checks it
	// (internal/gate). Production: the profile is on, and a missing Gate
	// then refuses every create (fail closed).
	Gate       gate.Checker
	Production bool
	// MaxConcurrentReconciles defaults to DefaultMaxConcurrentReconciles.
	// Setup actions run inside Reconcile, so this must be > 1 for one slow
	// session not to stall every other one.
	MaxConcurrentReconciles int
	// Session, when set, provisions session-scoped resources (keys, lab
	// network, entry isolation) before any node and wires the entry node
	// once the other nodes' access material exists.
	Session drivers.SessionProvisioner
	// Reader, when set, is an uncached reader (mgr.GetAPIReader()) used to
	// find a claimant's pooled session and to confirm a grading request
	// without cache lag.
	Reader client.Reader
	// Metrics, when set, counts warm pool claims.
	Metrics *PoolMetrics
	// Access, when set, grants the manager its session permissions in the
	// session's namespace before any driver runs (internal/rbac).
	Access SessionNamespaceAccess

	// ProvisionDeadline bounds one provisioning attempt as a whole (default
	// DefaultProvisionDeadline; negative = off).
	ProvisionDeadline time.Duration
	// FailedRelease: how long a failed session keeps its resources (default
	// DefaultFailedRelease; negative = until expiry, the old behaviour).
	FailedRelease time.Duration
	// ExpiredRetention: how long an Expired session object is kept before it
	// is deleted (default DefaultExpiredRetention; negative = forever).
	ExpiredRetention time.Duration
	// ReadyRecheck: how often a Ready session is re-observed (default
	// DefaultReadyRecheck; negative = only at expiry and on events).
	ReadyRecheck time.Duration
	// SetupSlice: how long one Reconcile starts setup actions before it
	// requeues (default DefaultSetupSlice).
	SetupSlice time.Duration

	// written: the resourceVersion of each session's last write by this
	// reconciler (types.NamespacedName -> string), see readFresh.
	written sync.Map
}

// durationOr returns d, def when d is 0, and 0 (off) when d is negative.
func durationOr(d, def time.Duration) time.Duration {
	switch {
	case d < 0:
		return 0
	case d == 0:
		return def
	}
	return d
}

// SessionNamespaceAccess grants the manager its session permissions in a
// namespace holding LabSessions (*rbac.SessionAccess).
type SessionNamespaceAccess interface {
	// Ensure binds the session permissions without holding the binding: an
	// ExamSession uses it, since only LabSessions release the hold.
	Ensure(ctx context.Context, namespace string) error
	// EnsureHeld binds the session permissions; the binding outlives the
	// namespace's deletion until Release.
	EnsureHeld(ctx context.Context, namespace string) error
	// Release drops the binding's finalizer (no LabSessions left).
	Release(ctx context.Context, namespace string) error
	// Forget makes the next EnsureHeld check the binding again.
	Forget(namespace string)
}

// The manager's cluster-wide ClusterRole (config/rbac/role.yaml). Everything
// it does inside a lab namespace (Secrets, pods/exec, writes to pods,
// services, VMs, ...) is in the session ClusterRole (internal/rbac), bound
// per lab namespace; docs/deploy.md (RBAC) has the inventory.
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions/finalizers,verbs=update
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labtemplates,verbs=get;list;watch
// Read-only, cluster-wide: the informers behind Owns(Pod), Owns(Service)
// (filtered to the orchestrator's own objects by label in the cache; RBAC
// cannot filter by label). --watch-namespace narrows the informers, not RBAC.
// +kubebuilder:rbac:groups="",resources=pods;services,verbs=get;list;watch
// vcluster host namespaces (ct-vc-*): created, relabelled and deleted by the
// manager; the admission policy limits it to namespaces it labelled itself.
// +kubebuilder:rbac:groups="",resources=namespaces,verbs=get;create;patch;delete
// Lab namespaces: bind the session ClusterRole to itself. bind is limited to
// that role by name; RoleBinding writes are cluster-wide because the lab
// namespaces are not known in advance (the admission policy limits them to
// labelled namespaces and the manager as the only subject).
// +kubebuilder:rbac:groups=rbac.authorization.k8s.io,resources=rolebindings,verbs=get;create;update;delete
// +kubebuilder:rbac:groups=rbac.authorization.k8s.io,resources=clusterroles,verbs=bind,resourceNames=lab-orchestrator-session
// +kubebuilder:rbac:groups="",resources=nodes,verbs=get;list
// Storage preflight at startup: the configured or default StorageClass must exist.
// +kubebuilder:rbac:groups=storage.k8s.io,resources=storageclasses,verbs=list
// +kubebuilder:rbac:groups=node.k8s.io,resources=runtimeclasses,verbs=get
// Metrics endpoint authn/authz (--metrics-secure).
// +kubebuilder:rbac:groups=authentication.k8s.io,resources=tokenreviews,verbs=create
// +kubebuilder:rbac:groups=authorization.k8s.io,resources=subjectaccessreviews,verbs=create

func (r *LabSessionReconciler) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *LabSessionReconciler) event(obj runtime.Object, typ, reason, msg string) {
	if r.Recorder != nil {
		r.Recorder.Eventf(obj, nil, typ, reason, reason, "%s", msg)
	}
}

// Reconcile drives one LabSession towards its desired state.
//
// Status is written with a JSON merge patch (no optimistic lock), so fields
// other writers own (e.g. phase Grading) survive and our own progress is
// never thrown away on a conflict.
func (r *LabSessionReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	ctx = gate.With(ctx, r.Production, r.Gate)
	log := logf.FromContext(ctx)

	s := &labsv1.LabSession{}
	if err := r.Get(ctx, req.NamespacedName, s); err != nil {
		if apierrors.IsNotFound(err) {
			r.written.Delete(req.NamespacedName)
		}
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	s, rerr := r.readFresh(ctx, req.NamespacedName, s)
	if rerr != nil {
		if apierrors.IsNotFound(rerr) {
			r.written.Delete(req.NamespacedName)
		}
		return ctrl.Result{}, client.IgnoreNotFound(rerr)
	}
	startRV := s.ResourceVersion
	defer func() {
		// Remember what this reconcile wrote (status patch, finalizer), so
		// the next one does not act on a cache that has not seen it yet.
		if s.ResourceVersion != startRV {
			r.written.Store(req.NamespacedName, s.ResourceVersion)
		}
	}()

	// A session being deleted that no longer carries the cleanup finalizer
	// is done (its teardown ran and it released the access hold); a cached
	// copy of it is still reconciled once more. Holding the binding again
	// here would keep it, and the namespace, Terminating with nobody left
	// to release it.
	if !s.DeletionTimestamp.IsZero() && !controllerutil.ContainsFinalizer(s, Finalizer) {
		return ctrl.Result{}, nil
	}

	// Access first: every driver call below acts in the session namespace.
	// Teardown tries even without it (a terminating namespace takes no new
	// RoleBinding, but the one from provisioning is still there).
	accessErr := ensureAccess(ctx, r.Access, s.Namespace)
	if accessErr != nil && s.DeletionTimestamp.IsZero() && !errors.Is(accessErr, rbac.ErrNamespaceNotLab) {
		return ctrl.Result{}, accessErr
	}

	// Deletion: destroy node resources, then release the finalizer. Teardown
	// uses the topology recorded in status, never only the live template.
	if !s.DeletionTimestamp.IsZero() {
		if controllerutil.ContainsFinalizer(s, Finalizer) {
			if err := r.teardown(ctx, s); err != nil {
				forgetAccessOnForbidden(r.Access, s.Namespace, err)
				if errors.Is(err, drivers.ErrInProgress) {
					log.V(1).Info("teardown in progress", "reason", err.Error())
					return ctrl.Result{RequeueAfter: requeueTeardown}, nil
				}
				return ctrl.Result{}, err
			}
			if err := r.releaseAccess(ctx, s); err != nil {
				return ctrl.Result{}, err
			}
			controllerutil.RemoveFinalizer(s, Finalizer)
			if err := r.Update(ctx, s); err != nil {
				return ctrl.Result{}, err
			}
			// Sessions of one namespace torn down at the same time (an exam
			// attempt's, or a deleted namespace's) each saw the others still
			// holding the cleanup finalizer before they dropped their own, so
			// none released the binding. Check again now that this one is
			// gone: the last session to drop its finalizer sees no others.
			if err := r.releaseAccess(ctx, s); err != nil {
				return ctrl.Result{}, err
			}
		}
		return ctrl.Result{}, nil
	}

	if controllerutil.AddFinalizer(s, Finalizer) {
		if err := r.Update(ctx, s); err != nil {
			return ctrl.Result{}, err
		}
	}

	base := s.DeepCopy()
	save := func(ctx context.Context) error {
		s.Status.ObservedGeneration = s.Generation
		if statusEqual(&base.Status, &s.Status) {
			return nil
		}
		if err := r.Status().Patch(ctx, s, client.MergeFrom(base)); err != nil {
			return err
		}
		base = s.DeepCopy()
		return nil
	}

	if accessErr != nil {
		msg := fmt.Sprintf("the orchestrator works only in lab namespaces: label namespace %s with %s=true (%v)", s.Namespace, drivers.LabelLabNamespace, accessErr)
		// A Ready=False reason already there (a failure, expiry,
		// provisioning) still says what the lab is doing: keep it. The
		// event tells about the label either way.
		if c := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionReady); c == nil || c.Status != metav1.ConditionFalse || c.Reason == ReasonNamespaceNotLab {
			r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonNamespaceNotLab, msg)
		}
		r.event(s, corev1.EventTypeWarning, ReasonNamespaceNotLab, msg)
		res := ctrl.Result{RequeueAfter: requeueNamespaceNotLab}
		var err error
		// Expiry still applies (the label was removed by mistake or drift):
		// tear down with whatever access is left, so the session never runs
		// past its expiry unnoticed. Failed sessions are still released and
		// Expired ones still collected on this path.
		switch {
		case s.Status.Phase == labsv1.SessionExpired:
			res, err = r.collectExpired(ctx, s)
		case unclaimedPooled(s):
		case !r.now().Before(expiry(s, nil).Time):
			exp := expiry(s, nil)
			s.Status.ExpiresAt = &exp
			res, err = r.expire(ctx, s)
		case s.Status.Phase == labsv1.SessionFailed:
			r.rejectGrading(s, "the lab session failed; it cannot be graded")
			res, err = r.releaseFailed(ctx, s)
		}
		// Check the label again soon (a collected session is simply not
		// found then).
		if err == nil && (res.RequeueAfter == 0 || res.RequeueAfter > requeueNamespaceNotLab) {
			res.RequeueAfter = requeueNamespaceNotLab
		}
		if uerr := save(ctx); uerr != nil {
			return ctrl.Result{}, errors.Join(err, uerr)
		}
		return res, err
	}

	tpl, tplErr := r.template(ctx, s)
	var res ctrl.Result
	var err error
	handled := false
	if isClaimant(s) {
		res, handled, err = r.reconcileClaim(ctx, s, tpl)
	}
	if !handled {
		res, err = r.reconcileSession(ctx, s, tpl, tplErr, save)
	}
	if uerr := save(ctx); uerr != nil {
		return ctrl.Result{}, errors.Join(err, uerr)
	}
	if err != nil {
		forgetAccessOnForbidden(r.Access, s.Namespace, err)
		log.Error(err, "reconcile failed", "phase", s.Status.Phase)
	}
	return res, err
}

// readFresh returns the session to act on: the cached s, or s read
// uncached through Reader when the cache may be behind this reconciler's
// own last write. Setup runs in slices across reconciles (runSetup), and a
// slice can start in the same reconcile that re-arms setup (a replaced
// node, a reset): a requeue served from a cache that has not seen that
// write yet would re-arm again and repeat actions. Whether to read
// uncached therefore depends on what this reconciler wrote, not only on
// the cached status (setupInFlight covers a write from a previous
// manager process).
func (r *LabSessionReconciler) readFresh(ctx context.Context, key types.NamespacedName, s *labsv1.LabSession) (*labsv1.LabSession, error) {
	if r.Reader == nil {
		return s, nil
	}
	rv, wrote := r.written.Load(key)
	behind := wrote && rv.(string) != s.ResourceVersion
	if !behind && !setupInFlight(s) {
		if wrote {
			r.written.Delete(key) // the cache has caught up
		}
		return s, nil
	}
	fresh := &labsv1.LabSession{}
	if err := r.Reader.Get(ctx, key, fresh); err != nil {
		return nil, err
	}
	if wrote && fresh.ResourceVersion == s.ResourceVersion {
		// The cache holds the live object (a later write by someone
		// else): it is not behind.
		r.written.Delete(key)
	}
	return fresh, nil
}

// ReasonNamespaceNotLab: the session's namespace lacks the lab label.
const ReasonNamespaceNotLab = "NamespaceNotLab"

// requeueNamespaceNotLab: how often a session in an unlabelled namespace
// checks the label again.
const requeueNamespaceNotLab = 30 * time.Second

// ensureAccess grants the manager its session permissions in namespace.
func ensureAccess(ctx context.Context, a SessionNamespaceAccess, namespace string) error {
	if a == nil {
		return nil
	}
	return a.EnsureHeld(ctx, namespace)
}

// forgetAccessOnForbidden makes the next ensureAccess check the binding
// again after a Forbidden error (e.g. it was deleted).
func forgetAccessOnForbidden(a SessionNamespaceAccess, namespace string, err error) {
	if a != nil && apierrors.IsForbidden(err) {
		a.Forget(namespace)
	}
}

// releaseAccess drops the session binding's finalizer once s, torn down,
// is the last LabSession in its namespace that carries the cleanup
// finalizer (read uncached: a session created a moment ago counts).
func (r *LabSessionReconciler) releaseAccess(ctx context.Context, s *labsv1.LabSession) error {
	if r.Access == nil {
		return nil
	}
	var reader client.Reader = r.Client
	if r.Reader != nil {
		reader = r.Reader
	}
	list := &labsv1.LabSessionList{}
	if err := reader.List(ctx, list, client.InNamespace(s.Namespace)); err != nil {
		return err
	}
	for i := range list.Items {
		if o := &list.Items[i]; o.Name != s.Name && controllerutil.ContainsFinalizer(o, Finalizer) {
			return nil
		}
	}
	return r.Access.Release(ctx, s.Namespace)
}

// template fetches the session's LabTemplate and resolves its params.
func (r *LabSessionReconciler) template(ctx context.Context, s *labsv1.LabSession) (*resolvedTemplate, error) {
	lt := &labsv1.LabTemplate{}
	if err := r.Get(ctx, client.ObjectKey{Namespace: s.Namespace, Name: s.Spec.TemplateRef.Name}, lt); err != nil {
		return nil, err
	}
	spec, values, err := compile.Resolve(&lt.Spec, s.Spec.Seed, compile.ResolveOptions{})
	if err != nil {
		return nil, &resolveError{err}
	}
	// Tier sandboxes: container nodes whose sandbox is unavailable become
	// their KubeVirt VM twin (vmFallback). Every driver call, the recorded
	// topology and teardown see the rewritten nodes.
	sb, err := r.Sandboxes.PlanSandboxes(ctx, r.Catalog, spec, s.Status.Topology)
	if err != nil {
		if drivers.IsPermanent(err) {
			return nil, &resolveError{err}
		}
		return nil, err // an API error while checking a sandbox: retry
	}
	return &resolvedTemplate{spec: spec, values: values, sandbox: sb}, nil
}

type resolvedTemplate struct {
	spec   *labsv1.LabTemplateSpec
	values map[string]string
	// sandbox: the sandbox decision of each container node of a sandboxed
	// tier (empty when the manager has no sandboxes).
	sandbox []drivers.SandboxNode
}

// sandboxCondition sets the Sandboxed condition from the template's sandbox
// decisions (and an event when it changes).
func (r *LabSessionReconciler) sandboxCondition(s *labsv1.LabSession, nodes []drivers.SandboxNode) {
	if len(nodes) == 0 {
		return
	}
	status, reason := metav1.ConditionTrue, ReasonSandboxed
	var parts []string
	for _, n := range nodes {
		switch n.Substrate {
		case drivers.SubstrateSandbox:
			parts = append(parts, fmt.Sprintf("%s: tier %s sandbox %s", n.Node, n.Tier, n.RuntimeClass))
		case drivers.SubstrateVM:
			status = metav1.ConditionFalse
			if reason != ReasonSandboxUnavailable {
				reason = ReasonVMFallback
			}
			if n.Tier == "" {
				parts = append(parts, fmt.Sprintf("%s: KubeVirt VM %s (provisioned as the VM fallback; kept for the session)", n.Node, n.VMImage))
				continue
			}
			parts = append(parts, fmt.Sprintf("%s: KubeVirt VM %s instead of %s (tier %s sandbox %s unavailable: %s)", n.Node, n.VMImage, n.Image, n.Tier, n.RuntimeClass, n.Reason))
		default:
			status, reason = metav1.ConditionFalse, ReasonSandboxUnavailable
			parts = append(parts, fmt.Sprintf("%s: no sandbox (tier %s sandbox %s unavailable: %s)", n.Node, n.Tier, n.RuntimeClass, n.Reason))
		}
	}
	msg := strings.Join(parts, "; ")
	if prev := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionSandboxed); prev == nil || prev.Reason != reason {
		typ := corev1.EventTypeNormal
		if status == metav1.ConditionFalse {
			typ = corev1.EventTypeWarning
		}
		r.event(s, typ, reason, msg)
	}
	r.setCondition(s, labsv1.ConditionSandboxed, status, reason, msg)
}

type resolveError struct{ error }

func (e *resolveError) Unwrap() error { return e.error }

type saveFunc func(context.Context) error

func (r *LabSessionReconciler) reconcileSession(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate, tplErr error, save saveFunc) (ctrl.Result, error) {
	st := &s.Status
	if st.Phase == "" {
		st.Phase = labsv1.SessionPending
	}

	// Terminal phase: an expired session stays expired; its resources are gone
	// (expire only sets it after teardown succeeded).
	if st.Phase == labsv1.SessionExpired {
		return r.collectExpired(ctx, s)
	}

	now := r.now()
	if unclaimedPooled(s) {
		// A pooled session waits for its claimant indefinitely; the claim
		// sets spec.expiresAt (see WarmPool.spec.maxIdle for recycling).
		st.ExpiresAt = nil
		r.setCondition(s, labsv1.ConditionExpired, metav1.ConditionFalse, ReasonActive, "unclaimed pooled session; expires once claimed")
	} else {
		exp := expiry(s, tpl)
		st.ExpiresAt = &exp
		if !now.Before(exp.Time) {
			return r.expire(ctx, s)
		}
		r.setCondition(s, labsv1.ConditionExpired, metav1.ConditionFalse, ReasonActive, "session has not expired")
	}

	// A failed session is released without its template (teardown uses
	// status.topology), so a template deleted meanwhile does not keep its
	// resources until expiry.
	if st.Phase == labsv1.SessionFailed {
		r.rejectGrading(s, "the lab session failed; it cannot be graded")
		return r.releaseFailed(ctx, s)
	}

	if tplErr != nil {
		var re *resolveError
		switch {
		case apierrors.IsNotFound(tplErr):
			r.setCondition(s, labsv1.ConditionTemplateResolved, metav1.ConditionFalse, ReasonTemplateNotFound,
				fmt.Sprintf("LabTemplate %q not found", s.Spec.TemplateRef.Name))
			r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonTemplateNotFound, "waiting for template")
			// The provisioning deadline covers waiting for the template too.
			if res, failed := r.checkProvisionDeadline(s); failed {
				return res, nil
			}
			return r.requeueBeforeExpiry(s, requeueTemplateWait), nil
		case errors.As(tplErr, &re):
			r.setCondition(s, labsv1.ConditionTemplateResolved, metav1.ConditionFalse, ReasonResolveFailed, tplErr.Error())
			return r.fail(s, ReasonResolveFailed, tplErr.Error()), nil
		default:
			return ctrl.Result{}, tplErr
		}
	}
	// Record what is about to be provisioned before provisioning anything,
	// so teardown works even if the template disappears later.
	if snap := snapshotTopology(st.Topology, &tpl.spec.Topology); !apiequality.Semantic.DeepEqual(snap, st.Topology) {
		st.Topology = snap
		if err := save(ctx); err != nil {
			return ctrl.Result{}, err
		}
	}

	st.ResolvedParams = tpl.values
	st.EntryNode = tpl.spec.Topology.Entry
	r.setCondition(s, labsv1.ConditionTemplateResolved, metav1.ConditionTrue, ReasonResolved, "template found and params resolved")
	r.sandboxCondition(s, tpl.sandbox)

	// Exam time is up: freeze the session for the learner (endpoints
	// withdrawn, learner processes ended) while it keeps running for grading.
	// A failure (node not reachable yet) is retried after this pass.
	var revokeErr error
	if accessRevoked(s) {
		revokeErr = r.revokeAccess(ctx, s, tpl)
	}
	res, err := r.reconcileNodes(ctx, s, tpl, save)
	if err == nil && revokeErr != nil {
		return ctrl.Result{RequeueAfter: requeueProvisioning}, nil
	}
	return res, err
}

// reconcileNodes is the part of reconcileSession after the template was
// resolved: hibernate/resume, reset, provisioning, setup, endpoints, grading.
func (r *LabSessionReconciler) reconcileNodes(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate, save saveFunc) (ctrl.Result, error) {
	st := &s.Status
	now := r.now()
	if s.Spec.Hibernate {
		return r.hibernate(ctx, s, tpl)
	}
	if st.Hibernated {
		st.Hibernated = false
		if st.Phase == labsv1.SessionHibernated {
			st.Phase = labsv1.SessionProvisioning
		}
		// Resuming is not a reset: hibernated nodes come back with their
		// state (persistent disks, the learner's home volume), so a new
		// backing instance must not re-run setup over the learner's work.
		// Forgetting the instance ids makes the next observation the
		// baseline again. This covers every node, also those still stopping
		// when the resume arrived; nodes that kept running report the same
		// instance anyway.
		for i := range st.Nodes {
			st.Nodes[i].InstanceID = ""
		}
		r.setCondition(s, labsv1.ConditionHibernated, metav1.ConditionFalse, ReasonAwake, "session resumed")
		r.startProvisioning(s, true)
		r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonProvisioning, "resuming nodes")
		r.event(s, "Normal", ReasonAwake, "resuming hibernated nodes")
	}

	// One provisioning attempt (creation, reset, resume, replaced node) has
	// a deadline across all its stages: a reset still in progress, topology,
	// capacity, nodes, setup.
	if res, failed := r.checkProvisionDeadline(s); failed {
		return res, nil
	}

	// Spec-driven reset: reset every node and run setup again.
	if s.Spec.ResetGeneration > st.ObservedResetGeneration {
		if err := r.resetNodes(ctx, s, tpl); err != nil {
			if drivers.IsPermanent(err) {
				st.ObservedResetGeneration = s.Spec.ResetGeneration
				return r.fail(s, ReasonResetFailed, err.Error()), nil
			}
			r.rearmSetup(s, ReasonResetRequested, "lab reset in progress: "+err.Error())
			if errors.Is(err, drivers.ErrInProgress) {
				return ctrl.Result{RequeueAfter: requeueTeardown}, nil
			}
			return ctrl.Result{}, err
		}
		st.ObservedResetGeneration = s.Spec.ResetGeneration
		r.rearmSetup(s, ReasonResetRequested, "lab reset requested")
		if err := save(ctx); err != nil {
			return ctrl.Result{}, err
		}
	}

	// Session-scoped resources (links, shared networks) come first.
	if res, done, err := r.provisionTopology(ctx, s, tpl); !done {
		return res, err
	}

	// Provision every node (idempotent).
	nodes := make([]labsv1.NodeStatus, 0, len(tpl.spec.Topology.Nodes))
	allReady := true
	var unscheduled []string
	var transient error
	for _, n := range tpl.spec.Topology.Nodes {
		ns := labsv1.NodeStatus{Name: n.Name, Driver: n.Driver}
		prev, _ := findNodeStatus(st.Nodes, n.Name)
		d, err := r.Drivers.Get(n.Driver)
		var state drivers.NodeState
		if err == nil {
			state, err = d.Provision(ctx, r.ref(s, tpl, n))
		}
		switch {
		case err != nil && drivers.IsPermanent(err):
			ns.Phase, ns.Message = labsv1.NodeFailed, err.Error()
			nodes = append(nodes, ns)
			st.Nodes = mergeNodes(nodes, tpl.spec.Topology.Nodes)
			r.setCondition(s, labsv1.ConditionNodesReady, metav1.ConditionFalse, ReasonNodeFailed, fmt.Sprintf("node %s: %v", n.Name, err))
			r.event(s, "Warning", ReasonNodeFailed, fmt.Sprintf("node %s: %v", n.Name, err))
			return r.fail(s, ReasonNodeFailed, fmt.Sprintf("node %s: %v", n.Name, err)), nil
		case err != nil:
			ns.Phase, ns.Message, ns.InstanceID = labsv1.NodeProvisioning, err.Error(), prev.InstanceID
			transient = errors.Join(transient, fmt.Errorf("node %s: %w", n.Name, err))
			allReady = false
		case state.Phase == labsv1.NodeFailed:
			ns.Phase, ns.Message = state.Phase, state.Message
			nodes = append(nodes, ns)
			st.Nodes = mergeNodes(nodes, tpl.spec.Topology.Nodes)
			msg := fmt.Sprintf("node %s failed: %s", n.Name, state.Message)
			r.setCondition(s, labsv1.ConditionNodesReady, metav1.ConditionFalse, ReasonNodeFailed, msg)
			return r.fail(s, ReasonNodeFailed, msg), nil
		default:
			ns.Phase, ns.Message, ns.Details = state.Phase, state.Message, state.Details
			ns.InstanceID = state.InstanceID
			if ns.InstanceID == "" {
				ns.InstanceID = prev.InstanceID
			}
			if state.Phase != labsv1.NodeReady {
				allReady = false
			}
			if state.Unscheduled {
				unscheduled = append(unscheduled, n.Name)
			}
		}
		// A recreated node (new pod, restarted container, replaced VM) lost
		// whatever setup did to it: run setup again.
		if prev.InstanceID != "" && ns.InstanceID != prev.InstanceID && setupStarted(s) {
			msg := fmt.Sprintf("node %s was recreated (%s -> %s); re-running setup", n.Name, prev.InstanceID, ns.InstanceID)
			r.rearmSetup(s, ReasonNodeReplaced, msg)
			r.event(s, "Warning", ReasonNodeReplaced, msg)
		}
		nodes = append(nodes, ns)
	}
	st.Nodes = nodes

	// Give the entry node access to everything that is already reachable
	// (cluster drivers need it to observe their clusters), and hold the
	// session back until every node's access is wired.
	wireMsg := ""
	if r.Session != nil {
		done, msg, err := r.Session.WireEntry(ctx, drivers.SessionRef{Session: s, Template: tpl.spec})
		switch {
		case err != nil && drivers.IsPermanent(err):
			return r.fail(s, ReasonNodeFailed, fmt.Sprintf("entry wiring: %v", err)), nil
		case err != nil:
			transient = errors.Join(transient, fmt.Errorf("entry wiring: %w", err))
			allReady = false
		case !done:
			wireMsg = msg
			allReady = false
		}
	}

	if !allReady {
		if st.Phase != labsv1.SessionGrading {
			st.Phase = labsv1.SessionProvisioning
		}
		// A session that was ready lost a node (a pod deleted by a node
		// drain, an evicted VMI) and the driver brings it back: that is a
		// new provisioning attempt, bounded by the session-level deadline
		// even while the replacement waits for capacity (no-op while an
		// attempt is already running).
		r.startProvisioning(s, false)
		summary := notReadySummary(nodes)
		if wireMsg != "" && strings.HasSuffix(summary, ": ") {
			summary = wireMsg
		} else if wireMsg != "" {
			summary += "; " + wireMsg
		}
		r.setCondition(s, labsv1.ConditionNodesReady, metav1.ConditionFalse, ReasonProvisioning, summary)
		r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonProvisioning, "nodes are provisioning")
		// A node waiting for a cluster node (the autoscaler scaling a lab
		// pool up from zero) does not use up the node provision timeout:
		// it counts from when every node was scheduled. The session-level
		// deadline still bounds the wait.
		if len(unscheduled) > 0 {
			r.setCondition(s, labsv1.ConditionNodesScheduled, metav1.ConditionFalse, ReasonWaitingCapacity,
				"waiting for a cluster node to run on: "+strings.Join(unscheduled, ", "))
		} else {
			r.setCondition(s, labsv1.ConditionNodesScheduled, metav1.ConditionTrue, ReasonScheduled, "every node is scheduled")
			if since, ok := r.nodeTimeoutStart(s); ok && now.Sub(since) > r.provisionTimeout() {
				msg := fmt.Sprintf("nodes not ready after %s: %s", r.provisionTimeout(), summary)
				r.event(s, "Warning", ReasonProvisionTimeout, msg)
				return r.fail(s, ReasonProvisionTimeout, msg), nil
			}
		}
		if transient != nil {
			return ctrl.Result{}, transient
		}
		return r.requeueBeforeExpiry(s, requeueProvisioning), nil
	}
	r.setCondition(s, labsv1.ConditionNodesReady, metav1.ConditionTrue, ReasonNodesReady, "all nodes are ready")
	r.setCondition(s, labsv1.ConditionNodesScheduled, metav1.ConditionTrue, ReasonScheduled, "every node is scheduled")

	// Setup runs once per node incarnation; progress is persisted per action.
	if !meta.IsStatusConditionTrue(st.Conditions, labsv1.ConditionSetupComplete) {
		if st.Phase != labsv1.SessionGrading {
			st.Phase = labsv1.SessionProvisioning
		}
		st.Endpoints = nil
		if err := r.runSetup(ctx, s, tpl, save); err != nil {
			if errors.Is(err, errSetupYield) {
				// Slice used up, or the session changed (deletion,
				// hibernate, reset): continue on the next reconcile.
				return ctrl.Result{RequeueAfter: requeueSetupStep}, nil
			}
			if drivers.IsPermanent(err) || errors.Is(err, errActionFailed) {
				r.setCondition(s, labsv1.ConditionSetupComplete, metav1.ConditionFalse, ReasonSetupFailed, err.Error())
				return r.fail(s, ReasonSetupFailed, err.Error()), nil
			}
			r.setCondition(s, labsv1.ConditionSetupComplete, metav1.ConditionFalse, ReasonSetupPending, err.Error())
			return ctrl.Result{}, err
		}
		r.setCondition(s, labsv1.ConditionSetupComplete, metav1.ConditionTrue, ReasonSetupComplete,
			fmt.Sprintf("%d setup action(s) completed", len(tpl.spec.Setup)))
	}

	// Expected answers computed from the session (answer.compute) once setup
	// is done; recomputed after a reset or a replaced node (rearmSetup).
	if !answersComputed(s, tpl.spec) {
		vals, err := ComputeAnswers(ctx, &NodeExecutor{Drivers: r.Drivers, Session: s, Template: tpl.spec}, tpl.spec)
		if err != nil {
			if drivers.IsPermanent(err) || errors.Is(err, errActionFailed) {
				r.setCondition(s, labsv1.ConditionSetupComplete, metav1.ConditionFalse, ReasonSetupFailed, err.Error())
				return r.fail(s, ReasonSetupFailed, err.Error()), nil
			}
			return ctrl.Result{}, err
		}
		st.ComputedAnswers = vals
		if err := save(ctx); err != nil {
			return ctrl.Result{}, err
		}
	}

	// Endpoints for every declared access point.
	var eps []labsv1.Endpoint
	for _, n := range tpl.spec.Topology.Nodes {
		d, err := r.Drivers.Get(n.Driver)
		if err != nil {
			return r.fail(s, ReasonNodeFailed, err.Error()), nil
		}
		for _, a := range n.Access {
			ep, err := d.Connect(ctx, r.ref(s, tpl, n), a)
			if err != nil {
				if drivers.IsPermanent(err) {
					msg := fmt.Sprintf("node %s %s access: %v", n.Name, a, err)
					return r.fail(s, ReasonNodeFailed, msg), nil
				}
				return ctrl.Result{}, err
			}
			eps = append(eps, ep)
		}
	}
	st.Endpoints = eps
	if accessRevoked(s) {
		st.Endpoints = nil
	}

	if st.Phase != labsv1.SessionGrading {
		st.Phase = labsv1.SessionReady
	}
	if st.ReadyAt == nil {
		t := metav1.NewTime(now)
		st.ReadyAt = &t
		r.event(s, "Normal", ReasonReady, "lab session is ready")
	}
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionTrue, ReasonReady, "lab session is ready")
	r.setCondition(s, labsv1.ConditionProvisioned, metav1.ConditionTrue, ReasonReady, "lab session is ready")
	if gradingRequested(s) && r.gradingStillRequested(ctx, s) {
		if err := r.grade(ctx, s, tpl, save); err != nil {
			return ctrl.Result{}, err
		}
	}
	// Re-observe a Ready session periodically: VMIs, vcluster workloads and
	// nodes of other drivers are not watched, so a crashed VM or a dead
	// control plane would otherwise go unnoticed until expiry.
	return r.requeueBeforeExpiry(s, jitter(durationOr(r.ReadyRecheck, DefaultReadyRecheck), s.UID)), nil
}

// jitter spreads d over [0.8d, 1.2d] by the session UID, so the Ready
// rechecks of a class that became ready together do not run in lockstep
// (and do not burst the API server through the uncached driver reads).
// The offset is stable per session; d = 0 stays 0.
func jitter(d time.Duration, uid types.UID) time.Duration {
	if d <= 0 {
		return d
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(uid))
	frac := float64(h.Sum32()%1001)/1000*0.4 - 0.2 // [-0.2, 0.2]
	return d + time.Duration(frac*float64(d))
}

// checkProvisionDeadline starts the provisioning clock of a session that
// has none and fails a session whose current provisioning attempt
// (Provisioned False) is older than the provisioning deadline.
func (r *LabSessionReconciler) checkProvisionDeadline(s *labsv1.LabSession) (ctrl.Result, bool) {
	st := &s.Status
	c := meta.FindStatusCondition(st.Conditions, labsv1.ConditionProvisioned)
	if c == nil {
		r.setCondition(s, labsv1.ConditionProvisioned, metav1.ConditionFalse, ReasonInProgress, "provisioning")
		return ctrl.Result{}, false
	}
	d := durationOr(r.ProvisionDeadline, DefaultProvisionDeadline)
	if d <= 0 || c.Status != metav1.ConditionFalse || r.now().Sub(c.LastTransitionTime.Time) <= d {
		return ctrl.Result{}, false
	}
	msg := fmt.Sprintf("the lab was not ready within %s", d)
	for _, typ := range []string{labsv1.ConditionNodesReady, labsv1.ConditionSetupComplete, labsv1.ConditionReady} {
		if cc := meta.FindStatusCondition(st.Conditions, typ); cc != nil && cc.Status == metav1.ConditionFalse && cc.Message != "" {
			msg += ": " + cc.Message
			break
		}
	}
	r.event(s, corev1.EventTypeWarning, ReasonProvisionDeadline, msg)
	return r.fail(s, ReasonProvisionDeadline, msg), true
}

// nodeTimeoutStart is when the node provision timeout started: when the
// nodes stopped being ready, or later, when the last unscheduled node got
// a cluster node.
func (r *LabSessionReconciler) nodeTimeoutStart(s *labsv1.LabSession) (time.Time, bool) {
	c := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionNodesReady)
	if c == nil {
		return time.Time{}, false
	}
	since := c.LastTransitionTime.Time
	if sc := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionNodesScheduled); sc != nil &&
		sc.Status == metav1.ConditionTrue && sc.LastTransitionTime.After(since) {
		since = sc.LastTransitionTime.Time
	}
	return since, true
}

// startProvisioning starts a new provisioning attempt: the session-level
// deadline counts from now. A session that is already provisioning keeps
// its attempt (a reset in progress does not extend the deadline) unless
// force is set (a resume).
func (r *LabSessionReconciler) startProvisioning(s *labsv1.LabSession, force bool) {
	c := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionProvisioned)
	if c != nil && c.Status == metav1.ConditionFalse && !force {
		return
	}
	meta.RemoveStatusCondition(&s.Status.Conditions, labsv1.ConditionProvisioned)
	r.setCondition(s, labsv1.ConditionProvisioned, metav1.ConditionFalse, ReasonInProgress, "provisioning")
}

// setupInFlight reports a session whose setup may be running in slices:
// setup is not complete and the session is still live. The first slice runs
// in the reconcile that flips NodesReady to True, so the cache can still
// show NodesReady False (or no conditions at all) and progress 0 after that
// slice was written: neither NodesReady nor SetupProgress tells, so every
// session that has not completed setup is read uncached.
func setupInFlight(s *labsv1.LabSession) bool {
	return s.DeletionTimestamp.IsZero() && s.Status.Phase != labsv1.SessionFailed && s.Status.Phase != labsv1.SessionExpired &&
		!meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionSetupComplete)
}

// keepFailed reports a failed session that keeps its resources until expiry.
func keepFailed(s *labsv1.LabSession) bool {
	// labctl verify labels its sessions with any value (true, batch,
	// networking, platform4, ...): the key marks a verify session.
	_, verify := s.Labels[LabelVerifySession]
	return s.Annotations[AnnotationKeepFailed] == "true" || verify
}

// releaseFailed tears a failed session's resources down once the grace
// period after the failure is over; the session stays Failed until it
// expires.
func (r *LabSessionReconciler) releaseFailed(ctx context.Context, s *labsv1.LabSession) (ctrl.Result, error) {
	grace := durationOr(r.FailedRelease, DefaultFailedRelease)
	c := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionResourcesReleased)
	switch {
	case c != nil && c.Status == metav1.ConditionTrue:
		return r.requeueBeforeExpiry(s, 0), nil
	case grace <= 0 || keepFailed(s):
		r.setCondition(s, labsv1.ConditionResourcesReleased, metav1.ConditionFalse, ReasonKeptForDebugging,
			"the failed session keeps its resources until it expires")
		return r.requeueBeforeExpiry(s, 0), nil
	case c == nil:
		// A session that failed before this condition existed: start now.
		r.markFailed(s)
		c = meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionResourcesReleased)
	}
	if left := grace - r.now().Sub(c.LastTransitionTime.Time); left > 0 {
		return r.requeueBeforeExpiry(s, left), nil
	}
	if err := r.teardown(ctx, s); err != nil {
		if errors.Is(err, drivers.ErrInProgress) {
			return r.requeueBeforeExpiry(s, requeueTeardown), nil
		}
		return ctrl.Result{}, err
	}
	for i := range s.Status.Nodes {
		s.Status.Nodes[i].Phase = labsv1.NodeDestroyed
		s.Status.Nodes[i].Details = nil
	}
	s.Status.Endpoints = nil
	r.setCondition(s, labsv1.ConditionResourcesReleased, metav1.ConditionTrue, ReasonReleased, "the failed session's resources were released")
	r.event(s, corev1.EventTypeNormal, ReasonReleased, "failed lab session: resources released")
	return r.requeueBeforeExpiry(s, 0), nil
}

// markFailed records when the session failed (ResourcesReleased False).
func (r *LabSessionReconciler) markFailed(s *labsv1.LabSession) {
	if meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionResourcesReleased) != nil {
		return
	}
	r.setCondition(s, labsv1.ConditionResourcesReleased, metav1.ConditionFalse, ReasonReleasePending,
		"the failed session's resources are released after a grace period")
}

// collectExpired deletes an Expired session object once the retention is
// over (its resources are already gone; the finalizer's teardown is a no-op).
// The orphan sweep cannot race it: a session being deleted is still listed
// until its finalizer is released, and only after that are any leftover
// cluster-scoped objects (vcluster namespaces, VPCs) orphans.
func (r *LabSessionReconciler) collectExpired(ctx context.Context, s *labsv1.LabSession) (ctrl.Result, error) {
	keep := durationOr(r.ExpiredRetention, DefaultExpiredRetention)
	if keep <= 0 {
		return ctrl.Result{}, nil
	}
	since := s.CreationTimestamp.Time
	if c := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionExpired); c != nil && c.Status == metav1.ConditionTrue {
		since = c.LastTransitionTime.Time
	}
	if left := keep - r.now().Sub(since); left > 0 {
		return ctrl.Result{RequeueAfter: left}, nil
	}
	if err := r.Delete(ctx, s); err != nil && !apierrors.IsNotFound(err) {
		return ctrl.Result{}, err
	}
	logf.FromContext(ctx).Info("expired lab session deleted after its retention", "retention", keep.String())
	return ctrl.Result{}, nil
}

func (r *LabSessionReconciler) provisionTimeout() time.Duration {
	if r.ProvisionTimeout > 0 {
		return r.ProvisionTimeout
	}
	return DefaultProvisionTimeout
}

// setupStarted reports whether any setup action has run on the current nodes.
func setupStarted(s *labsv1.LabSession) bool {
	return s.Status.SetupProgress > 0 || meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionSetupComplete)
}

// rearmSetup makes setup run again from the first action.
func (r *LabSessionReconciler) rearmSetup(s *labsv1.LabSession, reason, msg string) {
	s.Status.SetupProgress = 0
	s.Status.Endpoints = nil
	s.Status.ComputedAnswers = nil
	r.startProvisioning(s, false)
	r.setCondition(s, labsv1.ConditionSetupComplete, metav1.ConditionFalse, reason, msg)
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, reason, msg)
	if s.Status.Phase != labsv1.SessionGrading {
		s.Status.Phase = labsv1.SessionProvisioning
	}
}

// resetNodes resets every node through its driver.
func (r *LabSessionReconciler) resetNodes(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) error {
	for _, n := range tpl.spec.Topology.Nodes {
		d, err := r.Drivers.Get(n.Driver)
		if err != nil {
			return err
		}
		if err := d.Reset(ctx, r.ref(s, tpl, n)); err != nil {
			return fmt.Errorf("reset node %s: %w", n.Name, err)
		}
	}
	r.event(s, "Normal", ReasonResetRequested, "lab nodes reset")
	return nil
}

// provisionTopology runs ProvisionTopology for every driver of the topology
// that has session-scoped resources. done=false means the caller must return
// (res, err) now.
func (r *LabSessionReconciler) provisionTopology(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) (ctrl.Result, bool, error) {
	tps := r.topologyProvisioners(&tpl.spec.Topology)
	if r.Session != nil {
		tps = append([]drivers.TopologyProvisioner{r.Session}, tps...)
	}
	for _, tp := range tps {
		ready, err := tp.ProvisionTopology(ctx, drivers.SessionRef{Session: s, Template: tpl.spec})
		switch {
		case err != nil && drivers.IsPermanent(err):
			return r.fail(s, ReasonNodeFailed, fmt.Sprintf("topology: %v", err)), false, nil
		case err != nil:
			return ctrl.Result{}, false, fmt.Errorf("topology: %w", err)
		case !ready:
			if s.Status.Phase != labsv1.SessionGrading {
				s.Status.Phase = labsv1.SessionProvisioning
			}
			r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonProvisioning, "topology is provisioning")
			return r.requeueBeforeExpiry(s, requeueProvisioning), false, nil
		}
		// Link facts (segments, per-end interfaces/addresses) for grader and UI.
		if lr, ok := tp.(drivers.LinkReporter); ok {
			if links, err := lr.Links(drivers.SessionRef{Session: s, Template: tpl.spec}); err == nil && len(links) > 0 {
				s.Status.Links = links
			}
		}
	}
	return ctrl.Result{}, true, nil
}

// topologyProvisioners returns, once each and in topology order, the drivers
// of topo that implement TopologyProvisioner.
func (r *LabSessionReconciler) topologyProvisioners(topo *labsv1.Topology) []drivers.TopologyProvisioner {
	var out []drivers.TopologyProvisioner
	seen := map[labsv1.DriverName]bool{}
	for _, n := range topo.Nodes {
		if seen[n.Driver] {
			continue
		}
		seen[n.Driver] = true
		d, err := r.Drivers.Get(n.Driver)
		if err != nil {
			continue
		}
		if tp, ok := d.(drivers.TopologyProvisioner); ok {
			out = append(out, tp)
		}
	}
	return out
}

// expire destroys all node resources and only then marks the session Expired.
func (r *LabSessionReconciler) expire(ctx context.Context, s *labsv1.LabSession) (ctrl.Result, error) {
	if err := r.teardown(ctx, s); err != nil {
		if errors.Is(err, drivers.ErrInProgress) {
			r.setCondition(s, labsv1.ConditionExpired, metav1.ConditionFalse, ReasonExpiring, "teardown in progress: "+err.Error())
			return ctrl.Result{RequeueAfter: requeueTeardown}, nil
		}
		r.setCondition(s, labsv1.ConditionExpired, metav1.ConditionFalse, ReasonExpiring, "teardown failed: "+err.Error())
		return ctrl.Result{}, err
	}
	for i := range s.Status.Nodes {
		s.Status.Nodes[i].Phase = labsv1.NodeDestroyed
		s.Status.Nodes[i].Message = ""
		s.Status.Nodes[i].Details = nil
	}
	s.Status.Phase = labsv1.SessionExpired
	s.Status.Endpoints = nil
	r.rejectGrading(s, "the lab session expired; it cannot be graded")
	r.setCondition(s, labsv1.ConditionExpired, metav1.ConditionTrue, ReasonExpired, "session passed its expiry; resources released")
	// Usage metering (gateway sessions/usage.ts) ends a lab that went
	// Ready=False before it expired at that transition. NamespaceNotLab
	// sets Ready False while the lab keeps running: the lab stopped only
	// now, so the transition is stamped now.
	if c := meta.FindStatusCondition(s.Status.Conditions, labsv1.ConditionReady); c != nil && c.Reason == ReasonNamespaceNotLab {
		meta.RemoveStatusCondition(&s.Status.Conditions, labsv1.ConditionReady)
	}
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonExpired, "session expired")
	r.event(s, "Normal", ReasonExpired, "lab session expired")
	return ctrl.Result{}, nil
}

// hibernate releases compute for drivers that support it and withdraws endpoints.
func (r *LabSessionReconciler) hibernate(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) (ctrl.Result, error) {
	st := &s.Status
	nodes := mergeNodes(st.Nodes, tpl.spec.Topology.Nodes)
	settled := true
	for i, n := range tpl.spec.Topology.Nodes {
		d, err := r.Drivers.Get(n.Driver)
		if err != nil {
			continue
		}
		h, ok := d.(drivers.Hibernator)
		if !ok {
			continue // the node keeps running
		}
		ref := r.ref(s, tpl, n)
		if err := h.Hibernate(ctx, ref); err != nil {
			if errors.Is(err, drivers.ErrUnsupported) {
				continue // this node keeps running (e.g. netdev, ephemeral VM disks)
			}
			if drivers.IsPermanent(err) {
				nodes[i].Message = fmt.Sprintf("hibernate: %v", err)
				continue
			}
			if errors.Is(err, drivers.ErrInProgress) {
				settled = false
				nodes[i].Message = err.Error()
				continue
			}
			return ctrl.Result{}, err
		}
		state, err := d.Status(ctx, ref)
		if err != nil {
			if !drivers.IsPermanent(err) {
				return ctrl.Result{}, err
			}
			state = drivers.NodeState{Phase: labsv1.NodeHibernated}
		}
		nodes[i].Phase, nodes[i].Message = state.Phase, state.Message
		if state.Phase != labsv1.NodeHibernated {
			settled = false
		}
	}
	st.Nodes = nodes
	st.Hibernated = true
	st.Endpoints = nil
	if st.Phase != labsv1.SessionGrading {
		st.Phase = labsv1.SessionHibernated
	}
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonHibernated, "session is hibernated")
	if !settled {
		r.setCondition(s, labsv1.ConditionHibernated, metav1.ConditionFalse, ReasonHibernating, "nodes are stopping")
		return r.requeueBeforeExpiry(s, requeueProvisioning), nil
	}
	r.setCondition(s, labsv1.ConditionHibernated, metav1.ConditionTrue, ReasonHibernated, "session is hibernated")
	return r.requeueBeforeExpiry(s, 0), nil
}

// teardown destroys every node recorded in status.topology (falling back to
// the live template only if nothing was recorded), then session-scoped
// topology resources. Errors keep the caller from releasing the session.
func (r *LabSessionReconciler) teardown(ctx context.Context, s *labsv1.LabSession) error {
	if err := r.deletePooled(ctx, s); err != nil {
		return err
	}
	spec := &labsv1.LabTemplateSpec{}
	switch {
	case s.Status.Topology != nil:
		spec.Topology = *s.Status.Topology
	default:
		tpl, err := r.template(ctx, s)
		var re *resolveError
		if apierrors.IsNotFound(err) || errors.As(err, &re) {
			return nil // nothing was ever provisioned from it
		}
		if err != nil {
			return err
		}
		spec = tpl.spec
	}
	var errs error
	for _, n := range spec.Topology.Nodes {
		d, err := r.Drivers.Get(n.Driver)
		if err != nil {
			continue
		}
		ref := drivers.NodeRef{Session: s, Template: spec, Node: n}
		if err := d.Destroy(ctx, ref); err != nil && !drivers.IsPermanent(err) {
			errs = errors.Join(errs, fmt.Errorf("destroy node %s: %w", n.Name, err))
		}
	}
	if errs != nil {
		return errs
	}
	tps := r.topologyProvisioners(&spec.Topology)
	if r.Session != nil {
		tps = append(tps, r.Session)
	}
	for _, tp := range tps {
		if err := tp.DestroyTopology(ctx, drivers.SessionRef{Session: s, Template: spec}); err != nil && !drivers.IsPermanent(err) {
			errs = errors.Join(errs, fmt.Errorf("destroy topology: %w", err))
		}
	}
	return errs
}

// snapshotTopology returns the topology to record: the template's, plus any
// previously recorded nodes the template no longer has (so they are still
// torn down).
func snapshotTopology(recorded, current *labsv1.Topology) *labsv1.Topology {
	out := current.DeepCopy()
	if recorded != nil {
		for _, n := range recorded.Nodes {
			if _, ok := findNode(out.Nodes, n.Name); !ok {
				out.Nodes = append(out.Nodes, *n.DeepCopy())
			}
		}
	}
	return out
}

func findNodeStatus(nodes []labsv1.NodeStatus, name string) (labsv1.NodeStatus, bool) {
	for _, n := range nodes {
		if n.Name == name {
			return n, true
		}
	}
	return labsv1.NodeStatus{}, false
}

// runSetup executes the setup actions not yet completed, persisting
// status.setupProgress after each, so a retry resumes after the last
// completed action. Setup actions must still be idempotent: an action whose
// result could not be persisted, or every action after a node was recreated
// or reset, runs again.
//
// Setup runs in slices: once SetupSlice is used up, or when the session was
// deleted, asked to hibernate or reset meanwhile, it returns errSetupYield
// before the next action and the caller requeues. A class burst of long
// setups then does not keep teardown, expiry and grading of other sessions
// waiting for a worker, and ending a lab during setup waits for one action
// at most.
func (r *LabSessionReconciler) runSetup(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate, save saveFunc) error {
	total := len(tpl.spec.Setup)
	first, start := int(s.Status.SetupProgress), r.now()
	slice := durationOr(r.SetupSlice, DefaultSetupSlice)
	for i := first; i < total; i++ {
		if i > first && (r.now().Sub(start) >= slice || r.sessionChanged(ctx, s)) {
			return errSetupYield
		}
		if err := r.runAction(ctx, s, tpl, i, tpl.spec.Setup[i]); err != nil {
			return err
		}
		s.Status.SetupProgress = int32(i + 1)
		r.setCondition(s, labsv1.ConditionSetupComplete, metav1.ConditionFalse, ReasonSetupPending,
			fmt.Sprintf("%d/%d setup action(s) completed", i+1, total))
		if err := save(ctx); err != nil {
			return err
		}
	}
	return nil
}

var errActionFailed = errors.New("action failed")

// errSetupYield: setup stopped between two actions and continues on the
// next reconcile.
var errSetupYield = errors.New("setup yields to the next reconcile")

// sessionChanged reports, from the API server (r.Reader), a session that was
// deleted, asked to hibernate or reset since this reconcile read it: setup
// stops before the next action instead of running to the end.
func (r *LabSessionReconciler) sessionChanged(ctx context.Context, s *labsv1.LabSession) bool {
	if r.Reader == nil {
		return false
	}
	fresh := &labsv1.LabSession{}
	if err := r.Reader.Get(ctx, client.ObjectKeyFromObject(s), fresh); err != nil {
		return apierrors.IsNotFound(err)
	}
	return !fresh.DeletionTimestamp.IsZero() || fresh.Spec.Hibernate != s.Spec.Hibernate ||
		fresh.Spec.ResetGeneration != s.Spec.ResetGeneration
}

// runAction executes one action through the owning node's driver.
func (r *LabSessionReconciler) runAction(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate, i int, a labsv1.Action) error {
	nodeName, _, _ := strings.Cut(a.On, "/")
	if _, ok := findNode(tpl.spec.Topology.Nodes, nodeName); !ok {
		return fmt.Errorf("action %d: unknown node %q: %w", i, a.On, errActionFailed)
	}
	ex := &NodeExecutor{Drivers: r.Drivers, Session: s, Template: tpl.spec}
	if _, err := ex.RunAction(ctx, a); err != nil {
		return fmt.Errorf("action %d %w", i, err)
	}
	return nil
}

// ActionRequest translates a lab action into a driver ExecRequest.
func ActionRequest(a labsv1.Action) drivers.ExecRequest {
	req := drivers.ExecRequest{User: a.As, Timeout: defaultActionTimeout}
	if req.User == "" {
		req.User = labsv1.ActionAsAdmin
	}
	if a.TimeoutSec > 0 {
		req.Timeout = time.Duration(a.TimeoutSec) * time.Second
	}
	if req.Timeout > maxActionTimeout {
		req.Timeout = maxActionTimeout
	}
	switch {
	case a.Run != nil:
		req.Kind, req.Command = drivers.ExecShell, []string{"/bin/sh", "-c", *a.Run}
	case a.Apply != nil:
		req.Kind, req.Stdin = drivers.ExecKubeApply, []byte(*a.Apply)
	case a.File != nil:
		script := `set -e; mkdir -p "$(dirname "$1")"; cat > "$1"`
		args := []string{"/bin/sh", "-c", script, "sh", a.File.Path}
		if a.File.Mode != "" {
			script += `; chmod "$2" "$1"`
			args = []string{"/bin/sh", "-c", script, "sh", a.File.Path, a.File.Mode}
		}
		req.Kind, req.Command, req.Stdin = drivers.ExecShell, args, []byte(a.File.Content)
	case a.Config != nil:
		req.Kind, req.Stdin = drivers.ExecDeviceConfig, []byte(*a.Config)
	}
	return req
}

func (r *LabSessionReconciler) ref(s *labsv1.LabSession, tpl *resolvedTemplate, n labsv1.Node) drivers.NodeRef {
	return drivers.NodeRef{Session: s, Template: tpl.spec, Node: n}
}

func (r *LabSessionReconciler) fail(s *labsv1.LabSession, reason, msg string) ctrl.Result {
	s.Status.Phase = labsv1.SessionFailed
	s.Status.Endpoints = nil
	r.markFailed(s)
	r.rejectGrading(s, "the lab session failed; it cannot be graded")
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, reason, msg)
	// Come back when the failed session's resources are to be released.
	var d time.Duration
	if g := durationOr(r.FailedRelease, DefaultFailedRelease); g > 0 && !keepFailed(s) {
		d = g
	}
	return r.requeueBeforeExpiry(s, d)
}

// requeueBeforeExpiry requeues after d (0 = no periodic requeue), but never
// later than the session's expiry.
func (r *LabSessionReconciler) requeueBeforeExpiry(s *labsv1.LabSession, d time.Duration) ctrl.Result {
	if s.Status.ExpiresAt != nil {
		until := s.Status.ExpiresAt.Sub(r.now())
		if until < time.Second {
			until = time.Second
		}
		if d == 0 || until < d {
			d = until
		}
	}
	return ctrl.Result{RequeueAfter: d}
}

func (r *LabSessionReconciler) setCondition(s *labsv1.LabSession, typ string, status metav1.ConditionStatus, reason, msg string) {
	meta.SetStatusCondition(&s.Status.Conditions, metav1.Condition{
		Type: typ, Status: status, Reason: reason, Message: msg,
		ObservedGeneration: s.Generation, LastTransitionTime: metav1.NewTime(r.now()),
	})
}

// expiry computes the absolute expiry: spec.expiresAt, else creation + TTL,
// else creation + max(2 * estimatedMinutes, MinDefaultTTL). Without a
// template it keeps a previously computed expiry, or falls back to
// creation + MinDefaultTTL, so every session eventually expires.
func expiry(s *labsv1.LabSession, tpl *resolvedTemplate) metav1.Time {
	if s.Spec.ExpiresAt != nil {
		return *s.Spec.ExpiresAt
	}
	ttl := MinDefaultTTL
	switch {
	case s.Spec.TTL != nil:
		ttl = s.Spec.TTL.Duration
	case tpl != nil:
		if d := 2 * time.Duration(tpl.spec.Source.EstimatedMinutes) * time.Minute; d > ttl {
			ttl = d
		}
	case s.Status.ExpiresAt != nil:
		return *s.Status.ExpiresAt
	}
	return metav1.NewTime(s.CreationTimestamp.Add(ttl))
}

func findNode(nodes []labsv1.Node, name string) (labsv1.Node, bool) {
	for _, n := range nodes {
		if n.Name == name {
			return n, true
		}
	}
	return labsv1.Node{}, false
}

// mergeNodes returns a status entry for every topology node, keeping known entries.
func mergeNodes(known []labsv1.NodeStatus, topo []labsv1.Node) []labsv1.NodeStatus {
	out := make([]labsv1.NodeStatus, 0, len(topo))
	for _, n := range topo {
		ns := labsv1.NodeStatus{Name: n.Name, Driver: n.Driver, Phase: labsv1.NodePending}
		for _, k := range known {
			if k.Name == n.Name {
				ns = k
				break
			}
		}
		out = append(out, ns)
	}
	return out
}

func notReadySummary(nodes []labsv1.NodeStatus) string {
	var parts []string
	for _, n := range nodes {
		if n.Phase != labsv1.NodeReady {
			p := fmt.Sprintf("%s=%s", n.Name, n.Phase)
			if n.Message != "" {
				p += " (" + n.Message + ")"
			}
			parts = append(parts, p)
		}
	}
	return "waiting for nodes: " + strings.Join(parts, ", ")
}

// statusEqual compares statuses ignoring condition transition times.
func statusEqual(a, b *labsv1.LabSessionStatus) bool {
	ac, bc := a.DeepCopy(), b.DeepCopy()
	for i := range ac.Conditions {
		ac.Conditions[i].LastTransitionTime = metav1.Time{}
	}
	for i := range bc.Conditions {
		bc.Conditions[i].LastTransitionTime = metav1.Time{}
	}
	return apiequality.Semantic.DeepEqual(ac, bc)
}

// SetupWithManager registers the reconciler; it watches owned Pods and
// Services (the manager's cache is restricted to the ones we label).
func (r *LabSessionReconciler) SetupWithManager(mgr ctrl.Manager) error {
	n := r.MaxConcurrentReconciles
	if n <= 0 {
		n = DefaultMaxConcurrentReconciles
	}
	return ctrl.NewControllerManagedBy(mgr).
		WithOptions(controller.Options{MaxConcurrentReconciles: n}).
		For(&labsv1.LabSession{}).
		Watches(&labsv1.LabSession{}, handler.EnqueueRequestsFromMapFunc(claimantOf)).
		Owns(&corev1.Pod{}).
		Owns(&corev1.Service{}).
		Named("labsession").
		Complete(r)
}
