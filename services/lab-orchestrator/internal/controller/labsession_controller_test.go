package controller

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/utils/ptr"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

const ns = "labs"

var t0 = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

// fakeDriver is a programmable NodeDriver.
type fakeDriver struct {
	mu       sync.Mutex
	name     labsv1.DriverName
	phase    map[string]labsv1.NodePhase // per node; default Ready
	provErr  map[string]error
	instance map[string]string // per node InstanceID
	execExit int
	// execErr fails the exec call with this (0-based) index.
	execErrAt  int
	execErr    error
	destroyErr error
	asleep     map[string]bool

	provisioned, destroyed, hibernated, resets []string
	execs                                      []drivers.ExecRequest
	execCalls                                  int
}

func newFakeDriver(name labsv1.DriverName) *fakeDriver {
	return &fakeDriver{name: name, phase: map[string]labsv1.NodePhase{}, provErr: map[string]error{},
		instance: map[string]string{}, asleep: map[string]bool{}, execErrAt: -1}
}

func (f *fakeDriver) Name() labsv1.DriverName { return f.name }

func (f *fakeDriver) Provision(_ context.Context, ref drivers.NodeRef) (drivers.NodeState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.provisioned = append(f.provisioned, ref.Node.Name)
	delete(f.asleep, ref.Node.Name)
	if err := f.provErr[ref.Node.Name]; err != nil {
		return drivers.NodeState{}, err
	}
	return f.state(ref.Node.Name), nil
}

func (f *fakeDriver) state(node string) drivers.NodeState {
	if f.asleep[node] {
		return drivers.NodeState{Phase: labsv1.NodeHibernated}
	}
	p, ok := f.phase[node]
	if !ok {
		p = labsv1.NodeReady
	}
	return drivers.NodeState{Phase: p, InstanceID: f.instance[node]}
}

func (f *fakeDriver) Status(_ context.Context, ref drivers.NodeRef) (drivers.NodeState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.state(ref.Node.Name), nil
}

func (f *fakeDriver) Exec(_ context.Context, _ drivers.NodeRef, req drivers.ExecRequest) (drivers.ExecResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	call := f.execCalls
	f.execCalls++
	if call == f.execErrAt {
		return drivers.ExecResult{}, f.execErr
	}
	f.execs = append(f.execs, req)
	return drivers.ExecResult{ExitCode: f.execExit, Stderr: "boom"}, nil
}

func (f *fakeDriver) Connect(_ context.Context, ref drivers.NodeRef, a labsv1.AccessType) (labsv1.Endpoint, error) {
	return labsv1.Endpoint{Node: ref.Node.Name, Access: a, Protocol: "fake", Host: ref.ResourceName()}, nil
}

func (f *fakeDriver) Reset(_ context.Context, ref drivers.NodeRef) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resets = append(f.resets, ref.Node.Name)
	return nil
}

func (f *fakeDriver) Destroy(_ context.Context, ref drivers.NodeRef) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.destroyErr != nil {
		return f.destroyErr
	}
	f.destroyed = append(f.destroyed, ref.Node.Name)
	return nil
}

// hibernatingDriver adds the Hibernator interface.
type hibernatingDriver struct{ *fakeDriver }

func (h hibernatingDriver) Hibernate(_ context.Context, ref drivers.NodeRef) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.hibernated = append(h.hibernated, ref.Node.Name)
	h.asleep[ref.Node.Name] = true
	return nil
}

func scheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(s); err != nil {
		t.Fatal(err)
	}
	if err := labsv1.AddToScheme(s); err != nil {
		t.Fatal(err)
	}
	return s
}

func template() *labsv1.LabTemplate {
	return &labsv1.LabTemplate{
		ObjectMeta: metav1.ObjectMeta{Name: "net-lab-v1", Namespace: ns},
		Spec: labsv1.LabTemplateSpec{
			Source: labsv1.LabSource{ID: "net-lab", Version: 1, Title: "t", Domain: "networking",
				Difficulty: "easy", EstimatedMinutes: 25},
			Description: "Site {{site}}",
			Params: map[string]labsv1.ParamSpec{
				"site": {Type: labsv1.ParamChoice, Values: []string{"Narvik", "Molde"}},
			},
			Topology: labsv1.Topology{
				Entry: "workstation",
				Nodes: []labsv1.Node{
					{Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1",
						Access: []labsv1.AccessType{labsv1.AccessShell}},
					{Name: "rtr", Driver: labsv1.DriverNetdev, Image: "frr:10",
						Access: []labsv1.AccessType{labsv1.AccessConsole, labsv1.AccessSSH}},
				},
			},
			Setup: []labsv1.Action{
				{On: "workstation", Run: ptr.To("echo {{site}} > /etc/site")},
				{On: "rtr", Config: ptr.To("hostname rtr-{{site}}")},
			},
			Checks:   []labsv1.Check{{ID: "c", Description: "d", Skills: []string{"s"}, Type: "shell"}},
			Solution: labsv1.Solution{Steps: []labsv1.Action{{On: "rtr", Config: ptr.To("x")}}},
		},
	}
}

func session(mut ...func(*labsv1.LabSession)) *labsv1.LabSession {
	s := &labsv1.LabSession{
		ObjectMeta: metav1.ObjectMeta{Name: "s1", Namespace: ns, UID: "uid-s1",
			CreationTimestamp: metav1.NewTime(t0)},
		Spec: labsv1.LabSessionSpec{
			TemplateRef: labsv1.TemplateReference{Name: "net-lab-v1"},
			Learner:     labsv1.LearnerRef{ID: "learner-7"},
			Seed:        42,
		},
	}
	for _, m := range mut {
		m(s)
	}
	return s
}

type harness struct {
	t       *testing.T
	c       client.Client
	r       *LabSessionReconciler
	now     time.Time
	cont    *fakeDriver
	netdev  *fakeDriver
	sesName types.NamespacedName
}

func newHarness(t *testing.T, objs ...client.Object) *harness {
	t.Helper()
	s := scheme(t)
	c := fake.NewClientBuilder().WithScheme(s).WithObjects(objs...).
		WithStatusSubresource(&labsv1.LabSession{}).Build()
	h := &harness{t: t, c: c, now: t0.Add(time.Minute),
		cont: newFakeDriver(labsv1.DriverContainer), netdev: newFakeDriver(labsv1.DriverNetdev),
		sesName: types.NamespacedName{Namespace: ns, Name: "s1"}}
	reg, err := drivers.NewRegistry(h.cont, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r = &LabSessionReconciler{Client: c, Scheme: s, Drivers: reg, Now: func() time.Time { return h.now }}
	return h
}

func (h *harness) reconcile() ctrl.Result {
	h.t.Helper()
	res, err := h.r.Reconcile(context.Background(), ctrl.Request{NamespacedName: h.sesName})
	if err != nil {
		h.t.Fatalf("reconcile: %v", err)
	}
	return res
}

func (h *harness) get() *labsv1.LabSession {
	h.t.Helper()
	s := &labsv1.LabSession{}
	if err := h.c.Get(context.Background(), h.sesName, s); err != nil {
		h.t.Fatal(err)
	}
	return s
}

func cond(s *labsv1.LabSession, typ string) *metav1.Condition {
	return meta.FindStatusCondition(s.Status.Conditions, typ)
}

func TestReconcileToReady(t *testing.T) {
	h := newHarness(t, template(), session())
	res := h.reconcile()
	s := h.get()

	if s.Status.Phase != labsv1.SessionReady {
		t.Fatalf("phase = %s, conditions = %+v", s.Status.Phase, s.Status.Conditions)
	}
	if !strings.Contains(strings.Join(s.Finalizers, ","), Finalizer) {
		t.Errorf("finalizer missing: %v", s.Finalizers)
	}
	for _, c := range []string{labsv1.ConditionTemplateResolved, labsv1.ConditionNodesReady,
		labsv1.ConditionSetupComplete, labsv1.ConditionReady} {
		if !meta.IsStatusConditionTrue(s.Status.Conditions, c) {
			t.Errorf("condition %s not true: %+v", c, cond(s, c))
		}
	}
	if site := s.Status.ResolvedParams["site"]; site != "Narvik" && site != "Molde" {
		t.Errorf("resolved site = %q", site)
	}
	if s.Status.EntryNode != "workstation" {
		t.Errorf("entry = %q", s.Status.EntryNode)
	}
	if len(s.Status.Nodes) != 2 || s.Status.Nodes[0].Phase != labsv1.NodeReady {
		t.Errorf("nodes = %+v", s.Status.Nodes)
	}
	if len(s.Status.Endpoints) != 3 {
		t.Errorf("endpoints = %+v", s.Status.Endpoints)
	}
	if s.Status.ReadyAt == nil {
		t.Error("readyAt not set")
	}
	// Default TTL: max(2*25m, 30m) = 50m from creation.
	if want := t0.Add(50 * time.Minute); !s.Status.ExpiresAt.Time.Equal(want) {
		t.Errorf("expiresAt = %v, want %v", s.Status.ExpiresAt, want)
	}
	if want := 49 * time.Minute; res.RequeueAfter != want {
		t.Errorf("requeueAfter = %v, want %v (until expiry)", res.RequeueAfter, want)
	}

	// Setup ran once per action with params substituted, on the right node.
	site := s.Status.ResolvedParams["site"]
	if len(h.cont.execs) != 1 || h.cont.execs[0].Command[2] != "echo "+site+" > /etc/site" {
		t.Errorf("container execs = %+v", h.cont.execs)
	}
	if len(h.netdev.execs) != 1 || h.netdev.execs[0].Kind != drivers.ExecDeviceConfig ||
		string(h.netdev.execs[0].Stdin) != "hostname rtr-"+site {
		t.Errorf("netdev execs = %+v", h.netdev.execs)
	}

	// A second pass is stable and does not re-run setup.
	h.reconcile()
	if len(h.cont.execs) != 1 {
		t.Errorf("setup re-ran: %d execs", len(h.cont.execs))
	}
	if got := h.get().Status.Phase; got != labsv1.SessionReady {
		t.Errorf("phase after 2nd pass = %s", got)
	}
}

func TestReconcileProvisioning(t *testing.T) {
	h := newHarness(t, template(), session())
	h.netdev.phase["rtr"] = labsv1.NodeProvisioning
	res := h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionProvisioning {
		t.Fatalf("phase = %s", s.Status.Phase)
	}
	if c := cond(s, labsv1.ConditionNodesReady); c == nil || c.Status != metav1.ConditionFalse ||
		!strings.Contains(c.Message, "rtr=Provisioning") {
		t.Errorf("NodesReady = %+v", c)
	}
	if res.RequeueAfter != requeueProvisioning {
		t.Errorf("requeueAfter = %v", res.RequeueAfter)
	}
	if len(s.Status.Endpoints) != 0 || len(h.cont.execs) != 0 {
		t.Error("endpoints published or setup ran before nodes were ready")
	}

	delete(h.netdev.phase, "rtr")
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionReady {
		t.Errorf("phase = %s", got)
	}
}

func TestReconcileTemplateMissing(t *testing.T) {
	h := newHarness(t, session())
	res := h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionPending {
		t.Errorf("phase = %s", s.Status.Phase)
	}
	if c := cond(s, labsv1.ConditionTemplateResolved); c == nil || c.Reason != ReasonTemplateNotFound {
		t.Errorf("TemplateResolved = %+v", c)
	}
	if res.RequeueAfter != requeueTemplateWait {
		t.Errorf("requeueAfter = %v", res.RequeueAfter)
	}
}

func TestReconcileFailures(t *testing.T) {
	cases := []struct {
		name   string
		setup  func(h *harness)
		tpl    func(*labsv1.LabTemplate)
		reason string
	}{
		{
			name: "driver not implemented",
			setup: func(h *harness) {
				h.netdev.provErr["rtr"] = &drivers.NotImplementedError{Driver: "netdev", Op: "provision"}
			},
			reason: ReasonNodeFailed,
		},
		{
			name:   "node failed",
			setup:  func(h *harness) { h.cont.phase["workstation"] = labsv1.NodeFailed },
			reason: ReasonNodeFailed,
		},
		{
			name:   "setup exits non-zero",
			setup:  func(h *harness) { h.cont.execExit = 3 },
			reason: ReasonSetupFailed,
		},
		{
			name: "no driver registered",
			tpl: func(lt *labsv1.LabTemplate) {
				lt.Spec.Topology.Nodes[1].Driver = labsv1.DriverVM
			},
			reason: ReasonNodeFailed,
		},
		{
			name:   "unresolvable param",
			tpl:    func(lt *labsv1.LabTemplate) { lt.Spec.Description = "{{nope}}" },
			reason: ReasonResolveFailed,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lt := template()
			if tc.tpl != nil {
				tc.tpl(lt)
			}
			h := newHarness(t, lt, session())
			if tc.setup != nil {
				tc.setup(h)
			}
			h.reconcile()
			s := h.get()
			if s.Status.Phase != labsv1.SessionFailed {
				t.Fatalf("phase = %s, conditions = %+v", s.Status.Phase, s.Status.Conditions)
			}
			if c := cond(s, labsv1.ConditionReady); c == nil || c.Reason != tc.reason {
				t.Errorf("Ready = %+v, want reason %s", c, tc.reason)
			}
			if len(s.Status.Endpoints) != 0 {
				t.Errorf("failed session has endpoints: %+v", s.Status.Endpoints)
			}
		})
	}
}

func TestReconcileTransientErrorRequeues(t *testing.T) {
	h := newHarness(t, template(), session())
	h.cont.provErr["workstation"] = errors.New("apiserver hiccup")
	_, err := h.r.Reconcile(context.Background(), ctrl.Request{NamespacedName: h.sesName})
	if err == nil {
		t.Fatal("expected transient error to be returned for backoff")
	}
	if got := h.get().Status.Phase; got != labsv1.SessionProvisioning {
		t.Errorf("phase = %s", got)
	}
}

func TestExpiry(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*labsv1.LabSession)
		want time.Time
	}{
		{"default from estimate", nil, t0.Add(50 * time.Minute)},
		{"ttl", func(s *labsv1.LabSession) { s.Spec.TTL = &metav1.Duration{Duration: 10 * time.Minute} }, t0.Add(10 * time.Minute)},
		{"absolute", func(s *labsv1.LabSession) {
			s.Spec.TTL = &metav1.Duration{Duration: time.Hour}
			s.Spec.ExpiresAt = ptr.To(metav1.NewTime(t0.Add(5 * time.Minute)))
		}, t0.Add(5 * time.Minute)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var muts []func(*labsv1.LabSession)
			if tc.mut != nil {
				muts = append(muts, tc.mut)
			}
			h := newHarness(t, template(), session(muts...))
			h.reconcile()
			if got := h.get().Status.ExpiresAt; got == nil || !got.Time.Equal(tc.want) {
				t.Errorf("expiresAt = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestReconcileExpires(t *testing.T) {
	h := newHarness(t, template(), session(func(s *labsv1.LabSession) {
		s.Spec.TTL = &metav1.Duration{Duration: 10 * time.Minute}
	}))
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionReady {
		t.Fatalf("phase = %s", got)
	}

	h.now = t0.Add(11 * time.Minute)
	res := h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionExpired {
		t.Fatalf("phase = %s", s.Status.Phase)
	}
	if !meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionExpired) {
		t.Error("Expired condition not true")
	}
	if meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionReady) {
		t.Error("Ready still true")
	}
	if len(s.Status.Endpoints) != 0 {
		t.Errorf("endpoints = %+v", s.Status.Endpoints)
	}
	for _, n := range s.Status.Nodes {
		if n.Phase != labsv1.NodeDestroyed {
			t.Errorf("node %s phase = %s", n.Name, n.Phase)
		}
	}
	if fmt.Sprint(h.cont.destroyed) != "[workstation]" || fmt.Sprint(h.netdev.destroyed) != "[rtr]" {
		t.Errorf("destroyed = %v %v", h.cont.destroyed, h.netdev.destroyed)
	}
	if res.RequeueAfter != 0 || res.Requeue {
		t.Errorf("expired session requeued: %+v", res)
	}

	// Expired is terminal: no re-provisioning.
	n := len(h.cont.provisioned)
	h.reconcile()
	if len(h.cont.provisioned) != n {
		t.Error("expired session was re-provisioned")
	}
}

func TestReconcileHibernateAndResume(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()

	s := h.get()
	s.Spec.Hibernate = true
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	s = h.get()
	if !s.Status.Hibernated || !meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionHibernated) {
		t.Fatalf("not hibernated: %+v", s.Status)
	}
	if meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionReady) || len(s.Status.Endpoints) != 0 {
		t.Error("hibernated session still ready / has endpoints")
	}
	if fmt.Sprint(h.netdev.hibernated) != "[rtr]" {
		t.Errorf("hibernated nodes = %v", h.netdev.hibernated)
	}
	for _, n := range s.Status.Nodes {
		want := labsv1.NodeReady // container driver does not hibernate
		if n.Name == "rtr" {
			want = labsv1.NodeHibernated
		}
		if n.Phase != want {
			t.Errorf("node %s phase = %s, want %s", n.Name, n.Phase, want)
		}
	}

	s.Spec.Hibernate = false
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	s = h.get()
	if s.Status.Hibernated || s.Status.Phase != labsv1.SessionReady || len(s.Status.Endpoints) != 3 {
		t.Errorf("not resumed: %+v", s.Status)
	}
	if len(h.cont.execs) != 1 {
		t.Errorf("setup re-ran after resume: %d", len(h.cont.execs))
	}
}

func TestReconcileKeepsGradingPhase(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	s := h.get()
	s.Status.Phase = labsv1.SessionGrading
	if err := h.c.Status().Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionGrading {
		t.Errorf("phase = %s, want Grading preserved", got)
	}
}

func TestReconcileDeletionDestroysNodes(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	if err := h.c.Delete(context.Background(), h.get()); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if len(h.cont.destroyed) != 1 || len(h.netdev.destroyed) != 1 {
		t.Errorf("destroyed = %v %v", h.cont.destroyed, h.netdev.destroyed)
	}
	err := h.c.Get(context.Background(), h.sesName, &labsv1.LabSession{})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("session still present after finalizer removal: %v", err)
	}
}

func TestActionRequest(t *testing.T) {
	cases := []struct {
		name string
		in   labsv1.Action
		kind drivers.ExecKind
		cmd  string
		in2  string
		user labsv1.ActionUser
		to   time.Duration
	}{
		{"run", labsv1.Action{On: "a", Run: ptr.To("id"), As: labsv1.ActionAsLearner, TimeoutSec: 9},
			drivers.ExecShell, "/bin/sh -c id", "", labsv1.ActionAsLearner, 9 * time.Second},
		{"apply", labsv1.Action{On: "k", Apply: ptr.To("kind: Pod")},
			drivers.ExecKubeApply, "", "kind: Pod", labsv1.ActionAsAdmin, defaultActionTimeout},
		{"config", labsv1.Action{On: "r", Config: ptr.To("hostname r")},
			drivers.ExecDeviceConfig, "", "hostname r", labsv1.ActionAsAdmin, defaultActionTimeout},
		{"file", labsv1.Action{On: "a", File: &labsv1.FileAction{Path: "/etc/x", Content: "hi", Mode: "0600"}},
			drivers.ExecShell, `/bin/sh -c set -e; mkdir -p "$(dirname "$1")"; cat > "$1"; chmod "$2" "$1" sh /etc/x 0600`,
			"hi", labsv1.ActionAsAdmin, defaultActionTimeout},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := ActionRequest(tc.in)
			if r.Kind != tc.kind || strings.Join(r.Command, " ") != tc.cmd || string(r.Stdin) != tc.in2 ||
				r.User != tc.user || r.Timeout != tc.to {
				t.Errorf("got %+v", r)
			}
		})
	}
}

// TestReconcileWithContainerDriver runs the real container driver against
// the fake client: Pods and Services are created and the session becomes
// Ready once the Pod reports Ready.
func TestReconcileWithContainerDriver(t *testing.T) {
	lt := template()
	lt.Spec.Topology.Nodes = lt.Spec.Topology.Nodes[:1]
	lt.Spec.Setup = nil
	s := scheme(t)
	c := fake.NewClientBuilder().WithScheme(s).WithObjects(lt, session()).
		WithStatusSubresource(&labsv1.LabSession{}, &corev1.Pod{}).Build()
	reg, err := drivers.NewDefaultRegistry(&drivers.ContainerDriver{Client: c, Scheme: s})
	if err != nil {
		t.Fatal(err)
	}
	r := &LabSessionReconciler{Client: c, Scheme: s, Drivers: reg, Now: func() time.Time { return t0 }}
	req := ctrl.Request{NamespacedName: types.NamespacedName{Namespace: ns, Name: "s1"}}
	ctx := context.Background()

	if _, err := r.Reconcile(ctx, req); err != nil {
		t.Fatal(err)
	}
	got := &labsv1.LabSession{}
	_ = c.Get(ctx, req.NamespacedName, got)
	if got.Status.Phase != labsv1.SessionProvisioning {
		t.Fatalf("phase = %s", got.Status.Phase)
	}
	name := drivers.ResourceName("s1", "uid-s1", "workstation")
	pod := &corev1.Pod{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ns, Name: name}, pod); err != nil {
		t.Fatalf("pod not created: %v", err)
	}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ns, Name: name}, &corev1.Service{}); err != nil {
		t.Fatalf("service not created: %v", err)
	}

	pod.Status.Phase = corev1.PodRunning
	pod.Status.Conditions = []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}
	if err := c.Status().Update(ctx, pod); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reconcile(ctx, req); err != nil {
		t.Fatal(err)
	}
	_ = c.Get(ctx, req.NamespacedName, got)
	if got.Status.Phase != labsv1.SessionReady {
		t.Fatalf("phase = %s, conditions %+v", got.Status.Phase, got.Status.Conditions)
	}
	if len(got.Status.Endpoints) != 1 || got.Status.Endpoints[0].Protocol != "k8s-exec" ||
		got.Status.Endpoints[0].Target != ns+"/"+name+"/"+drivers.ContainerName {
		t.Errorf("endpoints = %+v", got.Status.Endpoints)
	}
}

func (h *harness) deleteTemplate() {
	h.t.Helper()
	if err := h.c.Delete(context.Background(), template()); err != nil {
		h.t.Fatal(err)
	}
}

func TestTopologySnapshotRecorded(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	s := h.get()
	if s.Status.Topology == nil || len(s.Status.Topology.Nodes) != 2 {
		t.Fatalf("topology snapshot = %+v", s.Status.Topology)
	}
}

func TestExpiryWithoutTemplateStillTearsDown(t *testing.T) {
	h := newHarness(t, template(), session(func(s *labsv1.LabSession) {
		s.Spec.TTL = &metav1.Duration{Duration: 10 * time.Minute}
	}))
	h.reconcile()
	h.deleteTemplate()

	h.now = t0.Add(11 * time.Minute)
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionExpired {
		t.Fatalf("phase = %s", s.Status.Phase)
	}
	if fmt.Sprint(h.cont.destroyed) != "[workstation]" || fmt.Sprint(h.netdev.destroyed) != "[rtr]" {
		t.Errorf("destroyed = %v %v", h.cont.destroyed, h.netdev.destroyed)
	}
}

func TestExpiryWaitsForTeardown(t *testing.T) {
	h := newHarness(t, template(), session(func(s *labsv1.LabSession) {
		s.Spec.TTL = &metav1.Duration{Duration: 10 * time.Minute}
	}))
	h.reconcile()
	h.now = t0.Add(11 * time.Minute)
	h.cont.destroyErr = errors.New("apiserver hiccup")
	if _, err := h.r.Reconcile(context.Background(), ctrl.Request{NamespacedName: h.sesName}); err == nil {
		t.Fatal("expected teardown error")
	}
	if got := h.get().Status.Phase; got == labsv1.SessionExpired {
		t.Fatal("session marked Expired although teardown failed")
	}
	h.cont.destroyErr = nil
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionExpired {
		t.Fatalf("phase = %s", got)
	}
}

func TestDeletionWithoutTemplateDestroysNodes(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	h.deleteTemplate()
	if err := h.c.Delete(context.Background(), h.get()); err != nil {
		t.Fatal(err)
	}
	h.cont.destroyErr = errors.New("transient")
	if _, err := h.r.Reconcile(context.Background(), ctrl.Request{NamespacedName: h.sesName}); err == nil {
		t.Fatal("expected destroy error")
	}
	if len(h.get().Finalizers) == 0 {
		t.Fatal("finalizer removed although destroy failed")
	}
	h.cont.destroyErr = nil
	h.reconcile()
	// Destroy is idempotent; rtr was already destroyed on the failed pass.
	if len(h.cont.destroyed) != 1 || len(h.netdev.destroyed) != 2 {
		t.Errorf("destroyed = %v %v", h.cont.destroyed, h.netdev.destroyed)
	}
}

func TestTemplateMissingStillExpires(t *testing.T) {
	h := newHarness(t, session())
	h.reconcile()
	if got := h.get().Status.ExpiresAt; got == nil || !got.Time.Equal(t0.Add(MinDefaultTTL)) {
		t.Fatalf("expiresAt = %v", got)
	}
	h.now = t0.Add(MinDefaultTTL + time.Second)
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionExpired {
		t.Errorf("phase = %s", got)
	}
}

func TestSetupResumesAfterTransientFailure(t *testing.T) {
	h := newHarness(t, template(), session())
	h.netdev.execErrAt, h.netdev.execErr = 0, errors.New("connection reset")
	if _, err := h.r.Reconcile(context.Background(), ctrl.Request{NamespacedName: h.sesName}); err == nil {
		t.Fatal("expected transient setup error")
	}
	if got := h.get().Status.SetupProgress; got != 1 {
		t.Fatalf("setupProgress = %d, want 1", got)
	}
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionReady || s.Status.SetupProgress != 2 {
		t.Fatalf("phase = %s progress = %d", s.Status.Phase, s.Status.SetupProgress)
	}
	if len(h.cont.execs) != 1 {
		t.Errorf("completed action 0 re-ran: %d container execs", len(h.cont.execs))
	}
}

func TestRecreatedNodeRerunsSetup(t *testing.T) {
	h := newHarness(t, template(), session())
	h.cont.instance["workstation"] = "pod-a/0"
	h.reconcile()
	if len(h.cont.execs) != 1 {
		t.Fatalf("execs = %d", len(h.cont.execs))
	}
	h.reconcile()
	if len(h.cont.execs) != 1 {
		t.Fatal("setup re-ran without node change")
	}
	h.cont.instance["workstation"] = "pod-a/1" // container restarted
	h.reconcile()
	s := h.get()
	if len(h.cont.execs) != 2 || len(h.netdev.execs) != 2 {
		t.Errorf("setup not re-run: %d %d", len(h.cont.execs), len(h.netdev.execs))
	}
	if s.Status.Phase != labsv1.SessionReady || s.Status.Nodes[0].InstanceID != "pod-a/1" {
		t.Errorf("status = %+v", s.Status)
	}
}

func TestResetGeneration(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	s := h.get()
	s.Spec.ResetGeneration = 1
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	s = h.get()
	if fmt.Sprint(h.cont.resets, h.netdev.resets) != "[workstation] [rtr]" {
		t.Errorf("resets = %v %v", h.cont.resets, h.netdev.resets)
	}
	if s.Status.ObservedResetGeneration != 1 || len(h.cont.execs) != 2 || s.Status.Phase != labsv1.SessionReady {
		t.Errorf("status = %+v, execs = %d", s.Status, len(h.cont.execs))
	}
	h.reconcile()
	if len(h.cont.resets) != 1 {
		t.Error("reset repeated")
	}
}

func TestProvisionTimeout(t *testing.T) {
	h := newHarness(t, template(), session())
	h.cont.phase["workstation"] = labsv1.NodeProvisioning
	h.reconcile()
	h.now = h.now.Add(DefaultProvisionTimeout + time.Second)
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionFailed {
		t.Fatalf("phase = %s", s.Status.Phase)
	}
	if c := cond(s, labsv1.ConditionReady); c == nil || c.Reason != ReasonProvisionTimeout {
		t.Errorf("Ready = %+v", c)
	}
}

func TestHibernatedPhase(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	s := h.get()
	s.Spec.Hibernate = true
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionHibernated {
		t.Errorf("phase = %s", got)
	}
}

// topoDriver records session-scoped topology calls.
type topoDriver struct {
	*fakeDriver
	provisioned, destroyed int
}

func (d *topoDriver) ProvisionTopology(context.Context, drivers.SessionRef) (bool, error) {
	d.provisioned++
	return true, nil
}

func (d *topoDriver) DestroyTopology(context.Context, drivers.SessionRef) error {
	d.destroyed++
	return nil
}

func TestTopologyProvisioner(t *testing.T) {
	h := newHarness(t, template(), session())
	td := &topoDriver{fakeDriver: h.netdev}
	reg, err := drivers.NewRegistry(h.cont, td)
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.reconcile()
	if td.provisioned != 1 {
		t.Errorf("ProvisionTopology calls = %d", td.provisioned)
	}
	if err := h.c.Delete(context.Background(), h.get()); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if td.destroyed != 1 {
		t.Errorf("DestroyTopology calls = %d", td.destroyed)
	}
}
