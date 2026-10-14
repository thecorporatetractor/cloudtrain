// Package controller contains the lab-orchestrator reconcilers.
package controller

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/record"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	logf "sigs.k8s.io/controller-runtime/pkg/log"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
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
)

// LabSessionReconciler walks a session's topology nodes through their
// drivers and maintains its status.
type LabSessionReconciler struct {
	client.Client
	Scheme   *runtime.Scheme
	Drivers  *drivers.Registry
	Recorder record.EventRecorder
	// Now is injectable for tests; defaults to time.Now.
	Now func() time.Time
	// ProvisionTimeout defaults to DefaultProvisionTimeout.
	ProvisionTimeout time.Duration
	// MaxConcurrentReconciles defaults to DefaultMaxConcurrentReconciles.
	// Setup actions run inside Reconcile, so this must be > 1 for one slow
	// session not to stall every other one.
	MaxConcurrentReconciles int
	// Session, when set, provisions session-scoped resources (keys, lab
	// network, entry isolation) before any node and wires the entry node
	// once the other nodes' access material exists.
	Session drivers.SessionProvisioner
	// Reader, when set, is an uncached reader (mgr.GetAPIReader()) used to
	// find a claimant's pooled session without cache lag.
	Reader client.Reader
	// Metrics, when set, counts warm pool claims.
	Metrics *PoolMetrics
}

// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions/finalizers,verbs=update
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labtemplates,verbs=get;list;watch
// +kubebuilder:rbac:groups="",resources=pods;services,verbs=get;list;watch;create;update;patch;delete;deletecollection
// Drivers: session Secrets, vcluster Helm releases (the chart's own objects
// and everything vcluster syncs into the session namespace), KubeVirt VMs and
// the Kube-OVN lab network. escalate/bind let the vcluster chart create its
// Roles without the manager holding every permission they grant.
// +kubebuilder:rbac:groups="",resources=secrets;configmaps;serviceaccounts;endpoints;persistentvolumeclaims,verbs=get;list;watch;create;update;patch;delete;deletecollection
// +kubebuilder:rbac:groups=apps,resources=statefulsets;deployments;replicasets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=rbac.authorization.k8s.io,resources=roles;rolebindings;clusterroles;clusterrolebindings,verbs=get;list;watch;create;update;patch;delete;escalate;bind
// +kubebuilder:rbac:groups=networking.k8s.io,resources=networkpolicies,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=policy,resources=poddisruptionbudgets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=discovery.k8s.io,resources=endpointslices,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=kubevirt.io,resources=virtualmachines;virtualmachineinstances,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=cdi.kubevirt.io,resources=datavolumes,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=kubeovn.io,resources=vpcs;subnets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=k8s.cni.cncf.io,resources=network-attachment-definitions,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=namespaces,verbs=get;list;watch;create;delete
// +kubebuilder:rbac:groups="",resources=pods/exec,verbs=create
// +kubebuilder:rbac:groups="",resources=nodes,verbs=get;list
// +kubebuilder:rbac:groups=node.k8s.io,resources=runtimeclasses,verbs=get
// +kubebuilder:rbac:groups="",resources=events,verbs=create;patch
// +kubebuilder:rbac:groups=events.k8s.io,resources=events,verbs=create;patch
// +kubebuilder:rbac:groups=coordination.k8s.io,resources=leases,verbs=get;list;watch;create;update;patch;delete
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
		r.Recorder.Event(obj, typ, reason, msg)
	}
}

// Reconcile drives one LabSession towards its desired state.
//
// Status is written with a JSON merge patch (no optimistic lock), so fields
// other writers own (e.g. phase Grading) survive and our own progress is
// never thrown away on a conflict.
func (r *LabSessionReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := logf.FromContext(ctx)

	s := &labsv1.LabSession{}
	if err := r.Get(ctx, req.NamespacedName, s); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	// Deletion: destroy node resources, then release the finalizer. Teardown
	// uses the topology recorded in status, never only the live template.
	if !s.DeletionTimestamp.IsZero() {
		if controllerutil.ContainsFinalizer(s, Finalizer) {
			if err := r.teardown(ctx, s); err != nil {
				if errors.Is(err, drivers.ErrInProgress) {
					log.V(1).Info("teardown in progress", "reason", err.Error())
					return ctrl.Result{RequeueAfter: requeueTeardown}, nil
				}
				return ctrl.Result{}, err
			}
			controllerutil.RemoveFinalizer(s, Finalizer)
			if err := r.Update(ctx, s); err != nil {
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
		log.Error(err, "reconcile failed", "phase", s.Status.Phase)
	}
	return res, err
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
	return &resolvedTemplate{spec: spec, values: values}, nil
}

type resolvedTemplate struct {
	spec   *labsv1.LabTemplateSpec
	values map[string]string
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
		return ctrl.Result{}, nil
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

	if tplErr != nil {
		var re *resolveError
		switch {
		case apierrors.IsNotFound(tplErr):
			r.setCondition(s, labsv1.ConditionTemplateResolved, metav1.ConditionFalse, ReasonTemplateNotFound,
				fmt.Sprintf("LabTemplate %q not found", s.Spec.TemplateRef.Name))
			r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonTemplateNotFound, "waiting for template")
			return r.requeueBeforeExpiry(s, requeueTemplateWait), nil
		case errors.As(tplErr, &re):
			r.setCondition(s, labsv1.ConditionTemplateResolved, metav1.ConditionFalse, ReasonResolveFailed, tplErr.Error())
			return r.fail(s, ReasonResolveFailed, tplErr.Error()), nil
		default:
			return ctrl.Result{}, tplErr
		}
	}
	if st.Phase == labsv1.SessionFailed {
		// Failed sessions keep their resources for inspection until expiry or deletion.
		r.rejectGrading(s, "the lab session failed; it cannot be graded")
		return r.requeueBeforeExpiry(s, 0), nil
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
		r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonProvisioning, "resuming nodes")
		r.event(s, "Normal", ReasonAwake, "resuming hibernated nodes")
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
		summary := notReadySummary(nodes)
		if wireMsg != "" && strings.HasSuffix(summary, ": ") {
			summary = wireMsg
		} else if wireMsg != "" {
			summary += "; " + wireMsg
		}
		r.setCondition(s, labsv1.ConditionNodesReady, metav1.ConditionFalse, ReasonProvisioning, summary)
		r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonProvisioning, "nodes are provisioning")
		if c := meta.FindStatusCondition(st.Conditions, labsv1.ConditionNodesReady); c != nil &&
			now.Sub(c.LastTransitionTime.Time) > r.provisionTimeout() {
			msg := fmt.Sprintf("nodes not ready after %s: %s", r.provisionTimeout(), summary)
			r.event(s, "Warning", ReasonProvisionTimeout, msg)
			return r.fail(s, ReasonProvisionTimeout, msg), nil
		}
		if transient != nil {
			return ctrl.Result{}, transient
		}
		return r.requeueBeforeExpiry(s, requeueProvisioning), nil
	}
	r.setCondition(s, labsv1.ConditionNodesReady, metav1.ConditionTrue, ReasonNodesReady, "all nodes are ready")

	// Setup runs once per node incarnation; progress is persisted per action.
	if !meta.IsStatusConditionTrue(st.Conditions, labsv1.ConditionSetupComplete) {
		if st.Phase != labsv1.SessionGrading {
			st.Phase = labsv1.SessionProvisioning
		}
		st.Endpoints = nil
		if err := r.runSetup(ctx, s, tpl, save); err != nil {
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

	if st.Phase != labsv1.SessionGrading {
		st.Phase = labsv1.SessionReady
	}
	if st.ReadyAt == nil {
		t := metav1.NewTime(now)
		st.ReadyAt = &t
		r.event(s, "Normal", ReasonReady, "lab session is ready")
	}
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionTrue, ReasonReady, "lab session is ready")
	if gradingRequested(s) {
		if err := r.grade(ctx, s, tpl, save); err != nil {
			return ctrl.Result{}, err
		}
	}
	return r.requeueBeforeExpiry(s, 0), nil
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
func (r *LabSessionReconciler) runSetup(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate, save saveFunc) error {
	total := len(tpl.spec.Setup)
	for i := int(s.Status.SetupProgress); i < total; i++ {
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
	r.rejectGrading(s, "the lab session failed; it cannot be graded")
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, reason, msg)
	return r.requeueBeforeExpiry(s, 0)
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
