package rbac

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/util/retry"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// ErrNamespaceNotLab: the namespace lacks labs.cloudtrain.dev/lab-namespace=true,
// so the orchestrator does not grant itself access there.
var ErrNamespaceNotLab = errors.New("namespace is not a lab namespace")

// DefaultRecheck is how long a namespace stays known as bound before
// SessionAccess checks the RoleBinding again.
const DefaultRecheck = 5 * time.Minute

// Finalizer holds the session RoleBinding of a session namespace while it
// has LabSessions (EnsureHeld, Release): deleting a namespace
// deletes its RoleBindings early, and without it the manager could not
// clean up (Forbidden) and the LabSession finalizers would block the
// namespace forever. A RoleBinding that is being deleted still authorizes.
const Finalizer = "labs.cloudtrain.dev/session-access"

// SessionAccess binds the session ClusterRole to the orchestrator's
// ServiceAccount in lab namespaces (a RoleBinding named after the
// ClusterRole). The manager may create RoleBindings cluster-wide but may
// bind only that ClusterRole (bind with resourceNames) and nothing it does
// not hold itself; the ValidatingAdmissionPolicy limits the binding to
// labelled namespaces and to the orchestrator as its only subject.
type SessionAccess struct {
	Client client.Client
	// Reader is an uncached reader (Namespaces and RoleBindings are not
	// cached: the manager may not list them cluster-wide).
	Reader client.Reader
	// ClusterRole is the session ClusterRole (DefaultSessionClusterRole).
	ClusterRole string
	// ServiceAccount is the orchestrator's own ServiceAccount.
	ServiceAccount, ServiceAccountNamespace string
	// Recheck (default DefaultRecheck) and Now (tests).
	Recheck time.Duration
	Now     func() time.Time

	mu    sync.Mutex
	bound map[string]time.Time // key: namespace, or namespace + "\x00held"
}

var _ drivers.NamespaceAccess = (*SessionAccess)(nil)

func (a *SessionAccess) now() time.Time {
	if a.Now != nil {
		return a.Now()
	}
	return time.Now()
}

func (a *SessionAccess) reader() client.Reader {
	if a.Reader != nil {
		return a.Reader
	}
	return a.Client
}

// Subject is the orchestrator's ServiceAccount as a RoleBinding subject.
func (a *SessionAccess) Subject() rbacv1.Subject {
	return rbacv1.Subject{Kind: rbacv1.ServiceAccountKind, Name: a.ServiceAccount, Namespace: a.ServiceAccountNamespace}
}

// Ensure makes sure the session ClusterRole is bound to the orchestrator in
// namespace. It returns ErrNamespaceNotLab (wrapped) for namespaces without
// the lab label. A nil SessionAccess grants nothing (the operator binds the
// permissions itself) and always succeeds.
func (a *SessionAccess) Ensure(ctx context.Context, namespace string) error {
	return a.ensure(ctx, namespace, false)
}

// EnsureHeld is Ensure for a namespace that holds LabSessions: the binding
// carries Finalizer, so it survives the namespace's deletion until Release.
func (a *SessionAccess) EnsureHeld(ctx context.Context, namespace string) error {
	return a.ensure(ctx, namespace, true)
}

func (a *SessionAccess) ensure(ctx context.Context, namespace string, held bool) error {
	if a == nil || a.ClusterRole == "" {
		return nil
	}
	key := namespace
	if held {
		key += "\x00held"
	}
	a.mu.Lock()
	until, ok := a.bound[key]
	a.mu.Unlock()
	if ok && a.now().Before(until) {
		return nil
	}
	ns := &corev1.Namespace{}
	if err := a.reader().Get(ctx, client.ObjectKey{Name: namespace}, ns); err != nil {
		return fmt.Errorf("lab namespace %s: %w", namespace, err)
	}
	if ns.Labels[drivers.LabelLabNamespace] != "true" {
		return fmt.Errorf("%s lacks the label %s=true: %w", namespace, drivers.LabelLabNamespace, ErrNamespaceNotLab)
	}
	if err := a.ensureBinding(ctx, namespace, held); err != nil {
		return err
	}
	recheck := a.Recheck
	if recheck <= 0 {
		recheck = DefaultRecheck
	}
	a.mu.Lock()
	if a.bound == nil {
		a.bound = map[string]time.Time{}
	}
	a.bound[key] = a.now().Add(recheck)
	a.mu.Unlock()
	return nil
}

// Forget drops what Ensure remembers about namespace (call it when an
// operation there was forbidden: the binding may be gone).
func (a *SessionAccess) Forget(namespace string) {
	if a == nil {
		return
	}
	a.mu.Lock()
	delete(a.bound, namespace)
	delete(a.bound, namespace+"\x00held")
	a.mu.Unlock()
}

// Release drops Finalizer from the session RoleBinding of namespace. Call
// it once the namespace's last LabSession is torn down: the binding then
// goes with the namespace like any other object (EnsureHeld adds the
// finalizer back for the next session).
func (a *SessionAccess) Release(ctx context.Context, namespace string) error {
	if a == nil || a.ClusterRole == "" {
		return nil
	}
	// Sessions torn down together release concurrently: retry on conflict.
	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
		rb := &rbacv1.RoleBinding{}
		if err := a.reader().Get(ctx, client.ObjectKey{Namespace: namespace, Name: a.ClusterRole}, rb); err != nil {
			return client.IgnoreNotFound(err)
		}
		if !controllerutil.RemoveFinalizer(rb, Finalizer) {
			return nil
		}
		return client.IgnoreNotFound(a.Client.Update(ctx, rb))
	})
	if err != nil {
		return fmt.Errorf("release RoleBinding %s/%s: %w", namespace, a.ClusterRole, err)
	}
	a.Forget(namespace)
	return nil
}

// Binding is the RoleBinding Ensure maintains in namespace.
func (a *SessionAccess) Binding(namespace string) *rbacv1.RoleBinding {
	return &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: a.ClusterRole, Namespace: namespace,
			Labels: map[string]string{drivers.LabelManagedBy: drivers.ManagedBy}},
		RoleRef:  rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: a.ClusterRole},
		Subjects: []rbacv1.Subject{a.Subject()},
	}
}

func (a *SessionAccess) ensureBinding(ctx context.Context, namespace string, held bool) error {
	want := a.Binding(namespace)
	if held {
		want.Finalizers = []string{Finalizer}
	}
	got := &rbacv1.RoleBinding{}
	err := a.reader().Get(ctx, client.ObjectKeyFromObject(want), got)
	switch {
	case apierrors.IsNotFound(err):
		if err := a.Client.Create(ctx, want); err != nil && !apierrors.IsAlreadyExists(err) {
			return fmt.Errorf("bind %s in %s: %w", a.ClusterRole, namespace, err)
		}
		return nil
	case err != nil:
		return fmt.Errorf("RoleBinding %s/%s: %w", namespace, want.Name, err)
	}
	if got.DeletionTimestamp != nil {
		return nil // the namespace is going; the binding authorizes until Release
	}
	if got.RoleRef != want.RoleRef {
		// roleRef is immutable: replace the binding.
		if err := a.Client.Delete(ctx, got); client.IgnoreNotFound(err) != nil {
			return fmt.Errorf("replace RoleBinding %s/%s: %w", namespace, got.Name, err)
		}
		if err := a.Client.Create(ctx, want); err != nil {
			return fmt.Errorf("bind %s in %s: %w", a.ClusterRole, namespace, err)
		}
		return nil
	}
	addFinalizer := held && !controllerutil.ContainsFinalizer(got, Finalizer)
	if len(got.Subjects) == 1 && got.Subjects[0] == want.Subjects[0] && !addFinalizer {
		return nil
	}
	got.Subjects = want.Subjects
	if held {
		controllerutil.AddFinalizer(got, Finalizer)
	}
	if err := a.Client.Update(ctx, got); err != nil {
		return fmt.Errorf("RoleBinding %s/%s: %w", namespace, got.Name, err)
	}
	return nil
}
