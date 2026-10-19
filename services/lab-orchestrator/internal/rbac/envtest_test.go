package rbac

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	authzv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apiextv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
	sigsyaml "sigs.k8s.io/yaml"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// TestEnvtestScopedRBAC applies config/rbac (both ClusterRoles, the Roles,
// the admission policy) to a real API server (envtest: RBAC authorizer,
// ValidatingAdmissionPolicy) and acts as the manager's ServiceAccount.
// It needs the envtest binaries: make test-rbac (KUBEBUILDER_ASSETS).
func TestEnvtestScopedRBAC(t *testing.T) {
	if os.Getenv("KUBEBUILDER_ASSETS") == "" {
		t.Skip("KUBEBUILDER_ASSETS not set (make test-rbac)")
	}
	env := &envtest.Environment{CRDs: []*apiextv1.CustomResourceDefinition{kubeOVNSubnetCRD()}}
	cfg, err := env.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = env.Stop() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	admin, err := client.New(cfg, client.Options{Scheme: scheme})
	if err != nil {
		t.Fatal(err)
	}
	const sa = "system:serviceaccount:" + managerNS + ":lab-orchestrator"
	for _, o := range []client.Object{
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: managerNS}},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: managerNS, Name: "lab-orchestrator"}},
		labNS("ctv-lab", true), labNS("plain", false), labNS("victim", false),
		// Kube-OVN's own subnet (no managed-by label).
		subnet("ovn-default", nil),
	} {
		if err := admin.Create(ctx, o); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range []string{"role.yaml", "role_binding.yaml", "session_role.yaml", "leader_election_role.yaml", "ovn_central_role.yaml", "admission_policy.yaml"} {
		for _, doc := range loadDocs(t, f) {
			u := &unstructured.Unstructured{}
			if err := sigsyaml.Unmarshal(doc, &u.Object); err != nil {
				t.Fatal(err)
			}
			if err := admin.Create(ctx, u); err != nil {
				t.Fatalf("%s %s: %v", u.GetKind(), u.GetName(), err)
			}
		}
	}

	saCfg := rest.CopyConfig(cfg)
	saCfg.Impersonate = rest.ImpersonationConfig{UserName: sa,
		Groups: []string{"system:serviceaccounts", "system:serviceaccounts:" + managerNS, "system:authenticated"}}
	mgr, err := client.New(saCfg, client.Options{Scheme: scheme})
	if err != nil {
		t.Fatal(err)
	}

	can := func(verb, group, resource, ns, name string) bool {
		sar := &authzv1.SubjectAccessReview{Spec: authzv1.SubjectAccessReviewSpec{User: sa,
			Groups:             []string{"system:serviceaccounts", "system:serviceaccounts:" + managerNS, "system:authenticated"},
			ResourceAttributes: &authzv1.ResourceAttributes{Verb: verb, Group: group, Resource: resourceOnly(resource), Subresource: subresource(resource), Namespace: ns, Name: name}}}
		if err := admin.Create(ctx, sar); err != nil {
			t.Fatal(err)
		}
		if sar.Status.Allowed {
			t.Logf("allowed: %s %s.%s %s/%s: %s", verb, resource, group, ns, name, sar.Status.Reason)
		}
		return sar.Status.Allowed
	}

	// Before the binding the manager has no session permissions.
	if can("create", "", "pods/exec", "ctv-lab", "") || can("get", "", "secrets", "ctv-lab", "") {
		t.Fatal("session permissions before the RoleBinding")
	}
	access := &SessionAccess{Client: mgr, ClusterRole: DefaultSessionClusterRole, ServiceAccount: "lab-orchestrator", ServiceAccountNamespace: managerNS}
	if err := access.Ensure(ctx, "ctv-lab"); err != nil {
		t.Fatalf("Ensure in a lab namespace: %v", err)
	}
	if err := access.Ensure(ctx, "plain"); !errors.Is(err, ErrNamespaceNotLab) {
		t.Fatalf("Ensure in an unlabelled namespace: %v", err)
	}

	// The policy is enforced once the API server has compiled it; wait, so
	// the allowed cases below are checked against it too.
	eventually(t, func() error {
		err := mgr.Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "probe"}})
		if apierrors.IsForbidden(err) && strings.Contains(err.Error(), "ValidatingAdmissionPolicy") {
			return nil
		}
		return fmt.Errorf("admission policy not active yet: %v", err)
	})

	t.Run("authorized", func(t *testing.T) {
		eventually(t, func() error {
			if !can("create", "", "pods/exec", "ctv-lab", "") {
				return fmt.Errorf("exec in the lab namespace not allowed yet")
			}
			return nil
		})
		for _, c := range []struct{ verb, group, resource, ns, name string }{
			{"get", "", "secrets", "ctv-lab", ""}, {"create", "", "secrets", "ctv-lab", ""},
			{"create", "", "pods", "ctv-lab", ""}, {"deletecollection", "", "pods", "ctv-lab", ""},
			{"create", "kubevirt.io", "virtualmachines", "ctv-lab", ""}, {"create", "cdi.kubevirt.io", "datavolumes", "ctv-lab", ""},
			{"create", "k8s.cni.cncf.io", "network-attachment-definitions", "ctv-lab", ""},
			{"create", "apps", "statefulsets", "ctv-lab", ""}, {"create", "rbac.authorization.k8s.io", "roles", "ctv-lab", ""},
			{"list", "", "pods", "", ""}, {"watch", "", "services", "", ""},
			{"create", "coordination.k8s.io", "leases", managerNS, ""},
			{"create", "", "pods/exec", "kube-system", ""}, {"list", "", "pods", "kube-system", ""},
			{"create", "kubeovn.io", "subnets", "", ""}, {"list", "storage.k8s.io", "storageclasses", "", ""},
			{"bind", "rbac.authorization.k8s.io", "clusterroles", "", DefaultSessionClusterRole},
		} {
			if !can(c.verb, c.group, c.resource, c.ns, c.name) {
				t.Errorf("%s %s.%s %s/%s denied", c.verb, c.resource, c.group, c.ns, c.name)
			}
		}
		// Helm creates the vcluster chart's Role and RoleBinding as the
		// manager: allowed without escalate.
		b, err := os.ReadFile("testdata/vcluster-role.yaml")
		if err != nil {
			t.Fatal(err)
		}
		role := &rbacv1.Role{}
		if err := sigsyaml.Unmarshal(b, role); err != nil {
			t.Fatal(err)
		}
		role.Namespace, role.ResourceVersion = "ctv-lab", ""
		if err := mgr.Create(ctx, role); err != nil {
			t.Errorf("vcluster Role: %v", err)
		}
		vcSA := rbacv1.Subject{Kind: "ServiceAccount", Name: "vc-" + role.Name, Namespace: "ctv-lab"}
		if err := mgr.Create(ctx, &rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Namespace: "ctv-lab", Name: role.Name},
			RoleRef: rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: role.Name}, Subjects: []rbacv1.Subject{vcSA}}); err != nil {
			t.Errorf("vcluster RoleBinding: %v", err)
		}
		// A vcluster host namespace of its own, then its binding.
		host := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ct-vc-0123456789", Labels: map[string]string{
			drivers.LabelManagedBy: drivers.ManagedBy, drivers.LabelLabNamespace: "true",
			drivers.LabelPodSecurityEnforce: drivers.PodSecurityBaseline}}}
		if err := mgr.Create(ctx, host); err != nil {
			t.Errorf("vcluster host namespace: %v", err)
		}
		if err := access.Ensure(ctx, host.Name); err != nil {
			t.Errorf("Ensure in the vcluster host namespace: %v", err)
		}
		if err := mgr.Patch(ctx, host, client.RawPatch(types.MergePatchType, []byte(`{"metadata":{"labels":{"pod-security.kubernetes.io/enforce":"restricted"}}}`))); err != nil {
			t.Errorf("relabel own host namespace: %v", err)
		}
		if err := mgr.Create(ctx, subnet("ct-sess-mgmt", map[string]string{drivers.LabelManagedBy: drivers.ManagedBy})); err != nil {
			t.Errorf("own subnet: %v", err)
		}
		if err := mgr.Delete(ctx, host); err != nil {
			t.Errorf("delete own host namespace: %v", err)
		}
	})

	// Deleting a session namespace deletes its RoleBindings first; the held
	// binding (Finalizer) keeps authorizing teardown until Release.
	t.Run("held binding authorizes while being deleted", func(t *testing.T) {
		if err := access.EnsureHeld(ctx, "ctv-lab"); err != nil {
			t.Fatal(err)
		}
		rb := access.Binding("ctv-lab")
		if err := admin.Delete(ctx, rb); err != nil {
			t.Fatal(err)
		}
		if err := admin.Get(ctx, client.ObjectKeyFromObject(rb), rb); err != nil || rb.DeletionTimestamp == nil {
			t.Fatalf("binding not held: %v", err)
		}
		time.Sleep(time.Second)
		if !can("get", "", "secrets", "ctv-lab", "") || !can("create", "", "pods/exec", "ctv-lab", "") {
			t.Error("a binding being deleted no longer authorizes")
		}
		// The manager releases it (as itself) once the last session is gone.
		if err := access.Release(ctx, "ctv-lab"); err != nil {
			t.Fatalf("Release: %v", err)
		}
		eventually(t, func() error {
			if can("get", "", "secrets", "ctv-lab", "") {
				return fmt.Errorf("still allowed after the binding went")
			}
			return nil
		})
		access.Forget("ctv-lab")
		if err := access.EnsureHeld(ctx, "ctv-lab"); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("denied by RBAC", func(t *testing.T) {
		for _, c := range []struct{ verb, group, resource, ns, name string }{
			{"get", "", "secrets", "kube-system", ""}, {"list", "", "secrets", "kube-system", ""}, {"list", "", "secrets", "", ""},
			{"get", "", "secrets", "plain", ""}, {"get", "", "secrets", managerNS, ""},
			{"create", "", "pods/exec", "plain", ""}, {"create", "", "pods/exec", "default", ""}, {"create", "", "pods/exec", "", ""},
			{"create", "", "pods", "plain", ""}, {"create", "coordination.k8s.io", "leases", "kube-system", ""},
			{"escalate", "rbac.authorization.k8s.io", "clusterroles", "", ""}, {"escalate", "rbac.authorization.k8s.io", "roles", "ctv-lab", ""},
			{"bind", "rbac.authorization.k8s.io", "clusterroles", "", "cluster-admin"},
			{"create", "rbac.authorization.k8s.io", "clusterroles", "", ""}, {"create", "rbac.authorization.k8s.io", "clusterrolebindings", "", ""},
			{"patch", "", "nodes", "", ""}, {"list", "", "namespaces", "", ""},
		} {
			if can(c.verb, c.group, c.resource, c.ns, c.name) {
				t.Errorf("%s %s.%s %s/%s allowed", c.verb, c.resource, c.group, c.ns, c.name)
			}
		}
		for name, o := range map[string]client.Object{
			"kube-system secret": &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "x"}},
			"pod outside labs":   &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "plain", Name: "x"}, Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "c", Image: "busybox"}}}},
		} {
			if err := mgr.Create(ctx, o); !apierrors.IsForbidden(err) {
				t.Errorf("%s: want Forbidden, got %v", name, err)
			}
		}
		if err := mgr.Get(ctx, client.ObjectKey{Namespace: "kube-system", Name: "any"}, &corev1.Secret{}); !apierrors.IsForbidden(err) {
			t.Errorf("get kube-system secret: want Forbidden, got %v", err)
		}
		// Escalation: a Role granting more than the manager holds.
		pv := &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Namespace: "ctv-lab", Name: "more"},
			Rules: []rbacv1.PolicyRule{{APIGroups: []string{""}, Resources: []string{"persistentvolumes"}, Verbs: []string{"create"}}}}
		if err := mgr.Create(ctx, pv); !apierrors.IsForbidden(err) {
			t.Errorf("escalating Role: want Forbidden, got %v", err)
		}
		admins := &rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Namespace: "ctv-lab", Name: "admin"},
			RoleRef: rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "cluster-admin"}, Subjects: []rbacv1.Subject{access.Subject()}}
		if err := mgr.Create(ctx, admins); !apierrors.IsForbidden(err) {
			t.Errorf("binding cluster-admin: want Forbidden, got %v", err)
		}
	})

	t.Run("denied by the admission policy", func(t *testing.T) {
		// RBAC allows each of these (cluster-wide namespaces, rolebindings,
		// subnets; bind on the session ClusterRole); the policy does not.
		denied := map[string]func() error{
			"bind the session role in an unlabelled namespace": func() error { return mgr.Create(ctx, access.Binding("plain")) },
			"bind the session role in kube-system":              func() error { return mgr.Create(ctx, access.Binding("kube-system")) },
			"bind the session role to another subject": func() error {
				rb := access.Binding("ctv-lab")
				rb.Name, rb.Subjects = "other", []rbacv1.Subject{{Kind: "ServiceAccount", Name: "learner", Namespace: "ctv-lab"}}
				return mgr.Create(ctx, rb)
			},
			"create an arbitrary namespace": func() error {
				return mgr.Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "evil", Labels: map[string]string{drivers.LabelManagedBy: drivers.ManagedBy, drivers.LabelPodSecurityEnforce: "baseline"}}})
			},
			"create a privileged vcluster namespace": func() error {
				return mgr.Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ct-vc-priv", Labels: map[string]string{drivers.LabelManagedBy: drivers.ManagedBy, drivers.LabelPodSecurityEnforce: "privileged"}}})
			},
			"label kube-system as a lab namespace": func() error {
				return mgr.Patch(ctx, labNS("kube-system", false), client.RawPatch(types.MergePatchType, []byte(`{"metadata":{"labels":{"labs.cloudtrain.dev/lab-namespace":"true","app.kubernetes.io/managed-by":"cloudtrain-lab-orchestrator"}}}`)))
			},
			"delete another namespace": func() error { return mgr.Delete(ctx, labNS("victim", false)) },
			"change kube-ovn's own subnet": func() error {
				return mgr.Patch(ctx, subnet("ovn-default", nil), client.RawPatch(types.MergePatchType, []byte(`{"metadata":{"labels":{"app.kubernetes.io/managed-by":"cloudtrain-lab-orchestrator"}}}`)))
			},
			"delete kube-ovn's own subnet": func() error { return mgr.Delete(ctx, subnet("ovn-default", nil)) },
		}
		for name, f := range denied {
			err := f()
			if !apierrors.IsForbidden(err) && !apierrors.IsInvalid(err) {
				t.Errorf("%s: want denied, got %v", name, err)
			} else if !strings.Contains(err.Error(), "ValidatingAdmissionPolicy") {
				t.Errorf("%s: denied, but not by the policy: %v", name, err)
			}
		}
	})
}

func eventually(t *testing.T, f func() error) {
	t.Helper()
	var err error
	for i := 0; i < 50; i++ {
		if err = f(); err == nil {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatal(err)
}

func resourceOnly(r string) string { res, _, _ := strings.Cut(r, "/"); return res }
func subresource(r string) string  { _, sub, _ := strings.Cut(r, "/"); return sub }

func subnet(name string, labels map[string]string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{}
	u.SetAPIVersion("kubeovn.io/v1")
	u.SetKind("Subnet")
	u.SetName(name)
	u.SetLabels(labels)
	return u
}

// kubeOVNSubnetCRD is a minimal stand-in for Kube-OVN's Subnet CRD.
func kubeOVNSubnetCRD() *apiextv1.CustomResourceDefinition {
	preserve := true
	return &apiextv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "subnets.kubeovn.io"},
		Spec: apiextv1.CustomResourceDefinitionSpec{
			Group: "kubeovn.io", Scope: apiextv1.ClusterScoped,
			Names: apiextv1.CustomResourceDefinitionNames{Plural: "subnets", Singular: "subnet", Kind: "Subnet", ListKind: "SubnetList"},
			Versions: []apiextv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true,
				Schema: &apiextv1.CustomResourceValidation{OpenAPIV3Schema: &apiextv1.JSONSchemaProps{Type: "object", XPreserveUnknownFields: &preserve}}}},
		},
	}
}
