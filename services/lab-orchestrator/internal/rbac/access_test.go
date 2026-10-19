package rbac

import (
	"context"
	"errors"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func labNS(name string, lab bool) *corev1.Namespace {
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name}}
	if lab {
		ns.Labels = map[string]string{drivers.LabelLabNamespace: "true"}
	}
	return ns
}

func newAccess(t *testing.T, objs ...client.Object) (*SessionAccess, client.Client) {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	c := fake.NewClientBuilder().WithScheme(scheme).WithObjects(objs...).Build()
	return &SessionAccess{Client: c, ClusterRole: DefaultSessionClusterRole,
		ServiceAccount: "lab-orchestrator", ServiceAccountNamespace: "cloudtrain-system"}, c
}

func TestEnsureBindsInLabNamespace(t *testing.T) {
	a, c := newAccess(t, labNS("ctv-a", true))
	if err := a.Ensure(context.Background(), "ctv-a"); err != nil {
		t.Fatal(err)
	}
	rb := &rbacv1.RoleBinding{}
	if err := c.Get(context.Background(), client.ObjectKey{Namespace: "ctv-a", Name: DefaultSessionClusterRole}, rb); err != nil {
		t.Fatal(err)
	}
	if rb.RoleRef.Kind != "ClusterRole" || rb.RoleRef.Name != DefaultSessionClusterRole {
		t.Errorf("roleRef %+v", rb.RoleRef)
	}
	want := rbacv1.Subject{Kind: "ServiceAccount", Name: "lab-orchestrator", Namespace: "cloudtrain-system"}
	if len(rb.Subjects) != 1 || rb.Subjects[0] != want {
		t.Errorf("subjects %+v", rb.Subjects)
	}
	if rb.Labels[drivers.LabelManagedBy] != drivers.ManagedBy {
		t.Errorf("labels %v", rb.Labels)
	}
}

func TestEnsureRefusesNamespaceWithoutLabel(t *testing.T) {
	a, c := newAccess(t, labNS("kube-system", false))
	err := a.Ensure(context.Background(), "kube-system")
	if !errors.Is(err, ErrNamespaceNotLab) {
		t.Fatalf("want ErrNamespaceNotLab, got %v", err)
	}
	list := &rbacv1.RoleBindingList{}
	if err := c.List(context.Background(), list); err != nil {
		t.Fatal(err)
	}
	if len(list.Items) != 0 {
		t.Errorf("created %d RoleBindings", len(list.Items))
	}
}

func TestEnsureRepairsSubjectsAndRoleRef(t *testing.T) {
	stale := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Namespace: "ctv-a", Name: DefaultSessionClusterRole},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: DefaultSessionClusterRole},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "someone", Namespace: "elsewhere"}, {Kind: "User", Name: "x"}},
	}
	a, c := newAccess(t, labNS("ctv-a", true), stale)
	if err := a.Ensure(context.Background(), "ctv-a"); err != nil {
		t.Fatal(err)
	}
	rb := &rbacv1.RoleBinding{}
	_ = c.Get(context.Background(), client.ObjectKeyFromObject(stale), rb)
	if len(rb.Subjects) != 1 || rb.Subjects[0] != a.Subject() {
		t.Errorf("subjects not repaired: %+v", rb.Subjects)
	}

	wrongRole := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Namespace: "ctv-b", Name: DefaultSessionClusterRole},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "edit"},
		Subjects:   []rbacv1.Subject{a.Subject()},
	}
	if err := c.Create(context.Background(), labNS("ctv-b", true)); err != nil {
		t.Fatal(err)
	}
	if err := c.Create(context.Background(), wrongRole); err != nil {
		t.Fatal(err)
	}
	if err := a.Ensure(context.Background(), "ctv-b"); err != nil {
		t.Fatal(err)
	}
	_ = c.Get(context.Background(), client.ObjectKeyFromObject(wrongRole), rb)
	if rb.RoleRef.Name != DefaultSessionClusterRole {
		t.Errorf("roleRef not replaced: %+v", rb.RoleRef)
	}
}

func TestEnsureRemembersAndRechecks(t *testing.T) {
	now := time.Unix(1000, 0)
	a, c := newAccess(t, labNS("ctv-a", true))
	a.Now = func() time.Time { return now }
	ctx := context.Background()
	if err := a.Ensure(ctx, "ctv-a"); err != nil {
		t.Fatal(err)
	}
	key := client.ObjectKey{Namespace: "ctv-a", Name: DefaultSessionClusterRole}
	if err := c.Delete(ctx, &rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Namespace: key.Namespace, Name: key.Name}}); err != nil {
		t.Fatal(err)
	}
	// Remembered: no API call, no new binding.
	if err := a.Ensure(ctx, "ctv-a"); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, key, &rbacv1.RoleBinding{}); err == nil {
		t.Fatal("binding recreated before the recheck interval")
	}
	// Forget (after a Forbidden error) and expiry both check again.
	a.Forget("ctv-a")
	if err := a.Ensure(ctx, "ctv-a"); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, key, &rbacv1.RoleBinding{}); err != nil {
		t.Fatalf("binding not recreated after Forget: %v", err)
	}
	_ = c.Delete(ctx, &rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Namespace: key.Namespace, Name: key.Name}})
	now = now.Add(DefaultRecheck + time.Second)
	if err := a.Ensure(ctx, "ctv-a"); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, key, &rbacv1.RoleBinding{}); err != nil {
		t.Fatalf("binding not recreated after the recheck interval: %v", err)
	}
}

func TestNilAccessGrantsNothing(t *testing.T) {
	var a *SessionAccess
	if err := a.Ensure(context.Background(), "anything"); err != nil {
		t.Fatal(err)
	}
	a.Forget("anything")
	if err := (&SessionAccess{}).Ensure(context.Background(), "anything"); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureHeldAndRelease(t *testing.T) {
	ctx := context.Background()
	ns := labNS("ctv-a", true)
	ns.Finalizers = []string{"kubernetes"} // keeps it Terminating in the fake client
	a, c := newAccess(t, ns)
	if err := a.EnsureHeld(ctx, "ctv-a"); err != nil {
		t.Fatal(err)
	}
	key := client.ObjectKey{Namespace: "ctv-a", Name: DefaultSessionClusterRole}
	rb := &rbacv1.RoleBinding{}
	if err := c.Get(ctx, key, rb); err != nil {
		t.Fatal(err)
	}
	if len(rb.Finalizers) != 1 || rb.Finalizers[0] != Finalizer {
		t.Fatalf("finalizers = %v", rb.Finalizers)
	}
	// The namespace and (by the namespace controller) the binding are deleted
	// while a session is still there: the binding stays until Release.
	if err := c.Delete(ctx, ns); err != nil {
		t.Fatal(err)
	}
	if err := c.Delete(ctx, rb); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, key, rb); err != nil || rb.DeletionTimestamp == nil {
		t.Fatalf("binding gone before Release: %v", err)
	}
	a.Forget("ctv-a")
	if err := a.EnsureHeld(ctx, "ctv-a"); err != nil {
		t.Fatalf("EnsureHeld on a terminating binding: %v", err)
	}
	if err := a.Release(ctx, "ctv-a"); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, key, rb); err == nil {
		t.Fatalf("binding survived Release: %v", rb.Finalizers)
	}

	// Last session gone in a live namespace: the finalizer goes (so a later
	// namespace deletion does not wait for it), the next session adds it back.
	b, cb := newAccess(t, labNS("ctv-b", true))
	if err := b.EnsureHeld(ctx, "ctv-b"); err != nil {
		t.Fatal(err)
	}
	if err := b.Release(ctx, "ctv-b"); err != nil {
		t.Fatal(err)
	}
	keyB := client.ObjectKey{Namespace: "ctv-b", Name: DefaultSessionClusterRole}
	if err := cb.Get(ctx, keyB, rb); err != nil || len(rb.Finalizers) != 0 {
		t.Fatalf("after Release: %v %v", err, rb.Finalizers)
	}
	if err := b.EnsureHeld(ctx, "ctv-b"); err != nil {
		t.Fatal(err)
	}
	if err := cb.Get(ctx, keyB, rb); err != nil || len(rb.Finalizers) != 1 {
		t.Fatalf("finalizer not added back: %v %v", err, rb.Finalizers)
	}

	// Plain Ensure (vcluster host namespaces, deleted by the manager itself)
	// adds no finalizer.
	v, c2 := newAccess(t, labNS("ct-vc-1", true))
	if err := v.Ensure(ctx, "ct-vc-1"); err != nil {
		t.Fatal(err)
	}
	_ = c2.Get(ctx, client.ObjectKey{Namespace: "ct-vc-1", Name: DefaultSessionClusterRole}, rb)
	if len(rb.Finalizers) != 0 {
		t.Errorf("host namespace binding has finalizers %v", rb.Finalizers)
	}
}
