package rbac

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
	sigsyaml "sigs.k8s.io/yaml"
)

// TestEnvtestVClusterPodNetworkAnnotations applies
// config/rbac/vcluster_pod_network_policy.yaml to a real API server and acts as
// a vcluster syncer (the vcluster's ServiceAccount in its ct-vc-* namespace):
// it may not set or change Multus or Kube-OVN annotations on the pods it syncs,
// while other users (the Kube-OVN controller) still may (security review network-3).
func TestEnvtestVClusterPodNetworkAnnotations(t *testing.T) {
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
	const ns, syncerName = "ct-vc-demo", "vc-demo"
	syncer := "system:serviceaccount:" + ns + ":" + syncerName
	for _, o := range []client.Object{
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "other"}},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: syncerName}},
		// No controller-manager here: the ServiceAccount admission plugin needs these.
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "default"}},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: "other", Name: "default"}},
		&rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "pods-rw"}, Rules: []rbacv1.PolicyRule{{APIGroups: []string{""}, Resources: []string{"pods", "pods/status"}, Verbs: []string{"get", "create", "update", "patch"}}}},
		&rbacv1.ClusterRoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "syncer-pods"}, RoleRef: rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "pods-rw"},
			Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Namespace: ns, Name: syncerName}}},
	} {
		if err := admin.Create(ctx, o); err != nil {
			t.Fatal(err)
		}
	}
	for _, doc := range loadDocs(t, "vcluster_pod_network_policy.yaml") {
		u := &unstructured.Unstructured{}
		if err := sigsyaml.Unmarshal(doc, &u.Object); err != nil {
			t.Fatal(err)
		}
		if err := admin.Create(ctx, u); err != nil {
			t.Fatalf("%s %s: %v", u.GetKind(), u.GetName(), err)
		}
	}
	saCfg := rest.CopyConfig(cfg)
	saCfg.Impersonate = rest.ImpersonationConfig{UserName: syncer, Groups: []string{"system:serviceaccounts", "system:serviceaccounts:" + ns, "system:authenticated"}}
	sync, err := client.New(saCfg, client.Options{Scheme: scheme})
	if err != nil {
		t.Fatal(err)
	}

	n := 0
	pod := func(namespace string, ann map[string]string) *corev1.Pod {
		n++
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: fmt.Sprintf("p%d", n), Annotations: ann},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c", Image: "busybox"}}},
		}
	}
	denied := func(err error) bool {
		return apierrors.IsForbidden(err) && strings.Contains(err.Error(), "may not set network annotations")
	}
	// Wait until the API server enforces the policy.
	eventually(t, func() error {
		err := sync.Create(ctx, pod(ns, map[string]string{"k8s.v1.cni.cncf.io/networks": "cloudtrain-sessions/ct-other-link"}))
		if denied(err) {
			return nil
		}
		return fmt.Errorf("policy not active yet: %v", err)
	})

	t.Run("syncer may not choose a network", func(t *testing.T) {
		for _, ann := range []map[string]string{
			{"k8s.v1.cni.cncf.io/networks": `[{"name":"ct-abc-l1","namespace":"cloudtrain-sessions"}]`},
			{"v1.multus-cni.io/default-network": "cloudtrain-sessions/ct-abc-mgmt"},
			{"ovn.kubernetes.io/logical_switch": "ct-abc-lab"},
			{"ovn.kubernetes.io/ip_address": "192.168.100.10"},
			{"ct-abc-l1.cloudtrain-sessions.ovn.kubernetes.io/logical_switch": "ct-abc-l1"},
		} {
			if err := sync.Create(ctx, pod(ns, ann)); !denied(err) {
				t.Errorf("create with %v: %v, want denied", ann, err)
			}
		}
	})

	t.Run("plain synced pods and other users are unaffected", func(t *testing.T) {
		if err := sync.Create(ctx, pod(ns, map[string]string{"vcluster.loft.sh/object-name": "web", "prometheus.io/scrape": "true"})); err != nil {
			t.Fatalf("plain synced pod: %v", err)
		}
		// Kube-OVN's controller (not a ct-vc-* ServiceAccount) annotates every pod it allocates.
		allocated := pod(ns, map[string]string{"ovn.kubernetes.io/logical_switch": "ovn-default", "ovn.kubernetes.io/ip_address": "10.16.0.9"})
		if err := admin.Create(ctx, allocated); err != nil {
			t.Fatalf("admin create: %v", err)
		}
		// The syncer updating that pod keeps the controller's values: allowed.
		allocated.Labels = map[string]string{"synced": "again"}
		if err := sync.Update(ctx, allocated); err != nil {
			t.Fatalf("syncer update keeping Kube-OVN's annotations: %v", err)
		}
		// Changing one is not.
		allocated.Annotations["ovn.kubernetes.io/logical_switch"] = "ct-abc-lab"
		if err := sync.Update(ctx, allocated); !denied(err) {
			t.Fatalf("syncer switching the logical switch: %v, want denied", err)
		}
	})

	// The vcluster Role grants update/patch on pods/status, and a status update
	// writes metadata.annotations too: the policy must cover the subresource.
	t.Run("syncer may not choose a network through pods/status", func(t *testing.T) {
		p := pod(ns, map[string]string{"ovn.kubernetes.io/logical_switch": "ovn-default"})
		if err := admin.Create(ctx, p); err != nil {
			t.Fatalf("admin create: %v", err)
		}
		// A status update keeping the network annotations goes through, and
		// really writes annotations (so the denials below are the policy's).
		p.Annotations["vcluster.loft.sh/object-name"] = "web"
		if err := sync.Status().Update(ctx, p); err != nil {
			t.Fatalf("status update without network annotations: %v", err)
		}
		got := &corev1.Pod{}
		if err := admin.Get(ctx, client.ObjectKeyFromObject(p), got); err != nil || got.Annotations["vcluster.loft.sh/object-name"] != "web" {
			t.Fatalf("a status update must write annotations for this test to mean anything: %v %v", got.Annotations, err)
		}
		p = got
		add := p.DeepCopy()
		add.Annotations["k8s.v1.cni.cncf.io/networks"] = `[{"name":"ct-abc-l1","namespace":"cloudtrain-sessions"}]`
		if err := sync.Status().Update(ctx, add); !denied(err) {
			t.Errorf("status update adding a Multus network: %v, want denied", err)
		}
		change := p.DeepCopy()
		change.Annotations["ovn.kubernetes.io/logical_switch"] = "ct-abc-lab"
		if err := sync.Status().Update(ctx, change); !denied(err) {
			t.Errorf("status update switching the logical switch: %v, want denied", err)
		}
		patch := client.MergeFrom(p.DeepCopy())
		p.Annotations["ovn.kubernetes.io/ip_address"] = "192.168.100.10"
		if err := sync.Status().Patch(ctx, p, patch); !denied(err) {
			t.Errorf("status patch pinning an address: %v, want denied", err)
		}
	})

	t.Run("only ct-vc-* namespaces", func(t *testing.T) {
		if err := sync.Create(ctx, pod("other", map[string]string{"k8s.v1.cni.cncf.io/networks": "x"})); err != nil {
			t.Fatalf("outside ct-vc-*: %v (RBAC grants it; the policy must not match)", err)
		}
	})
}
