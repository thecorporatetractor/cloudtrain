package controller

import (
	"context"
	"fmt"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/rbac"
)

// unschedDriver reports its nodes as waiting for a cluster node while
// unscheduled is set.
type unschedDriver struct {
	*fakeDriver
	unscheduled bool
}

func (d *unschedDriver) Provision(ctx context.Context, ref drivers.NodeRef) (drivers.NodeState, error) {
	st, err := d.fakeDriver.Provision(ctx, ref)
	if d.unscheduled {
		st.Phase, st.Unscheduled, st.Message = labsv1.NodeProvisioning, true, "pod pending: waiting for a node (unschedulable)"
	}
	return st, err
}

func longTTL(s *labsv1.LabSession) { s.Spec.TTL = &metav1.Duration{Duration: 48 * time.Hour} }

// A failed session keeps its resources for a short grace period only, then
// they are torn down; the session object stays Failed.
func TestFailedSessionReleasesResourcesAfterGrace(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	h.cont.phase["workstation"] = labsv1.NodeFailed
	res := h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionFailed {
		t.Fatalf("phase = %s", s.Status.Phase)
	}
	if res.RequeueAfter != DefaultFailedRelease {
		t.Errorf("requeueAfter = %v, want %v (release time)", res.RequeueAfter, DefaultFailedRelease)
	}
	if c := cond(s, labsv1.ConditionResourcesReleased); c == nil || c.Status != metav1.ConditionFalse || c.Reason != ReasonReleasePending {
		t.Errorf("ResourcesReleased = %+v", c)
	}

	h.now = h.now.Add(DefaultFailedRelease / 2)
	h.reconcile()
	if len(h.cont.destroyed)+len(h.netdev.destroyed) != 0 {
		t.Fatalf("resources released inside the grace period: %v %v", h.cont.destroyed, h.netdev.destroyed)
	}

	h.now = h.now.Add(DefaultFailedRelease)
	h.reconcile()
	s = h.get()
	if len(h.cont.destroyed) != 1 || len(h.netdev.destroyed) != 1 {
		t.Fatalf("destroyed = %v %v, want every node", h.cont.destroyed, h.netdev.destroyed)
	}
	if s.Status.Phase != labsv1.SessionFailed {
		t.Errorf("phase after release = %s, want Failed", s.Status.Phase)
	}
	if c := cond(s, labsv1.ConditionResourcesReleased); c == nil || c.Status != metav1.ConditionTrue {
		t.Errorf("ResourcesReleased = %+v", c)
	}
	for _, n := range s.Status.Nodes {
		if n.Phase != labsv1.NodeDestroyed {
			t.Errorf("node %s phase = %s", n.Name, n.Phase)
		}
	}
	// Released once.
	h.reconcile()
	if len(h.cont.destroyed) != 1 {
		t.Errorf("released again: %v", h.cont.destroyed)
	}
}

// Debug and verify sessions keep a failed session's resources until expiry.
func TestFailedSessionKeptForDebugging(t *testing.T) {
	for name, mut := range map[string]func(*labsv1.LabSession){
		"annotation": func(s *labsv1.LabSession) {
			s.Annotations = map[string]string{AnnotationKeepFailed: "true"}
		},
		"verify label": func(s *labsv1.LabSession) {
			s.Labels = map[string]string{LabelVerifySession: "true"}
		},
		// labctl verify --session-label puts any value there (ct-batch.sh,
		// calibrate.sh: batch; networking handoffs: networking).
		"verify label batch": func(s *labsv1.LabSession) {
			s.Labels = map[string]string{LabelVerifySession: "batch"}
		},
		"verify label empty": func(s *labsv1.LabSession) {
			s.Labels = map[string]string{LabelVerifySession: ""}
		},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, template(), session(longTTL, mut))
			h.cont.phase["workstation"] = labsv1.NodeFailed
			h.reconcile()
			h.now = h.now.Add(time.Hour)
			h.reconcile()
			if len(h.cont.destroyed) != 0 {
				t.Fatalf("debug session released: %v", h.cont.destroyed)
			}
			if c := cond(h.get(), labsv1.ConditionResourcesReleased); c == nil || c.Reason != ReasonKeptForDebugging {
				t.Errorf("ResourcesReleased = %+v", c)
			}
		})
	}
}

// A topology that never becomes ready fails the session at the
// session-level deadline instead of sitting in Provisioning until its TTL.
func TestProvisionDeadlineCoversTopology(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	td := &stuckTopo{fakeDriver: h.netdev}
	reg, err := drivers.NewRegistry(h.cont, td)
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.reconcile()
	h.now = h.now.Add(DefaultProvisionDeadline - time.Minute)
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionProvisioning {
		t.Fatalf("phase before the deadline = %s", got)
	}
	h.now = h.now.Add(2 * time.Minute)
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionFailed {
		t.Fatalf("phase = %s, conditions %+v", s.Status.Phase, s.Status.Conditions)
	}
	if c := cond(s, labsv1.ConditionReady); c == nil || c.Reason != ReasonProvisionDeadline {
		t.Errorf("Ready = %+v", c)
	}
}

type stuckTopo struct{ *fakeDriver }

func (d *stuckTopo) ProvisionTopology(context.Context, drivers.SessionRef) (bool, error) {
	return false, nil
}

func (d *stuckTopo) DestroyTopology(context.Context, drivers.SessionRef) error { return nil }

// Retried transient setup errors are bounded by the deadline too.
func TestProvisionDeadlineCoversRetriedSetup(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	h.cont.execErrAt, h.cont.execErr = 0, fmt.Errorf("exec: connection reset")
	if _, err := h.r.Reconcile(context.Background(), ctrl.Request{NamespacedName: h.sesName}); err == nil {
		t.Fatal("transient setup error not returned")
	}
	h.now = h.now.Add(DefaultProvisionDeadline + time.Minute)
	h.reconcile()
	if c := cond(h.get(), labsv1.ConditionReady); c == nil || c.Reason != ReasonProvisionDeadline {
		t.Fatalf("Ready = %+v", c)
	}
}

// Waiting for a cluster node (scale from zero) does not use up the node
// provision timeout; it counts from when the nodes were scheduled.
func TestUnscheduledNodesDoNotUseProvisionTimeout(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	ud := &unschedDriver{fakeDriver: h.cont, unscheduled: true}
	reg, err := drivers.NewRegistry(ud, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.reconcile()
	h.now = h.now.Add(DefaultProvisionTimeout + 5*time.Minute)
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionProvisioning {
		t.Fatalf("failed while waiting for capacity: %s %+v", s.Status.Phase, cond(s, labsv1.ConditionReady))
	}
	if c := cond(s, labsv1.ConditionNodesScheduled); c == nil || c.Reason != ReasonWaitingCapacity {
		t.Errorf("NodesScheduled = %+v", c)
	}

	// Scheduled now, but the node keeps provisioning (image pull, boot).
	ud.unscheduled = false
	h.cont.phase["workstation"] = labsv1.NodeProvisioning
	h.reconcile()
	h.now = h.now.Add(DefaultProvisionTimeout - time.Minute)
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionProvisioning {
		t.Fatalf("failed before the timeout counted from scheduling: %s", got)
	}
	h.now = h.now.Add(2 * time.Minute)
	h.reconcile()
	if c := cond(h.get(), labsv1.ConditionReady); c == nil || c.Reason != ReasonProvisionTimeout {
		t.Fatalf("Ready = %+v", c)
	}
}

// Setup runs in slices: once the slice is used up the reconcile requeues
// and the next one continues after the last completed action.
func TestSetupRunsInSlices(t *testing.T) {
	h := newHarness(t, template(), session())
	h.r.SetupSlice = time.Second
	h.cont.stdout = func(drivers.ExecRequest) string { h.now = h.now.Add(2 * time.Second); return "" }
	res := h.reconcile()
	s := h.get()
	if s.Status.SetupProgress != 1 || s.Status.Phase != labsv1.SessionProvisioning {
		t.Fatalf("after one slice: progress %d phase %s", s.Status.SetupProgress, s.Status.Phase)
	}
	if res.RequeueAfter != requeueSetupStep {
		t.Errorf("requeueAfter = %v, want %v", res.RequeueAfter, requeueSetupStep)
	}
	if len(h.netdev.execs) != 0 {
		t.Errorf("second action ran in the first slice")
	}
	h.reconcile()
	s = h.get()
	if s.Status.Phase != labsv1.SessionReady || len(h.cont.execs) != 1 || len(h.netdev.execs) != 1 {
		t.Fatalf("phase %s execs %d/%d", s.Status.Phase, len(h.cont.execs), len(h.netdev.execs))
	}
}

// Ending a lab during setup stops setup before the next action, and the
// session is torn down without running the rest.
func TestSetupStopsWhenSessionDeleted(t *testing.T) {
	h := newHarness(t, template(), session())
	h.r.Reader = h.c
	h.cont.stdout = func(drivers.ExecRequest) string {
		if err := h.c.Delete(context.Background(), h.get()); err != nil {
			t.Error(err)
		}
		return ""
	}
	res := h.reconcile()
	if res.RequeueAfter != requeueSetupStep {
		t.Errorf("requeueAfter = %v", res.RequeueAfter)
	}
	if len(h.netdev.execs) != 0 {
		t.Fatalf("setup went on after the session was deleted: %+v", h.netdev.execs)
	}
	h.reconcile()
	if len(h.cont.destroyed) != 1 || len(h.netdev.destroyed) != 1 {
		t.Errorf("destroyed = %v %v", h.cont.destroyed, h.netdev.destroyed)
	}
	if err := h.c.Get(context.Background(), h.sesName, &labsv1.LabSession{}); !apierrors.IsNotFound(err) {
		t.Errorf("session still there: %v", err)
	}
}

// A resumed session starts a new provisioning attempt: the time it spent
// hibernated does not count towards the deadline.
func TestResumeStartsNewProvisioningAttempt(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	h.reconcile()
	s := h.get()
	s.Spec.Hibernate = true
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	h.now = h.now.Add(DefaultProvisionDeadline * 3)
	s = h.get()
	s.Spec.Hibernate = false
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.netdev.phase["rtr"] = labsv1.NodeProvisioning
	h.reconcile()
	s = h.get()
	if s.Status.Phase != labsv1.SessionProvisioning {
		t.Fatalf("phase after resume = %s, Ready %+v", s.Status.Phase, cond(s, labsv1.ConditionReady))
	}
	if c := cond(s, labsv1.ConditionProvisioned); c == nil || c.Status != metav1.ConditionFalse || !c.LastTransitionTime.Time.Equal(h.now) {
		t.Errorf("Provisioned = %+v, want False since the resume", c)
	}
}

// Expired session objects are deleted after the retention.
func TestExpiredSessionCollectedAfterRetention(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	h.now = t0.Add(time.Hour) // past the 50m default TTL
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionExpired {
		t.Fatalf("phase = %s", got)
	}
	res := h.reconcile()
	if res.RequeueAfter <= 0 || res.RequeueAfter > DefaultExpiredRetention {
		t.Errorf("requeueAfter = %v, want the rest of the retention", res.RequeueAfter)
	}
	h.now = h.now.Add(DefaultExpiredRetention + time.Minute)
	h.reconcile() // deletes
	h.reconcile() // finalizer
	if err := h.c.Get(context.Background(), h.sesName, &labsv1.LabSession{}); !apierrors.IsNotFound(err) {
		t.Fatalf("expired session not collected: %v", err)
	}
}

// notLabAccess fails like a namespace without the lab label.
type notLabAccess struct{ heldAccess }

func (a *notLabAccess) EnsureHeld(context.Context, string) error { return rbac.ErrNamespaceNotLab }

// A session whose namespace lost its lab label still expires and is torn
// down (with whatever access is left).
func TestNamespaceNotLabStillExpires(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	h.r.Access = &notLabAccess{}
	h.now = t0.Add(time.Hour)
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionExpired {
		t.Fatalf("phase = %s, conditions %+v", s.Status.Phase, s.Status.Conditions)
	}
	if len(h.cont.destroyed) != 1 || len(h.netdev.destroyed) != 1 {
		t.Errorf("destroyed = %v %v", h.cont.destroyed, h.netdev.destroyed)
	}
	if c := cond(s, labsv1.ConditionExpired); c == nil || c.Status != metav1.ConditionTrue {
		t.Errorf("Expired = %+v", c)
	}
}

// The lab kept running after its namespace lost the label (Ready False
// NamespaceNotLab): at expiry the Ready transition is stamped with the
// expiry, so usage metering bills it to its expiry and not only up to the
// label loss.
func TestNamespaceNotLabExpiryStampsReadyTransition(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	h.r.Access = &notLabAccess{}
	h.now = t0.Add(10 * time.Minute)
	h.reconcile()
	if c := cond(h.get(), labsv1.ConditionReady); c == nil || c.Reason != ReasonNamespaceNotLab {
		t.Fatalf("Ready = %+v", c)
	}
	h.now = t0.Add(time.Hour)
	h.reconcile()
	s := h.get()
	ready, expired := cond(s, labsv1.ConditionReady), cond(s, labsv1.ConditionExpired)
	if ready == nil || expired == nil || ready.Reason != ReasonExpired || ready.LastTransitionTime.Before(&expired.LastTransitionTime) {
		t.Fatalf("Ready %+v Expired %+v, want the Ready transition at the expiry", ready, expired)
	}
}

// A failure reason is not masked by NamespaceNotLab.
func TestNamespaceNotLabKeepsFailureReason(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	h.cont.phase["workstation"] = labsv1.NodeFailed
	h.reconcile()
	h.r.Access = &notLabAccess{}
	h.reconcile()
	if c := cond(h.get(), labsv1.ConditionReady); c == nil || c.Reason != ReasonNodeFailed {
		t.Fatalf("Ready = %+v, want the failure reason kept", c)
	}
}

// A failed session whose LabTemplate was deleted is still released: teardown
// uses the recorded topology, not the template.
func TestFailedSessionReleasedWithoutTemplate(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	h.cont.phase["workstation"] = labsv1.NodeFailed
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionFailed {
		t.Fatalf("phase = %s", got)
	}
	failedReason := cond(h.get(), labsv1.ConditionReady).Reason
	h.deleteTemplate()
	h.now = h.now.Add(DefaultFailedRelease + time.Minute)
	h.reconcile()
	s := h.get()
	if len(h.cont.destroyed) != 1 || len(h.netdev.destroyed) != 1 {
		t.Fatalf("destroyed = %v %v, want every node", h.cont.destroyed, h.netdev.destroyed)
	}
	if c := cond(s, labsv1.ConditionResourcesReleased); c == nil || c.Status != metav1.ConditionTrue {
		t.Errorf("ResourcesReleased = %+v", c)
	}
	if c := cond(s, labsv1.ConditionReady); c == nil || c.Reason != failedReason {
		t.Errorf("Ready = %+v, want the failure reason %s kept", c, failedReason)
	}
}

// Ready rechecks are spread by session, within ±20%.
func TestReadyRecheckJitter(t *testing.T) {
	d := DefaultReadyRecheck
	seen := map[time.Duration]bool{}
	for i := 0; i < 50; i++ {
		j := jitter(d, types.UID(fmt.Sprintf("uid-%d", i)))
		if j < d*8/10 || j > d*12/10 {
			t.Fatalf("jitter(%v) = %v, outside ±20%%", d, j)
		}
		seen[j] = true
	}
	if len(seen) < 10 {
		t.Errorf("only %d distinct recheck intervals for 50 sessions", len(seen))
	}
	if jitter(d, "a") != jitter(d, "a") {
		t.Error("jitter not stable per session")
	}
	if jitter(0, "a") != 0 {
		t.Error("jitter(0) != 0")
	}
	h := newHarness(t, template(), session(longTTL))
	if res := h.reconcile(); res.RequeueAfter < d*8/10 || res.RequeueAfter > d*12/10 {
		t.Errorf("Ready requeueAfter = %v", res.RequeueAfter)
	}
}

// Setup is read uncached while setup is not complete, including before the
// first slice's progress (and NodesReady) reached the cache.
func TestSetupInFlightBeforeFirstProgress(t *testing.T) {
	s := session()
	s.Status.Conditions = []metav1.Condition{
		{Type: labsv1.ConditionNodesReady, Status: metav1.ConditionTrue},
		{Type: labsv1.ConditionSetupComplete, Status: metav1.ConditionFalse},
	}
	if !setupInFlight(s) {
		t.Error("progress 0 with nodes ready: not in flight")
	}
	// The cache can still hold the object from before the reconcile that
	// flipped NodesReady and ran the first slice.
	s.Status.Conditions[0].Status = metav1.ConditionFalse
	if !setupInFlight(s) {
		t.Error("nodes not ready yet in the cache: not in flight")
	}
	s.Status.Conditions[0].Status = metav1.ConditionTrue
	s.Status.Phase = labsv1.SessionFailed
	if setupInFlight(s) {
		t.Error("failed session reported in flight")
	}
	s.Status.Phase = labsv1.SessionProvisioning
	s.Status.Conditions[1].Status = metav1.ConditionTrue
	if setupInFlight(s) {
		t.Error("setup complete reported in flight")
	}
}

// staleClient serves LabSession reads from a snapshot (the informer cache
// before the watch delivered the last status patch) while it is set.
type staleClient struct {
	client.Client
	snapshot *labsv1.LabSession
}

func (c *staleClient) Get(ctx context.Context, key client.ObjectKey, obj client.Object, opts ...client.GetOption) error {
	if ls, ok := obj.(*labsv1.LabSession); ok && c.snapshot != nil {
		c.snapshot.DeepCopyInto(ls)
		return nil
	}
	return c.Client.Get(ctx, key, obj, opts...)
}

// The setup-step requeue can run before the watch delivered the first
// slice's status patch: the cache then holds the object from the earlier
// patch (topology recorded), without NodesReady and with progress 0. The
// session is read uncached and the first action does not run twice.
func TestSetupSliceFromStaleCacheDoesNotRepeatActions(t *testing.T) {
	h := newHarness(t, template(), session())
	sc := &staleClient{Client: h.c}
	h.r.Client, h.r.Reader = sc, h.c
	h.r.SetupSlice = time.Second
	h.cont.stdout = func(drivers.ExecRequest) string { h.now = h.now.Add(2 * time.Second); return "" }
	if res := h.reconcile(); res.RequeueAfter != requeueSetupStep {
		t.Fatalf("requeueAfter = %v", res.RequeueAfter)
	}
	if len(h.cont.execs) != 1 || len(h.netdev.execs) != 0 {
		t.Fatalf("first slice execs %d/%d", len(h.cont.execs), len(h.netdev.execs))
	}
	// The pre-patch object: the topology was saved before provisioning,
	// the slice's nodes, NodesReady and progress were not seen yet.
	stale := h.get()
	stale.Status.Nodes, stale.Status.SetupProgress = nil, 0
	for _, typ := range []string{labsv1.ConditionNodesReady, labsv1.ConditionNodesScheduled, labsv1.ConditionSetupComplete} {
		meta.RemoveStatusCondition(&stale.Status.Conditions, typ)
	}
	sc.snapshot = stale
	h.reconcile()
	s := h.get()
	if len(h.cont.execs) != 1 || len(h.netdev.execs) != 1 {
		t.Fatalf("execs %d/%d: the first action ran again from the stale cache", len(h.cont.execs), len(h.netdev.execs))
	}
	if s.Status.Phase != labsv1.SessionReady || s.Status.SetupProgress != 2 {
		t.Fatalf("phase %s progress %d", s.Status.Phase, s.Status.SetupProgress)
	}
}

// A Ready session whose node is lost and recreated, then waits for a
// cluster node (an AKS drain, an evicted VMI), starts a new provisioning
// attempt: the session-level deadline fails it instead of leaving it in
// Provisioning (and billed) until its TTL.
func TestReadySessionLosingNodeFailsAtProvisionDeadline(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	ud := &unschedDriver{fakeDriver: h.cont}
	reg, err := drivers.NewRegistry(ud, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.reconcile()
	if s := h.get(); s.Status.Phase != labsv1.SessionReady {
		t.Fatalf("phase = %s", s.Status.Phase)
	}
	h.now = h.now.Add(3 * time.Hour)
	ud.unscheduled = true
	h.reconcile()
	s := h.get()
	if c := cond(s, labsv1.ConditionProvisioned); c == nil || c.Status != metav1.ConditionFalse || !c.LastTransitionTime.Time.Equal(h.now.Truncate(time.Second)) {
		t.Fatalf("Provisioned = %+v, want a new attempt from now", c)
	}
	h.now = h.now.Add(DefaultProvisionDeadline - time.Minute)
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionProvisioning {
		t.Fatalf("phase before the deadline = %s", got)
	}
	h.now = h.now.Add(2 * time.Minute)
	h.reconcile()
	s = h.get()
	if c := cond(s, labsv1.ConditionReady); s.Status.Phase != labsv1.SessionFailed || c == nil || c.Reason != ReasonProvisionDeadline {
		t.Fatalf("phase %s Ready %+v", s.Status.Phase, c)
	}
}

// stuckReset never finishes resetting (a VM or data-disk PVC that never
// finishes deleting).
type stuckReset struct{ *fakeDriver }

func (d stuckReset) Reset(context.Context, drivers.NodeRef) error { return drivers.ErrInProgress }

// A reset stuck in progress is bounded by the provisioning deadline.
func TestProvisionDeadlineCoversStuckReset(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	reg, err := drivers.NewRegistry(stuckReset{h.cont}, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionReady {
		t.Fatalf("phase = %s", s.Status.Phase)
	}
	h.now = h.now.Add(time.Hour)
	s.Spec.ResetGeneration = 1
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if c := cond(h.get(), labsv1.ConditionProvisioned); c == nil || c.Status != metav1.ConditionFalse {
		t.Fatalf("Provisioned = %+v, want a new attempt for the reset", c)
	}
	h.now = h.now.Add(DefaultProvisionDeadline - time.Minute)
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionProvisioning {
		t.Fatalf("phase before the deadline = %s", got)
	}
	h.now = h.now.Add(2 * time.Minute)
	h.reconcile()
	s = h.get()
	if c := cond(s, labsv1.ConditionReady); s.Status.Phase != labsv1.SessionFailed || c == nil || c.Reason != ReasonProvisionDeadline {
		t.Fatalf("phase %s Ready %+v", s.Status.Phase, c)
	}
}

// Waiting for a LabTemplate that never appears is bounded by the
// provisioning deadline too.
func TestProvisionDeadlineCoversTemplateWait(t *testing.T) {
	h := newHarness(t, session(longTTL))
	h.reconcile()
	if c := cond(h.get(), labsv1.ConditionReady); c == nil || c.Reason != ReasonTemplateNotFound {
		t.Fatalf("Ready = %+v", c)
	}
	h.now = h.now.Add(DefaultProvisionDeadline + time.Minute)
	h.reconcile()
	s := h.get()
	if c := cond(s, labsv1.ConditionReady); s.Status.Phase != labsv1.SessionFailed || c == nil || c.Reason != ReasonProvisionDeadline {
		t.Fatalf("phase %s Ready %+v", s.Status.Phase, c)
	}
}

// A failed session in a namespace that lost its lab label is still
// released after the grace period.
func TestNamespaceNotLabStillReleasesFailed(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	h.cont.phase["workstation"] = labsv1.NodeFailed
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionFailed {
		t.Fatalf("phase = %s", got)
	}
	h.r.Access = &notLabAccess{}
	h.reconcile()
	if len(h.cont.destroyed) != 0 {
		t.Fatalf("released inside the grace period: %v", h.cont.destroyed)
	}
	h.now = h.now.Add(DefaultFailedRelease + time.Minute)
	res := h.reconcile()
	s := h.get()
	if len(h.cont.destroyed) != 1 || len(h.netdev.destroyed) != 1 {
		t.Fatalf("destroyed = %v %v, want every node", h.cont.destroyed, h.netdev.destroyed)
	}
	if c := cond(s, labsv1.ConditionResourcesReleased); c == nil || c.Status != metav1.ConditionTrue {
		t.Errorf("ResourcesReleased = %+v", c)
	}
	if res.RequeueAfter != requeueNamespaceNotLab {
		t.Errorf("requeueAfter = %v, want the label recheck %v", res.RequeueAfter, requeueNamespaceNotLab)
	}
}

// An expired session in a namespace that lost its lab label is still
// collected after the retention.
func TestNamespaceNotLabStillCollectsExpired(t *testing.T) {
	h := newHarness(t, template(), session())
	h.reconcile()
	h.r.Access = &notLabAccess{}
	h.now = t0.Add(time.Hour)
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionExpired {
		t.Fatalf("phase = %s", got)
	}
	h.reconcile()
	if err := h.c.Get(context.Background(), h.sesName, &labsv1.LabSession{}); err != nil {
		t.Fatalf("collected inside the retention: %v", err)
	}
	h.now = h.now.Add(DefaultExpiredRetention + time.Minute)
	h.reconcile() // deletes
	h.reconcile() // finalizer
	if err := h.c.Get(context.Background(), h.sesName, &labsv1.LabSession{}); !apierrors.IsNotFound(err) {
		t.Fatalf("expired session not collected: %v", err)
	}
}

// A Ready KubeVirt session whose VMI is replaced (a crashed VM restarted by
// its run strategy, an evicted VMI) is noticed by the periodic Ready
// recheck: setup is re-armed and runs again on the new instance.
func TestReadyRecheckNoticesReplacedVMI(t *testing.T) {
	tpl := template()
	tpl.Spec.Topology.Nodes[0].Driver = labsv1.DriverVM
	h := newHarness(t, tpl, session(longTTL))
	vm := newFakeDriver(labsv1.DriverVM)
	vm.instance["workstation"] = "vmi-uid-1"
	reg, err := drivers.NewRegistry(vm, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	res := h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionReady || len(vm.execs) != 1 || len(h.netdev.execs) != 1 {
		t.Fatalf("phase %s execs %d/%d", s.Status.Phase, len(vm.execs), len(h.netdev.execs))
	}
	if res.RequeueAfter <= 0 {
		t.Fatalf("Ready session not rechecked: %+v", res)
	}

	// The recheck after the VMI was replaced.
	vm.instance["workstation"] = "vmi-uid-2"
	vm.stdout = func(drivers.ExecRequest) string { h.now = h.now.Add(2 * time.Second); return "" }
	h.r.SetupSlice = time.Second // yield after the first action: observe the re-armed state
	h.now = h.now.Add(res.RequeueAfter)
	h.reconcile()
	s = h.get()
	if c := cond(s, labsv1.ConditionReady); c == nil || c.Status != metav1.ConditionFalse || c.Reason != ReasonNodeReplaced {
		t.Fatalf("Ready = %+v, want False NodeReplaced", c)
	}
	if c := cond(s, labsv1.ConditionProvisioned); c == nil || c.Status != metav1.ConditionFalse {
		t.Fatalf("Provisioned = %+v, want a new attempt", c)
	}
	if len(vm.execs) != 2 {
		t.Fatalf("setup on the replaced VM: %d execs, want the first action again", len(vm.execs))
	}
	h.r.SetupSlice = 0
	vm.stdout = nil
	h.reconcile()
	s = h.get()
	if s.Status.Phase != labsv1.SessionReady || len(vm.execs) != 2 || len(h.netdev.execs) != 2 {
		t.Fatalf("phase %s execs %d/%d, want setup completed again", s.Status.Phase, len(vm.execs), len(h.netdev.execs))
	}
	if n, _ := findNodeStatus(s.Status.Nodes, "workstation"); n.InstanceID != "vmi-uid-2" {
		t.Errorf("instance = %q", n.InstanceID)
	}
}

// A Ready session whose VMI was replaced re-arms setup and runs its first
// slice in the same reconcile. The setup-step requeue can be served from a
// cache that still holds the Ready object (SetupComplete True, the old
// instance): the session is read uncached because this reconciler wrote a
// newer version, and the first action does not run again.
func TestRearmedSetupFromStaleReadyCacheDoesNotRepeatActions(t *testing.T) {
	tpl := template()
	tpl.Spec.Topology.Nodes[0].Driver = labsv1.DriverVM
	h := newHarness(t, tpl, session(longTTL))
	sc := &staleClient{Client: h.c}
	h.r.Client, h.r.Reader = sc, h.c
	vm := newFakeDriver(labsv1.DriverVM)
	vm.instance["workstation"] = "vmi-uid-1"
	reg, err := drivers.NewRegistry(vm, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	res := h.reconcile()
	ready := h.get()
	if ready.Status.Phase != labsv1.SessionReady || len(vm.execs) != 1 {
		t.Fatalf("phase %s execs %d", ready.Status.Phase, len(vm.execs))
	}

	vm.instance["workstation"] = "vmi-uid-2"
	vm.stdout = func(drivers.ExecRequest) string { h.now = h.now.Add(2 * time.Second); return "" }
	h.r.SetupSlice = time.Second
	h.now = h.now.Add(res.RequeueAfter)
	if res := h.reconcile(); res.RequeueAfter != requeueSetupStep {
		t.Fatalf("requeueAfter = %v, want a setup-step requeue", res.RequeueAfter)
	}
	if len(vm.execs) != 2 {
		t.Fatalf("re-armed slice execs %d", len(vm.execs))
	}
	// The requeue runs before the watch delivered the re-arm: the cache
	// still serves the Ready object.
	sc.snapshot = ready
	h.r.SetupSlice = 0
	vm.stdout = nil
	h.reconcile()
	s := h.get()
	if len(vm.execs) != 2 || len(h.netdev.execs) != 2 {
		t.Fatalf("execs %d/%d: the first setup action re-ran from the stale cache", len(vm.execs), len(h.netdev.execs))
	}
	if s.Status.Phase != labsv1.SessionReady || s.Status.SetupProgress != 2 {
		t.Fatalf("phase %s progress %d", s.Status.Phase, s.Status.SetupProgress)
	}
}

// The reset variant: the reset and the first slice run in one reconcile; a
// requeue served the Ready object from before the reset (old
// ObservedResetGeneration) does not reset the nodes again.
func TestResetSliceFromStaleReadyCacheDoesNotResetTwice(t *testing.T) {
	h := newHarness(t, template(), session(longTTL))
	sc := &staleClient{Client: h.c}
	h.r.Client, h.r.Reader = sc, h.c
	h.reconcile()
	s := h.get()
	s.Spec.ResetGeneration = 1
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	stale := h.get()
	h.r.SetupSlice = time.Second
	h.cont.stdout = func(drivers.ExecRequest) string { h.now = h.now.Add(2 * time.Second); return "" }
	if res := h.reconcile(); res.RequeueAfter != requeueSetupStep {
		t.Fatalf("requeueAfter = %v, want a setup-step requeue", res.RequeueAfter)
	}
	if len(h.cont.resets) != 1 || len(h.cont.execs) != 2 {
		t.Fatalf("resets %d execs %d", len(h.cont.resets), len(h.cont.execs))
	}
	sc.snapshot = stale
	h.r.SetupSlice = 0
	h.cont.stdout = nil
	h.reconcile()
	s = h.get()
	if len(h.cont.resets) != 1 || len(h.netdev.resets) != 1 {
		t.Fatalf("resets %v %v: the nodes were reset twice from the stale cache", h.cont.resets, h.netdev.resets)
	}
	if len(h.cont.execs) != 2 || s.Status.ObservedResetGeneration != 1 || s.Status.Phase != labsv1.SessionReady {
		t.Fatalf("execs %d observed %d phase %s", len(h.cont.execs), s.Status.ObservedResetGeneration, s.Status.Phase)
	}
}
