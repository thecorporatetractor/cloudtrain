package controller

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// poolHarness runs the WarmPool and LabSession reconcilers against one fake client.
type poolHarness struct {
	t      *testing.T
	c      client.Client
	pool   *WarmPoolReconciler
	ls     *LabSessionReconciler
	now    time.Time
	cont   *fakeDriver
	netdev *fakeDriver
	seeds  int64
}

func newPoolHarness(t *testing.T, objs ...client.Object) *poolHarness {
	t.Helper()
	s := scheme(t)
	c := fake.NewClientBuilder().WithScheme(s).WithObjects(objs...).
		WithStatusSubresource(&labsv1.LabSession{}, &labsv1.WarmPool{}).Build()
	h := &poolHarness{t: t, c: c, now: t0.Add(time.Minute),
		cont: newFakeDriver(labsv1.DriverContainer), netdev: newFakeDriver(labsv1.DriverNetdev)}
	reg, err := drivers.NewRegistry(h.cont, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	now := func() time.Time { return h.now }
	h.ls = &LabSessionReconciler{Client: c, Scheme: s, Drivers: reg, Now: now}
	h.pool = &WarmPoolReconciler{Client: c, Scheme: s, Now: now, Seed: func() int64 { h.seeds++; return h.seeds }}
	return h
}

func warmPool(mut ...func(*labsv1.WarmPool)) *labsv1.WarmPool {
	p := &labsv1.WarmPool{
		ObjectMeta: metav1.ObjectMeta{Name: "wp", Namespace: ns, UID: "uid-wp",
			Labels: map[string]string{"labs.cloudtrain.dev/proof": "wp"}},
		Spec: labsv1.WarmPoolSpec{TemplateRef: labsv1.TemplateReference{Name: "net-lab-v1"}, Size: 2,
			MaxSurge: ptr.To[int32](2)},
	}
	for _, m := range mut {
		m(p)
	}
	return p
}

func claimant(name string, mut ...func(*labsv1.LabSession)) *labsv1.LabSession {
	return session(append([]func(*labsv1.LabSession){func(s *labsv1.LabSession) {
		s.Name, s.UID = name, types.UID("uid-"+name)
		s.Spec.WarmPoolRef = "wp"
		s.Spec.Learner.ID = "learner-" + name
	}}, mut...)...)
}

func (h *poolHarness) reconcilePool() ctrl.Result {
	h.t.Helper()
	res, err := h.pool.Reconcile(context.Background(), ctrl.Request{NamespacedName: types.NamespacedName{Namespace: ns, Name: "wp"}})
	if err != nil {
		h.t.Fatalf("pool reconcile: %v", err)
	}
	return res
}

func (h *poolHarness) reconcileSession(name string) ctrl.Result {
	h.t.Helper()
	res, err := h.ls.Reconcile(context.Background(), ctrl.Request{NamespacedName: types.NamespacedName{Namespace: ns, Name: name}})
	if err != nil {
		h.t.Fatalf("session %s reconcile: %v", name, err)
	}
	return res
}

func (h *poolHarness) getPool() *labsv1.WarmPool {
	h.t.Helper()
	p := &labsv1.WarmPool{}
	if err := h.c.Get(context.Background(), types.NamespacedName{Namespace: ns, Name: "wp"}, p); err != nil {
		h.t.Fatal(err)
	}
	return p
}

func (h *poolHarness) getSession(name string) *labsv1.LabSession {
	h.t.Helper()
	s := &labsv1.LabSession{}
	if err := h.c.Get(context.Background(), types.NamespacedName{Namespace: ns, Name: name}, s); err != nil {
		h.t.Fatal(err)
	}
	return s
}

// pooled lists the pool's sessions (sorted by name), claimed or not.
func (h *poolHarness) pooled() []labsv1.LabSession {
	h.t.Helper()
	list := &labsv1.LabSessionList{}
	if err := h.c.List(context.Background(), list, client.MatchingLabels{labsv1.LabelWarmPool: "wp"}); err != nil {
		h.t.Fatal(err)
	}
	sort.Slice(list.Items, func(i, j int) bool { return list.Items[i].Name < list.Items[j].Name })
	return list.Items
}

// settle reconciles every pooled session (fake drivers: Ready in one pass).
func (h *poolHarness) settle() {
	h.t.Helper()
	for _, s := range h.pooled() {
		h.reconcileSession(s.Name)
	}
}

func (h *poolHarness) fill() {
	h.t.Helper()
	h.reconcilePool()
	h.settle()
	h.reconcilePool()
}

func TestWarmPoolFillsWithinSurge(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size, p.Spec.MaxSurge = 3, nil }))
	h.reconcilePool()
	if got := len(h.pooled()); got != 1 {
		t.Fatalf("created %d sessions with default maxSurge 1, want 1", got)
	}
	p := h.getPool()
	if p.Status.Provisioning != 1 || p.Status.Ready != 0 || meta.IsStatusConditionTrue(p.Status.Conditions, labsv1.PoolConditionReady) {
		t.Errorf("status = %+v", p.Status)
	}
	h.reconcilePool() // still provisioning: no second one
	if got := len(h.pooled()); got != 1 {
		t.Fatalf("surge exceeded: %d sessions", got)
	}
	for i := 0; i < 3; i++ {
		h.settle()
		h.reconcilePool()
	}
	p = h.getPool()
	if p.Status.Ready != 3 || p.Status.Provisioning != 0 || !meta.IsStatusConditionTrue(p.Status.Conditions, labsv1.PoolConditionReady) {
		t.Fatalf("status = %+v", p.Status)
	}
	seeds := map[int64]bool{}
	for _, s := range h.pooled() {
		if s.Labels["labs.cloudtrain.dev/proof"] != "wp" || s.Labels[labsv1.LabelWarmPool] != "wp" {
			t.Errorf("%s labels = %v", s.Name, s.Labels)
		}
		if !metav1.IsControlledBy(&s, p) {
			t.Errorf("%s not owned by the pool: %+v", s.Name, s.OwnerReferences)
		}
		if s.Spec.Learner.ID != "warmpool:wp" || s.Status.Phase != labsv1.SessionReady {
			t.Errorf("%s learner %q phase %s", s.Name, s.Spec.Learner.ID, s.Status.Phase)
		}
		if s.Status.ExpiresAt != nil {
			t.Errorf("%s: unclaimed pooled session has an expiry %v", s.Name, s.Status.ExpiresAt)
		}
		seeds[s.Spec.Seed] = true
	}
	if len(seeds) != 3 {
		t.Errorf("seeds not distinct: %v", seeds)
	}
}

func TestPooledSessionNeverExpiresUnclaimed(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size = 1 }))
	h.fill()
	name := h.pooled()[0].Name
	h.now = t0.Add(72 * time.Hour)
	res := h.reconcileSession(name)
	s := h.getSession(name)
	if s.Status.Phase != labsv1.SessionReady || len(h.cont.destroyed) != 0 {
		t.Fatalf("pooled session expired: phase %s destroyed %v", s.Status.Phase, h.cont.destroyed)
	}
	if res.RequeueAfter != 0 {
		t.Errorf("requeueAfter = %v, want none", res.RequeueAfter)
	}
}

func TestWarmPoolShrinksAndReplacesFailed(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size = 3; p.Spec.MaxSurge = ptr.To[int32](3) }))
	h.reconcilePool()
	all := h.pooled()
	// Two become ready, one stays provisioning.
	h.reconcileSession(all[0].Name)
	h.reconcileSession(all[1].Name)
	h.reconcilePool()

	p := h.getPool()
	p.Spec.Size = 1
	if err := h.c.Update(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	h.reconcilePool()
	// The provisioning one goes first, then the newest ready one.
	var left []string
	for _, s := range h.pooled() {
		if s.DeletionTimestamp.IsZero() {
			left = append(left, s.Name)
		}
	}
	if len(left) != 1 {
		t.Fatalf("left = %v, want 1", left)
	}
	if st := h.getSession(left[0]).Status.Phase; st != labsv1.SessionReady {
		t.Errorf("kept a %s session, want a ready one", st)
	}
	// The pooled sessions have the session finalizer: let them tear down.
	h.settle()

	// A failed pooled session is deleted and replaced after a backoff.
	s := h.getSession(left[0])
	s.Status.Phase = labsv1.SessionFailed
	meta.SetStatusCondition(&s.Status.Conditions, metav1.Condition{Type: labsv1.ConditionReady, Status: metav1.ConditionFalse, Reason: "NodeFailed", Message: "node boom"})
	if err := h.c.Status().Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	res := h.reconcilePool()
	p = h.getPool()
	if c := meta.FindStatusCondition(p.Status.Conditions, labsv1.PoolConditionDegraded); c == nil || c.Status != metav1.ConditionTrue {
		t.Errorf("Degraded = %+v", c)
	}
	if res.RequeueAfter != requeuePoolBackoff {
		t.Errorf("requeueAfter = %v", res.RequeueAfter)
	}
	h.settle() // failed one torn down
	h.reconcilePool()
	live := 0
	for _, s := range h.pooled() {
		if s.DeletionTimestamp.IsZero() && s.Status.Phase != labsv1.SessionFailed {
			live++
		}
	}
	if live != 1 {
		t.Errorf("replacement not created: %d live", live)
	}
}

func TestWarmPoolRecyclesIdle(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) {
		p.Spec.Size = 1
		p.Spec.MaxIdle = &metav1.Duration{Duration: time.Hour}
	}))
	h.reconcilePool()
	// The fake client does not set creation timestamps.
	s := h.pooled()[0]
	s.CreationTimestamp = metav1.NewTime(h.now)
	if err := h.c.Update(context.Background(), &s); err != nil {
		t.Fatal(err)
	}
	h.settle()
	res := h.reconcilePool()
	if res.RequeueAfter != time.Hour {
		t.Errorf("requeueAfter = %v, want 1h", res.RequeueAfter)
	}
	h.now = h.now.Add(time.Hour)
	h.reconcilePool()
	if got := h.getSession(s.Name); got.DeletionTimestamp.IsZero() {
		t.Error("idle pooled session not recycled")
	}
}

func TestClaimServesPooledSession(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size = 1 }))
	h.fill()
	pooledName := h.pooled()[0].Name
	execsBefore := len(h.cont.execs)

	x := claimant("x1", func(s *labsv1.LabSession) { s.Spec.TTL = &metav1.Duration{Duration: 2 * time.Hour} })
	if err := h.c.Create(context.Background(), x); err != nil {
		t.Fatal(err)
	}
	h.reconcileSession("x1")
	got := h.getSession("x1")
	if got.Status.Phase != labsv1.SessionReady || got.Status.PooledSession != pooledName || got.Status.ReadyAt == nil {
		t.Fatalf("claimant status = %+v", got.Status)
	}
	if c := cond(got, labsv1.ConditionClaimed); c == nil || c.Status != metav1.ConditionTrue {
		t.Errorf("Claimed = %+v", c)
	}
	if len(got.Status.Endpoints) != 3 || got.Status.EntryNode != "workstation" || got.Status.ResolvedParams["site"] == "" {
		t.Errorf("claimant does not mirror the pooled session: %+v", got.Status)
	}
	if len(h.cont.execs) != execsBefore {
		t.Error("claim re-ran setup")
	}
	p := h.getSession(pooledName)
	if p.Labels[labsv1.LabelClaimedBy] != "uid-x1" || p.Annotations[labsv1.AnnotationClaimedByName] != "x1" {
		t.Errorf("pooled labels = %v annotations = %v", p.Labels, p.Annotations)
	}
	if !metav1.IsControlledBy(p, got) {
		t.Errorf("pooled owner = %+v, want the claimant", p.OwnerReferences)
	}
	if p.Spec.Learner.ID != "learner-x1" || p.Spec.ExpiresAt == nil || !p.Spec.ExpiresAt.Time.Equal(t0.Add(2*time.Hour)) {
		t.Errorf("forwarded spec = %+v", p.Spec)
	}
	// The pooled session now expires with the claimant.
	h.reconcileSession(pooledName)
	if exp := h.getSession(pooledName).Status.ExpiresAt; exp == nil || !exp.Time.Equal(t0.Add(2*time.Hour)) {
		t.Errorf("pooled expiresAt = %v", exp)
	}
	// The pool counts it as claimed and refills.
	h.reconcilePool()
	pool := h.getPool()
	if pool.Status.Claimed != 1 || pool.Status.Provisioning != 1 || pool.Status.Ready != 0 {
		t.Errorf("pool status = %+v", pool.Status)
	}
	if n := len(h.pooled()); n != 2 {
		t.Errorf("pool did not refill: %d sessions", n)
	}
	// Deleting the pool leaves the claimed session alone (GC follows owners).
	if !metav1.IsControlledBy(p, got) {
		t.Fatal("claimed session still owned by the pool")
	}
}

func TestClaimConcurrentNoDoubleClaim(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size = 3; p.Spec.MaxSurge = ptr.To[int32](3) }))
	h.fill()
	const n = 6
	for i := 0; i < n; i++ {
		if err := h.c.Create(context.Background(), claimant(fmt.Sprintf("x%d", i))); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := h.ls.Reconcile(context.Background(), ctrl.Request{NamespacedName: types.NamespacedName{Namespace: ns, Name: fmt.Sprintf("x%d", i)}})
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	served := map[string]string{}
	cold := 0
	for i := 0; i < n; i++ {
		x := h.getSession(fmt.Sprintf("x%d", i))
		c := cond(x, labsv1.ConditionClaimed)
		switch {
		case c != nil && c.Status == metav1.ConditionTrue:
			if prev, dup := served[x.Status.PooledSession]; dup {
				t.Errorf("pooled session %s claimed by %s and %s", x.Status.PooledSession, prev, x.Name)
			}
			served[x.Status.PooledSession] = x.Name
		case c != nil && c.Reason == ReasonPoolExhausted:
			cold++
		default:
			t.Errorf("%s: Claimed = %+v", x.Name, c)
		}
	}
	if len(served) != 3 || cold != 3 {
		t.Errorf("served = %v, cold = %d", served, cold)
	}
	for _, p := range h.pooled() {
		if owner := p.Annotations[labsv1.AnnotationClaimedByName]; served[p.Name] != owner {
			t.Errorf("pooled %s claimed-by %q, claimant record %q", p.Name, owner, served[p.Name])
		}
	}
}

func TestClaimStaleCandidateConflicts(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size = 1 }))
	h.fill()
	stale := h.pooled()[0]
	for _, name := range []string{"x1", "x2"} {
		if err := h.c.Create(context.Background(), claimant(name)); err != nil {
			t.Fatal(err)
		}
	}
	h.reconcileSession("x1")
	x2 := h.getSession("x2")
	err := h.ls.tryClaim(context.Background(), x2, &stale, metav1.NewTime(t0.Add(time.Hour)))
	if !apierrors.IsConflict(err) {
		t.Fatalf("claim with a stale resourceVersion: err = %v, want conflict", err)
	}
	if got := h.getSession(stale.Name).Labels[labsv1.LabelClaimedBy]; got != "uid-x1" {
		t.Errorf("claimed-by = %q", got)
	}
}

func TestClaimFallsBackToColdProvisioning(t *testing.T) {
	h := newPoolHarness(t, template(), claimant("x1"))
	h.reconcileSession("x1")
	x := h.getSession("x1")
	if c := cond(x, labsv1.ConditionClaimed); c == nil || c.Status != metav1.ConditionFalse || c.Reason != ReasonPoolNotFound {
		t.Fatalf("Claimed = %+v", c)
	}
	if x.Status.Phase != labsv1.SessionReady || x.Status.PooledSession != "" || x.Status.Topology == nil {
		t.Errorf("not provisioned cold: %+v", x.Status)
	}
	// A pool that appears later is not used any more.
	if err := h.c.Create(context.Background(), warmPool()); err != nil {
		t.Fatal(err)
	}
	h.fill()
	h.reconcileSession("x1")
	if got := h.getSession("x1").Status.PooledSession; got != "" {
		t.Errorf("cold session claimed %s later", got)
	}
}

func TestClaimForwardsHibernateResetAndGrading(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size = 1 }))
	h.fill()
	pooledName := h.pooled()[0].Name
	if err := h.c.Create(context.Background(), claimant("x1")); err != nil {
		t.Fatal(err)
	}
	h.reconcileSession("x1")

	update := func(mut func(*labsv1.LabSession)) {
		t.Helper()
		x := h.getSession("x1")
		mut(x)
		if err := h.c.Update(context.Background(), x); err != nil {
			t.Fatal(err)
		}
		h.reconcileSession("x1")       // forward
		h.reconcileSession(pooledName) // act
		h.reconcileSession("x1")       // mirror
	}
	update(func(x *labsv1.LabSession) { x.Spec.Hibernate = true })
	if x := h.getSession("x1"); x.Status.Phase != labsv1.SessionHibernated || !x.Status.Hibernated {
		t.Errorf("claimant not hibernated: %s", x.Status.Phase)
	}
	if fmt.Sprint(h.netdev.hibernated) != "[rtr]" {
		t.Errorf("hibernated = %v", h.netdev.hibernated)
	}
	update(func(x *labsv1.LabSession) { x.Spec.Hibernate = false })
	if x := h.getSession("x1"); x.Status.Phase != labsv1.SessionReady {
		t.Errorf("claimant not resumed: %s", x.Status.Phase)
	}
	update(func(x *labsv1.LabSession) { x.Spec.ResetGeneration = 1 })
	if x := h.getSession("x1"); x.Status.ObservedResetGeneration != 1 || x.Status.Phase != labsv1.SessionReady {
		t.Errorf("reset not mirrored: %+v", x.Status)
	}
	if fmt.Sprint(h.cont.resets) != "[workstation]" {
		t.Errorf("resets = %v", h.cont.resets)
	}
}

func TestClaimantDeletionDeletesPooledSession(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size = 1 }))
	h.fill()
	pooledName := h.pooled()[0].Name
	if err := h.c.Create(context.Background(), claimant("x1")); err != nil {
		t.Fatal(err)
	}
	h.reconcileSession("x1")
	if err := h.c.Delete(context.Background(), h.getSession("x1")); err != nil {
		t.Fatal(err)
	}
	res := h.reconcileSession("x1")
	if res.RequeueAfter != requeueTeardown {
		t.Errorf("claimant released before its pooled session: %+v", res)
	}
	if p := h.getSession(pooledName); p.DeletionTimestamp.IsZero() {
		t.Fatal("pooled session not deleted")
	}
	h.reconcileSession(pooledName) // tears down, drops its finalizer
	if fmt.Sprint(h.cont.destroyed) != "[workstation]" {
		t.Errorf("destroyed = %v", h.cont.destroyed)
	}
	h.reconcileSession("x1")
	err := h.c.Get(context.Background(), types.NamespacedName{Namespace: ns, Name: "x1"}, &labsv1.LabSession{})
	if !apierrors.IsNotFound(err) {
		t.Errorf("claimant still present: %v", err)
	}
}

func TestClaimantExpiryTearsDownPooledSession(t *testing.T) {
	h := newPoolHarness(t, template(), warmPool(func(p *labsv1.WarmPool) { p.Spec.Size = 1 }))
	h.fill()
	pooledName := h.pooled()[0].Name
	if err := h.c.Create(context.Background(), claimant("x1", func(s *labsv1.LabSession) {
		s.Spec.TTL = &metav1.Duration{Duration: time.Hour}
		s.Spec.Hibernate = true
	})); err != nil {
		t.Fatal(err)
	}
	h.reconcileSession("x1")
	h.reconcileSession(pooledName)
	h.reconcileSession("x1")
	if got := h.getSession("x1").Status.Phase; got != labsv1.SessionHibernated {
		t.Fatalf("phase = %s", got)
	}
	h.now = t0.Add(time.Hour)
	h.reconcileSession(pooledName)
	h.reconcileSession("x1")
	x := h.getSession("x1")
	if x.Status.Phase != labsv1.SessionExpired || !meta.IsStatusConditionTrue(x.Status.Conditions, labsv1.ConditionExpired) {
		t.Errorf("claimant phase = %s", x.Status.Phase)
	}
	if fmt.Sprint(h.cont.destroyed, h.netdev.destroyed) != "[workstation] [rtr]" {
		t.Errorf("destroyed = %v %v", h.cont.destroyed, h.netdev.destroyed)
	}
}

// resettingDriver reports a reset in progress a number of times first.
type resettingDriver struct {
	*fakeDriver
	pending int
}

func (d *resettingDriver) Reset(ctx context.Context, ref drivers.NodeRef) error {
	_ = d.fakeDriver.Reset(ctx, ref)
	if d.pending > 0 {
		d.pending--
		return fmt.Errorf("volume terminating: %w", drivers.ErrInProgress)
	}
	return nil
}

func TestResetInProgressRequeuesAndRerunsSetup(t *testing.T) {
	h := newHarness(t, template(), session())
	rd := &resettingDriver{fakeDriver: h.cont, pending: 2}
	reg, err := drivers.NewRegistry(rd, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.reconcile()
	s := h.get()
	s.Spec.ResetGeneration = 1
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if res := h.reconcile(); res.RequeueAfter != requeueTeardown {
			t.Fatalf("pass %d: requeueAfter = %v", i, res.RequeueAfter)
		}
		if s := h.get(); s.Status.Phase != labsv1.SessionProvisioning || s.Status.ObservedResetGeneration != 0 {
			t.Fatalf("pass %d: status = %s / %d", i, s.Status.Phase, s.Status.ObservedResetGeneration)
		}
	}
	h.reconcile()
	s = h.get()
	if s.Status.Phase != labsv1.SessionReady || s.Status.ObservedResetGeneration != 1 || len(h.cont.execs) != 2 {
		t.Errorf("after reset: %s observed %d execs %d", s.Status.Phase, s.Status.ObservedResetGeneration, len(h.cont.execs))
	}
}

func TestResumeKeepsLearnerStateNoSetupRerun(t *testing.T) {
	h := newHarness(t, template(), session())
	hc := hibernatingDriver{h.cont}
	reg, err := drivers.NewRegistry(hc, hibernatingDriver{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.cont.instance["workstation"] = "pod-a/0"
	h.reconcile()
	s := h.get()
	s.Spec.Hibernate = true
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if got := h.get().Status.Phase; got != labsv1.SessionHibernated {
		t.Fatalf("phase = %s", got)
	}
	// Resume: the pod is recreated (new instance) on its persistent home volume.
	h.cont.instance["workstation"] = "pod-b/0"
	s = h.get()
	s.Spec.Hibernate = false
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	s = h.get()
	if s.Status.Phase != labsv1.SessionReady || s.Status.Nodes[0].InstanceID != "pod-b/0" {
		t.Fatalf("status = %s %+v", s.Status.Phase, s.Status.Nodes)
	}
	if len(h.cont.execs) != 1 || len(h.netdev.execs) != 1 {
		t.Errorf("setup re-ran on resume: %d %d", len(h.cont.execs), len(h.netdev.execs))
	}
	// A later, unexpected recreation still re-runs setup.
	h.cont.instance["workstation"] = "pod-b/1"
	h.reconcile()
	if len(h.cont.execs) != 2 {
		t.Errorf("setup not re-run after a crash: %d", len(h.cont.execs))
	}
}

// unsupportedHibernator refuses to hibernate (keeps running).
type unsupportedHibernator struct{ *fakeDriver }

func (u unsupportedHibernator) Hibernate(context.Context, drivers.NodeRef) error {
	return fmt.Errorf("netdev: %w", drivers.ErrUnsupported)
}

func TestHibernateUnsupportedNodeKeepsRunning(t *testing.T) {
	h := newHarness(t, template(), session(func(s *labsv1.LabSession) { s.Spec.Hibernate = false }))
	reg, err := drivers.NewRegistry(hibernatingDriver{h.cont}, unsupportedHibernator{h.netdev})
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.reconcile()
	s := h.get()
	s.Spec.Hibernate = true
	if err := h.c.Update(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	s = h.get()
	if !meta.IsStatusConditionTrue(s.Status.Conditions, labsv1.ConditionHibernated) {
		t.Fatalf("Hibernated = %+v", cond(s, labsv1.ConditionHibernated))
	}
	for _, n := range s.Status.Nodes {
		if n.Name == "rtr" && (n.Phase != labsv1.NodeReady || n.Message != "") {
			t.Errorf("rtr = %+v", n)
		}
	}
}
