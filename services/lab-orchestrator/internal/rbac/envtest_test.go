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
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apiextv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/utils/ptr"
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
	for _, f := range []string{"role.yaml", "role_binding.yaml", "session_role.yaml", "leader_election_role.yaml", "ovn_central_role.yaml", "admission_policy.yaml", "vcluster_host_policy.yaml"} {
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
			"bind the session role in kube-system":             func() error { return mgr.Create(ctx, access.Binding("kube-system")) },
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

// TestEnvtestVClusterHostPolicy: in ct-vc-* namespaces nobody (the vcluster
// syncer acts for the learner) may create Services with externalIPs, of type
// LoadBalancer or NodePort, or Ingresses; elsewhere the policy does not apply.
func TestEnvtestVClusterHostPolicy(t *testing.T) {
	if os.Getenv("KUBEBUILDER_ASSETS") == "" {
		t.Skip("KUBEBUILDER_ASSETS not set (make test-rbac)")
	}
	env := &envtest.Environment{}
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
	for _, ns := range []string{"ct-vc-abc", "plain"} {
		if err := admin.Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns}}); err != nil {
			t.Fatal(err)
		}
	}
	for _, doc := range loadDocs(t, "vcluster_host_policy.yaml") {
		u := &unstructured.Unstructured{}
		if err := sigsyaml.Unmarshal(doc, &u.Object); err != nil {
			t.Fatal(err)
		}
		if u.GetKind() == "ValidatingAdmissionPolicy" {
			// As the chart renders it with orchestrator.vclusterPodCIDRs: [10.16.0.0/16].
			vars, _, _ := unstructured.NestedSlice(u.Object, "spec", "variables")
			vars[0].(map[string]any)["expression"] = "['10.16.0.0/16']"
			_ = unstructured.SetNestedSlice(u.Object, vars, "spec", "variables")
		}
		if err := admin.Create(ctx, u); err != nil {
			t.Fatal(err)
		}
	}
	svc := func(ns, name string, mut func(*corev1.Service)) *corev1.Service {
		s := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name},
			Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{Port: 80}}}}
		if mut != nil {
			mut(s)
		}
		return s
	}
	eventually(t, func() error {
		err := admin.Create(ctx, svc("ct-vc-abc", "probe", func(s *corev1.Service) { s.Spec.ExternalIPs = []string{"203.0.113.9"} }))
		if apierrors.IsForbidden(err) || apierrors.IsInvalid(err) {
			return nil
		}
		if err == nil {
			_ = admin.Delete(ctx, svc("ct-vc-abc", "probe", nil))
		}
		return fmt.Errorf("policy not active yet: %v", err)
	})
	denied := map[string]client.Object{
		"externalIPs":  svc("ct-vc-abc", "ext", func(s *corev1.Service) { s.Spec.ExternalIPs = []string{"203.0.113.9"} }),
		"LoadBalancer": svc("ct-vc-abc", "lb", func(s *corev1.Service) { s.Spec.Type = corev1.ServiceTypeLoadBalancer }),
		"NodePort":     svc("ct-vc-abc", "np", func(s *corev1.Service) { s.Spec.Type = corev1.ServiceTypeNodePort }),
		"Ingress": &networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Namespace: "ct-vc-abc", Name: "web"},
			Spec: networkingv1.IngressSpec{DefaultBackend: &networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: "x", Port: networkingv1.ServiceBackendPort{Number: 80}}}}},
		"Endpoints at a node IP":          endpoints("ct-vc-abc", "node", "10.224.0.4"),
		"EndpointSlice at the wireserver": slice("ct-vc-abc", "wire", discoveryv1.AddressTypeIPv4, "168.63.129.16"),
		"FQDN EndpointSlice":              slice("ct-vc-abc", "fqdn", discoveryv1.AddressTypeFQDN, "metadata.internal"),
	}
	for name, obj := range denied {
		err := admin.Create(ctx, obj)
		if err == nil || !strings.Contains(err.Error(), "ValidatingAdmissionPolicy") {
			t.Errorf("%s in a vcluster host namespace: want denied by the policy, got %v", name, err)
		}
	}
	// Link-local and loopback endpoints are refused by the API server's own
	// validation already (everywhere); the policy is the second layer.
	for name, obj := range map[string]client.Object{
		"Endpoints at IMDS":           endpoints("ct-vc-abc", "imds", "169.254.169.254"),
		"not-ready Endpoints at IMDS": notReadyEndpoints("ct-vc-abc", "imds2", "169.254.169.254"),
		"Endpoints at loopback":       endpoints("ct-vc-abc", "lo", "127.0.0.1"),
		"EndpointSlice at IMDS":       slice("ct-vc-abc", "imds", discoveryv1.AddressTypeIPv4, "169.254.169.254"),
	} {
		if err := admin.Create(ctx, obj); err == nil {
			t.Errorf("%s: created", name)
		}
	}
	allowed := map[string]client.Object{
		"ClusterIP in ct-vc":     svc("ct-vc-abc", "web", nil),
		"headless in ct-vc":      svc("ct-vc-abc", "hl", func(s *corev1.Service) { s.Spec.ClusterIP = corev1.ClusterIPNone }),
		"externalIPs elsewhere":  svc("plain", "ext", func(s *corev1.Service) { s.Spec.ExternalIPs = []string{"203.0.113.9"} }),
		"LoadBalancer elsewhere": svc("plain", "lb", func(s *corev1.Service) { s.Spec.Type = corev1.ServiceTypeLoadBalancer }),
		"Endpoints at a pod IP":  endpoints("ct-vc-abc", "pod", "10.16.3.7"),
		"EndpointSlice at a pod": slice("ct-vc-abc", "pod", discoveryv1.AddressTypeIPv4, "10.16.3.7"),
		// What the host EndpointSlice controller writes for a Service without
		// ready pods: endpoints is null (no omitempty), not an empty list.
		"empty EndpointSlice": &discoveryv1.EndpointSlice{ObjectMeta: metav1.ObjectMeta{Namespace: "ct-vc-abc", Name: "empty"},
			AddressType: discoveryv1.AddressTypeIPv4},
		"empty Endpoints": &corev1.Endpoints{ObjectMeta: metav1.ObjectMeta{Namespace: "ct-vc-abc", Name: "empty"}}, //nolint:staticcheck // see endpoints
	}
	for name, obj := range allowed {
		if err := admin.Create(ctx, obj); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	// The last pod behind a Service goes away: the controller empties the
	// slice. Refused, the slice would keep naming the old pod's address.
	s := &discoveryv1.EndpointSlice{}
	if err := admin.Get(ctx, client.ObjectKey{Namespace: "ct-vc-abc", Name: "pod"}, s); err != nil {
		t.Fatal(err)
	}
	s.Endpoints = nil
	if err := admin.Update(ctx, s); err != nil {
		t.Errorf("emptying an EndpointSlice: %v", err)
	}
	// And filling it again with a foreign address is still refused.
	s.Endpoints = []discoveryv1.Endpoint{{Addresses: []string{"10.224.0.4"}}}
	if err := admin.Update(ctx, s); err == nil || !strings.Contains(err.Error(), "ValidatingAdmissionPolicy") {
		t.Errorf("EndpointSlice updated to a node IP: want denied by the policy, got %v", err)
	}
}

// TestEnvtestVClusterHostServices: with the mutating policy next to the
// validating one, a NodePort, LoadBalancer or externalIPs Service written into
// a ct-vc-* namespace (what the vcluster syncer does for a learner's Service)
// is stored as a plain ClusterIP Service, on create and on update, and the
// validating policy and the namespace's quota (0 node ports, 0 load balancers)
// accept it. Elsewhere nothing changes.
func TestEnvtestVClusterHostServices(t *testing.T) {
	if os.Getenv("KUBEBUILDER_ASSETS") == "" {
		t.Skip("KUBEBUILDER_ASSETS not set (make test-rbac)")
	}
	env := &envtest.Environment{}
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
	for _, ns := range []string{"ct-vc-abc", "plain"} {
		if err := admin.Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := admin.Create(ctx, &corev1.ResourceQuota{ObjectMeta: metav1.ObjectMeta{Namespace: "ct-vc-abc", Name: "q"},
		Spec: corev1.ResourceQuotaSpec{Hard: corev1.ResourceList{
			corev1.ResourceServicesNodePorts: resource.MustParse("0"), corev1.ResourceServicesLoadBalancers: resource.MustParse("0")}}}); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"vcluster_host_policy.yaml", "vcluster_host_services_mutation.yaml"} {
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
	tcp := corev1.ProtocolTCP
	ports := func(nodePorts ...int32) []corev1.ServicePort {
		var out []corev1.ServicePort
		for i, np := range nodePorts {
			out = append(out, corev1.ServicePort{Name: fmt.Sprintf("p%d", i), Port: int32(80 + i), Protocol: tcp,
				TargetPort: intstr.FromString(fmt.Sprintf("web%d", i)), AppProtocol: ptr.To("http"), NodePort: np})
		}
		return out
	}
	svc := func(ns, name string, mut func(*corev1.Service)) *corev1.Service {
		s := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, Labels: map[string]string{"app": name}},
			Spec: corev1.ServiceSpec{Ports: ports(0), Selector: map[string]string{"app": name}}}
		if mut != nil {
			mut(s)
		}
		return s
	}
	// Policies take effect asynchronously: wait until a NodePort is translated.
	eventually(t, func() error {
		s := svc("ct-vc-abc", "probe", func(s *corev1.Service) { s.Spec.Type = corev1.ServiceTypeNodePort })
		err := admin.Create(ctx, s)
		if err == nil {
			_ = admin.Delete(ctx, s)
			if s.Spec.Type == corev1.ServiceTypeClusterIP {
				return nil
			}
		}
		return fmt.Errorf("mutating policy not active yet: type %s, %v", s.Spec.Type, err)
	})
	plainHost := func(t *testing.T, name string, s *corev1.Service) {
		t.Helper()
		got := &corev1.Service{}
		if err := admin.Get(ctx, client.ObjectKeyFromObject(s), got); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		sp := got.Spec
		if sp.Type != corev1.ServiceTypeClusterIP || len(sp.ExternalIPs) > 0 || sp.ExternalTrafficPolicy != "" || sp.HealthCheckNodePort != 0 ||
			sp.LoadBalancerIP != "" || len(sp.LoadBalancerSourceRanges) > 0 || sp.LoadBalancerClass != nil || sp.AllocateLoadBalancerNodePorts != nil {
			t.Errorf("%s: host Service not plain ClusterIP: %+v", name, sp)
		}
		if sp.ClusterIP == "" {
			t.Errorf("%s: no cluster IP", name)
		}
		if len(sp.Ports) != len(s.Spec.Ports) {
			t.Errorf("%s: %d ports, want %d", name, len(sp.Ports), len(s.Spec.Ports))
		}
		for i, p := range sp.Ports {
			if p.NodePort != 0 {
				t.Errorf("%s: port %d kept node port %d", name, i, p.NodePort)
			}
			if p.Name != fmt.Sprintf("p%d", i) || p.Port != int32(80+i) || p.TargetPort != intstr.FromString(fmt.Sprintf("web%d", i)) ||
				p.AppProtocol == nil || *p.AppProtocol != "http" || p.Protocol != tcp {
				t.Errorf("%s: port %d changed beyond its node port: %+v", name, i, p)
			}
		}
	}
	created := map[string]*corev1.Service{
		"NodePort": svc("ct-vc-abc", "np", func(s *corev1.Service) { s.Spec.Type = corev1.ServiceTypeNodePort }),
		// What the syncer sends after a learner edits the ports: the virtual
		// API server's node ports included.
		"NodePort with node ports": svc("ct-vc-abc", "npfixed", func(s *corev1.Service) {
			s.Spec.Type, s.Spec.Ports = corev1.ServiceTypeNodePort, ports(30080, 0, 30082)
		}),
		"LoadBalancer, Local, every LB field": svc("ct-vc-abc", "lb", func(s *corev1.Service) {
			s.Spec.Type = corev1.ServiceTypeLoadBalancer
			s.Spec.Ports = ports(31000, 31001)
			s.Spec.ExternalTrafficPolicy = corev1.ServiceExternalTrafficPolicyLocal
			s.Spec.HealthCheckNodePort = 32000
			s.Spec.LoadBalancerIP = "203.0.113.10"
			s.Spec.LoadBalancerSourceRanges = []string{"0.0.0.0/0"}
			s.Spec.LoadBalancerClass = ptr.To("example.com/lb")
			s.Spec.AllocateLoadBalancerNodePorts = ptr.To(true)
		}),
		"ClusterIP with externalIPs": svc("ct-vc-abc", "ext", func(s *corev1.Service) { s.Spec.ExternalIPs = []string{"203.0.113.9"} }),
		"NodePort with externalIPs": svc("ct-vc-abc", "npext", func(s *corev1.Service) {
			s.Spec.Type, s.Spec.ExternalIPs = corev1.ServiceTypeNodePort, []string{"203.0.113.9", "198.51.100.1"}
		}),
		"ClusterIP": svc("ct-vc-abc", "web", nil),
		"headless":  svc("ct-vc-abc", "hl", func(s *corev1.Service) { s.Spec.ClusterIP = corev1.ClusterIPNone }),
	}
	for name, s := range created {
		if err := admin.Create(ctx, s); err != nil {
			t.Errorf("%s in a vcluster host namespace: %v", name, err)
			continue
		}
		plainHost(t, name, s)
	}
	// The syncer patches the host Service when the learner changes the
	// virtual one: from ClusterIP to NodePort or LoadBalancer, or new ports
	// with the virtual node ports.
	web := &corev1.Service{}
	if err := admin.Get(ctx, client.ObjectKeyFromObject(created["ClusterIP"]), web); err != nil {
		t.Fatal(err)
	}
	for name, mut := range map[string]func(*corev1.Service){
		"update to NodePort": func(s *corev1.Service) { s.Spec.Type, s.Spec.Ports = corev1.ServiceTypeNodePort, ports(30090, 30091) },
		"update to LoadBalancer": func(s *corev1.Service) {
			s.Spec.Type, s.Spec.ExternalTrafficPolicy = corev1.ServiceTypeLoadBalancer, corev1.ServiceExternalTrafficPolicyCluster
		},
		"update externalIPs": func(s *corev1.Service) { s.Spec.ExternalIPs = []string{"203.0.113.11"} },
	} {
		if err := admin.Get(ctx, client.ObjectKeyFromObject(web), web); err != nil {
			t.Fatal(err)
		}
		mut(web)
		if err := admin.Update(ctx, web); err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		plainHost(t, name, web)
	}
	// ExternalName Services are left alone.
	en := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Namespace: "ct-vc-abc", Name: "en"},
		Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeExternalName, ExternalName: "example.com"}}
	if err := admin.Create(ctx, en); err != nil || en.Spec.Type != corev1.ServiceTypeExternalName {
		t.Errorf("ExternalName in a vcluster host namespace: type %s, %v", en.Spec.Type, err)
	}
	// Outside ct-vc-* namespaces nothing is translated.
	np := svc("plain", "np", func(s *corev1.Service) { s.Spec.Type = corev1.ServiceTypeNodePort })
	if err := admin.Create(ctx, np); err != nil || np.Spec.Type != corev1.ServiceTypeNodePort || np.Spec.Ports[0].NodePort == 0 {
		t.Errorf("NodePort elsewhere: type %s, ports %+v, %v", np.Spec.Type, np.Spec.Ports, err)
	}
}

func endpoints(ns, name, ip string) *corev1.Endpoints { //nolint:staticcheck // what vcluster syncs for selector-less Services
	return &corev1.Endpoints{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name}, //nolint:staticcheck // see above
		Subsets: []corev1.EndpointSubset{{Addresses: []corev1.EndpointAddress{{IP: ip}}, Ports: []corev1.EndpointPort{{Port: 80}}}}} //nolint:staticcheck // see above
}

func notReadyEndpoints(ns, name, ip string) *corev1.Endpoints { //nolint:staticcheck // see endpoints
	e := endpoints(ns, name, ip)
	e.Subsets[0].NotReadyAddresses, e.Subsets[0].Addresses = e.Subsets[0].Addresses, nil
	return e
}

func slice(ns, name string, t discoveryv1.AddressType, addr string) *discoveryv1.EndpointSlice {
	return &discoveryv1.EndpointSlice{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name}, AddressType: t,
		Endpoints: []discoveryv1.Endpoint{{Addresses: []string{addr}}}}
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
