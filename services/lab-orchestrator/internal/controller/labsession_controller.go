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
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
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
	defaultActionTimeout = 2 * time.Minute
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
}

// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions/finalizers,verbs=update
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labtemplates,verbs=get;list;watch
// +kubebuilder:rbac:groups="",resources=pods;services,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=pods/exec,verbs=create
// +kubebuilder:rbac:groups="",resources=events,verbs=create;patch

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
func (r *LabSessionReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := logf.FromContext(ctx)

	s := &labsv1.LabSession{}
	if err := r.Get(ctx, req.NamespacedName, s); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	tpl, tplErr := r.template(ctx, s)

	// Deletion: destroy node resources, then release the finalizer.
	if !s.DeletionTimestamp.IsZero() {
		if controllerutil.ContainsFinalizer(s, Finalizer) {
			if tpl != nil {
				if err := r.destroyAll(ctx, s, tpl); err != nil {
					return ctrl.Result{}, err
				}
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

	orig := s.Status.DeepCopy()
	res, err := r.reconcileSession(ctx, s, tpl, tplErr)
	s.Status.ObservedGeneration = s.Generation
	if !statusEqual(orig, &s.Status) {
		if uerr := r.Status().Update(ctx, s); uerr != nil {
			if apierrors.IsConflict(uerr) {
				return ctrl.Result{Requeue: true}, nil
			}
			return ctrl.Result{}, errors.Join(err, uerr)
		}
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

func (r *LabSessionReconciler) reconcileSession(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate, tplErr error) (ctrl.Result, error) {
	st := &s.Status
	if st.Phase == "" {
		st.Phase = labsv1.SessionPending
	}

	// Terminal phases: an expired session stays expired; resources are gone.
	if st.Phase == labsv1.SessionExpired {
		return ctrl.Result{}, nil
	}

	now := r.now()
	if tpl != nil || s.Spec.ExpiresAt != nil || s.Spec.TTL != nil {
		exp := expiry(s, tpl)
		st.ExpiresAt = &exp
	}
	if st.ExpiresAt != nil && !now.Before(st.ExpiresAt.Time) {
		return r.expire(ctx, s, tpl)
	}
	r.setCondition(s, labsv1.ConditionExpired, metav1.ConditionFalse, ReasonActive, "session has not expired")

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
		return r.requeueBeforeExpiry(s, 0), nil
	}

	st.ResolvedParams = tpl.values
	st.EntryNode = tpl.spec.Topology.Entry
	r.setCondition(s, labsv1.ConditionTemplateResolved, metav1.ConditionTrue, ReasonResolved, "template found and params resolved")

	if s.Spec.Hibernate {
		return r.hibernate(ctx, s, tpl)
	}
	if st.Hibernated {
		st.Hibernated = false
		r.setCondition(s, labsv1.ConditionHibernated, metav1.ConditionFalse, ReasonAwake, "session resumed")
		r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonProvisioning, "resuming nodes")
	}

	// Provision every node (idempotent).
	nodes := make([]labsv1.NodeStatus, 0, len(tpl.spec.Topology.Nodes))
	allReady := true
	var transient error
	for _, n := range tpl.spec.Topology.Nodes {
		ns := labsv1.NodeStatus{Name: n.Name, Driver: n.Driver}
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
			ns.Phase, ns.Message = labsv1.NodeProvisioning, err.Error()
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
			ns.Phase, ns.Message = state.Phase, state.Message
			if state.Phase != labsv1.NodeReady {
				allReady = false
			}
		}
		nodes = append(nodes, ns)
	}
	st.Nodes = nodes

	if !allReady {
		if st.Phase != labsv1.SessionGrading {
			st.Phase = labsv1.SessionProvisioning
		}
		r.setCondition(s, labsv1.ConditionNodesReady, metav1.ConditionFalse, ReasonProvisioning, notReadySummary(nodes))
		r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonProvisioning, "nodes are provisioning")
		if transient != nil {
			return ctrl.Result{}, transient
		}
		return r.requeueBeforeExpiry(s, requeueProvisioning), nil
	}
	r.setCondition(s, labsv1.ConditionNodesReady, metav1.ConditionTrue, ReasonNodesReady, "all nodes are ready")

	// Setup runs once per session.
	if !meta.IsStatusConditionTrue(st.Conditions, labsv1.ConditionSetupComplete) {
		if st.Phase != labsv1.SessionGrading {
			st.Phase = labsv1.SessionProvisioning
		}
		if err := r.runActions(ctx, s, tpl, tpl.spec.Setup); err != nil {
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
	return r.requeueBeforeExpiry(s, 0), nil
}

// expire destroys all node resources and marks the session Expired.
func (r *LabSessionReconciler) expire(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) (ctrl.Result, error) {
	if tpl != nil {
		if err := r.destroyAll(ctx, s, tpl); err != nil {
			return ctrl.Result{}, err
		}
		for i := range s.Status.Nodes {
			s.Status.Nodes[i].Phase = labsv1.NodeDestroyed
			s.Status.Nodes[i].Message = ""
		}
	}
	s.Status.Phase = labsv1.SessionExpired
	s.Status.Endpoints = nil
	r.setCondition(s, labsv1.ConditionExpired, metav1.ConditionTrue, ReasonExpired, "session passed its expiry; resources released")
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonExpired, "session expired")
	r.event(s, "Normal", ReasonExpired, "lab session expired")
	return ctrl.Result{}, nil
}

// hibernate releases compute for drivers that support it and withdraws endpoints.
func (r *LabSessionReconciler) hibernate(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) (ctrl.Result, error) {
	st := &s.Status
	nodes := mergeNodes(st.Nodes, tpl.spec.Topology.Nodes)
	for i, n := range tpl.spec.Topology.Nodes {
		d, err := r.Drivers.Get(n.Driver)
		if err != nil {
			continue
		}
		h, ok := d.(drivers.Hibernator)
		if !ok {
			continue // e.g. container nodes keep running (see ContainerDriver)
		}
		if err := h.Hibernate(ctx, r.ref(s, tpl, n)); err != nil {
			if drivers.IsPermanent(err) {
				nodes[i].Message = fmt.Sprintf("hibernate: %v", err)
				continue
			}
			return ctrl.Result{}, err
		}
		nodes[i].Phase, nodes[i].Message = labsv1.NodeHibernated, ""
	}
	st.Nodes = nodes
	st.Hibernated = true
	st.Endpoints = nil
	r.setCondition(s, labsv1.ConditionHibernated, metav1.ConditionTrue, ReasonHibernated, "session is hibernated")
	r.setCondition(s, labsv1.ConditionReady, metav1.ConditionFalse, ReasonHibernated, "session is hibernated")
	return r.requeueBeforeExpiry(s, 0), nil
}

func (r *LabSessionReconciler) destroyAll(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate) error {
	var errs error
	for _, n := range tpl.spec.Topology.Nodes {
		d, err := r.Drivers.Get(n.Driver)
		if err != nil {
			continue
		}
		if err := d.Destroy(ctx, r.ref(s, tpl, n)); err != nil && !drivers.IsPermanent(err) {
			errs = errors.Join(errs, fmt.Errorf("destroy node %s: %w", n.Name, err))
		}
	}
	return errs
}

var errActionFailed = errors.New("action failed")

// runActions executes actions in order through the owning node's driver.
func (r *LabSessionReconciler) runActions(ctx context.Context, s *labsv1.LabSession, tpl *resolvedTemplate, actions []labsv1.Action) error {
	for i, a := range actions {
		nodeName, member, _ := strings.Cut(a.On, "/")
		node, ok := findNode(tpl.spec.Topology.Nodes, nodeName)
		if !ok {
			return fmt.Errorf("action %d: unknown node %q: %w", i, a.On, errActionFailed)
		}
		d, err := r.Drivers.Get(node.Driver)
		if err != nil {
			return fmt.Errorf("action %d: %w", i, err)
		}
		req := ActionRequest(a)
		req.Member = member
		res, err := d.Exec(ctx, r.ref(s, tpl, node), req)
		if err != nil {
			return fmt.Errorf("action %d on %s: %w", i, a.On, err)
		}
		if res.ExitCode != 0 {
			return fmt.Errorf("action %d on %s exited %d: %s: %w", i, a.On, res.ExitCode,
				strings.TrimSpace(res.Stderr), errActionFailed)
		}
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
// else creation + max(2 * estimatedMinutes, MinDefaultTTL).
func expiry(s *labsv1.LabSession, tpl *resolvedTemplate) metav1.Time {
	if s.Spec.ExpiresAt != nil {
		return *s.Spec.ExpiresAt
	}
	ttl := MinDefaultTTL
	if s.Spec.TTL != nil {
		ttl = s.Spec.TTL.Duration
	} else if tpl != nil {
		if d := 2 * time.Duration(tpl.spec.Source.EstimatedMinutes) * time.Minute; d > ttl {
			ttl = d
		}
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
// Services and re-queues sessions when their template appears.
func (r *LabSessionReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&labsv1.LabSession{}).
		Owns(&corev1.Pod{}).
		Owns(&corev1.Service{}).
		Named("labsession").
		Complete(r)
}
