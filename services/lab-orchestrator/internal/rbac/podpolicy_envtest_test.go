package rbac

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	admissionv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
	sigsyaml "sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

// podPolicy loads config/rbac/pod_admission_policy.yaml with the sandbox
// RuntimeClasses filled in, as the deploy tools render it.
func podPolicy(t *testing.T, sandboxes string) (*admissionv1.ValidatingAdmissionPolicy, *admissionv1.ValidatingAdmissionPolicyBinding) {
	t.Helper()
	docs := loadDocs(t, "pod_admission_policy.yaml")
	if len(docs) != 2 {
		t.Fatalf("pod_admission_policy.yaml: %d documents", len(docs))
	}
	pol := &admissionv1.ValidatingAdmissionPolicy{}
	b := &admissionv1.ValidatingAdmissionPolicyBinding{}
	if err := sigsyaml.UnmarshalStrict(docs[0], pol); err != nil {
		t.Fatal(err)
	}
	if err := sigsyaml.UnmarshalStrict(docs[1], b); err != nil {
		t.Fatal(err)
	}
	for i, v := range pol.Spec.Variables {
		if v.Name == drivers.PodPolicySandboxesVariable {
			pol.Spec.Variables[i].Expression = sandboxes
		}
	}
	return pol, b
}

// wiredPods renders the platform's own pods with the production code: a
// netdev router and a host, with and without user namespaces.
func wiredPods(t *testing.T, ns string) map[string]*corev1.Pod {
	t.Helper()
	topo := &labsv1.Topology{
		Nodes: []labsv1.Node{
			{Name: "r1", Driver: labsv1.DriverNetdev, Image: "frr:10"},
			{Name: "h1", Driver: labsv1.DriverContainer, Image: "nettools:1"},
			{Name: "h2", Driver: labsv1.DriverContainer, Image: "nettools:1"},
		},
		Links: []labsv1.Link{
			{A: "h1:eth1", B: "r1:eth1", Subnet: "10.1.0.0/24"},
			{A: "h1:eth2", B: "h2:eth1", Subnet: "10.2.0.0/24"},
		},
	}
	out := map[string]*corev1.Pod{}
	for _, userns := range []bool{true, false} {
		p, err := network.BuildWith(network.Session{Namespace: ns, Name: "s", UID: "u"}, topo, network.Options{Mode: network.ModePrimary, RouterTuning: !userns})
		if err != nil {
			t.Fatal(err)
		}
		for _, node := range []string{"r1", "h1"} {
			pod := &corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Namespace: ns},
				Spec: corev1.PodSpec{
					AutomountServiceAccountToken: ptr.To(false),
					Containers:                   []corev1.Container{{Name: drivers.ContainerName, Image: "node"}},
				},
			}
			router := node == "r1"
			if router {
				pod.Spec.Containers[0].SecurityContext = drivers.NetdevSecurityContext(drivers.FRR{})
				pod.Labels = map[string]string{network.LabelPodProfile: network.PodProfileNetdev}
			}
			if err := p.DecoratePod(node, pod, drivers.ContainerName, network.PodOptions{ToolsImage: "tools", Router: router, UserNamespace: userns}); err != nil {
				t.Fatal(err)
			}
			name := fmt.Sprintf("%s-userns-%v", node, userns)
			pod.Name = name
			out[name] = pod
		}
	}
	return out
}

// TestEnvtestPodPolicy applies the lab pod admission policy to a real API
// server and creates pods as the manager's ServiceAccount and as anyone
// else: privileged pods only in a sandbox RuntimeClass, the platform's
// wired and netdev pods exactly as the manager builds them, nothing more.
// It needs the envtest binaries: make test-rbac (KUBEBUILDER_ASSETS).
func TestEnvtestPodPolicy(t *testing.T) {
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
	const (
		labNs   = "ctv-pods"
		plainNs = "plain"
		// labctl preflight probes: lab-labelled, but not judged.
		preflightNs = "ct-preflight-x"
		mgrSA   = "system:serviceaccount:" + managerNS + ":lab-orchestrator"
		otherSA = "system:serviceaccount:kube-system:replicaset-controller"
	)
	pol, binding := podPolicy(t, "['kata-test']")
	for _, o := range []client.Object{
		labNS(labNs, true), labNS(plainNs, false), preflightNS(preflightNs),
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: labNs, Name: "default"}},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: preflightNs, Name: "default"}},
		&corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: plainNs, Name: "default"}},
		&nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: "kata-test"}, Handler: "kata"},
		&nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: "runc-test"}, Handler: "runc"},
		// Both identities may create anything; only the policy says no.
		&rbacv1.ClusterRoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "test-admins"},
			RoleRef:  rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: "cluster-admin"},
			Subjects: []rbacv1.Subject{{Kind: rbacv1.UserKind, APIGroup: rbacv1.GroupName, Name: mgrSA}, {Kind: rbacv1.UserKind, APIGroup: rbacv1.GroupName, Name: otherSA}}},
		pol, binding,
	} {
		if err := admin.Create(ctx, o); err != nil {
			t.Fatalf("%T %s: %v", o, o.GetName(), err)
		}
	}
	as := func(user string) client.Client {
		c := rest.CopyConfig(cfg)
		c.Impersonate = rest.ImpersonationConfig{UserName: user, Groups: []string{"system:authenticated"}}
		cl, err := client.New(c, client.Options{Scheme: scheme})
		if err != nil {
			t.Fatal(err)
		}
		return cl
	}
	mgr, other := as(mgrSA), as(otherSA)

	n := 0
	pod := func(ns string, mutate func(*corev1.Pod)) *corev1.Pod {
		n++
		p := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: fmt.Sprintf("p%d", n)},
			Spec: corev1.PodSpec{
				AutomountServiceAccountToken: ptr.To(false),
				Containers:                   []corev1.Container{{Name: drivers.ContainerName, Image: "node"}},
			},
		}
		if mutate != nil {
			mutate(p)
		}
		return p
	}
	privileged := func(p *corev1.Pod) {
		p.Spec.Containers[0].SecurityContext = &corev1.SecurityContext{Privileged: ptr.To(true)}
	}
	sandboxed := func(p *corev1.Pod) { p.Spec.RuntimeClassName = ptr.To("kata-test") }
	addCaps := func(i int, caps ...corev1.Capability) func(*corev1.Pod) {
		return func(p *corev1.Pod) {
			p.Spec.Containers[i].SecurityContext = &corev1.SecurityContext{Capabilities: &corev1.Capabilities{Add: caps}}
		}
	}
	all := func(fs ...func(*corev1.Pod)) func(*corev1.Pod) {
		return func(p *corev1.Pod) {
			for _, f := range fs {
				f(p)
			}
		}
	}
	// Denied by a validation of the policy, not by an expression that
	// failed to evaluate (failurePolicy Fail would deny that too).
	denied := func(err error) bool {
		return err != nil && (apierrors.IsForbidden(err) || apierrors.IsInvalid(err)) && strings.Contains(err.Error(), "ValidatingAdmissionPolicy") &&
			!strings.Contains(err.Error(), "resulted in error") && !strings.Contains(err.Error(), "fails to evaluate")
	}

	// The policy is active once the API server has compiled it.
	eventually(t, func() error {
		if err := mgr.Create(ctx, pod(labNs, privileged)); !denied(err) {
			return fmt.Errorf("privileged pod not denied yet: %v", err)
		}
		return nil
	})

	t.Run("preflight probe namespaces are not judged", func(t *testing.T) {
		hostPath := func(p *corev1.Pod) {
			p.Spec.Volumes = []corev1.Volume{{Name: "m", VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/lib/modules"}}}}
		}
		if err := other.Create(ctx, pod(preflightNs, all(hostPath, addCaps(0, "NET_ADMIN", "NET_RAW")))); err != nil {
			t.Errorf("preflight probe pod: %v", err)
		}
		if err := other.Create(ctx, pod(labNs, hostPath)); !denied(err) {
			t.Errorf("hostPath in a lab namespace: want denied, got %v", err)
		}
	})

	t.Run("privileged only in a sandbox RuntimeClass", func(t *testing.T) {
		for name, c := range map[string]client.Client{"manager": mgr, "other": other} {
			if err := c.Create(ctx, pod(labNs, privileged)); !denied(err) {
				t.Errorf("%s: privileged pod without a sandbox: %v", name, err)
			}
			if err := c.Create(ctx, pod(labNs, all(privileged, func(p *corev1.Pod) { p.Spec.RuntimeClassName = ptr.To("runc-test") }))); !denied(err) {
				t.Errorf("%s: privileged pod in a RuntimeClass that is not a sandbox: %v", name, err)
			}
			init := func(p *corev1.Pod) {
				p.Spec.InitContainers = []corev1.Container{{Name: "i", Image: "i", SecurityContext: &corev1.SecurityContext{Privileged: ptr.To(true)}}}
			}
			if err := c.Create(ctx, pod(labNs, init)); !denied(err) {
				t.Errorf("%s: privileged init container: %v", name, err)
			}
			if err := c.Create(ctx, pod(labNs, all(privileged, sandboxed))); err != nil {
				t.Errorf("%s: privileged pod in the sandbox RuntimeClass: %v", name, err)
			}
			if err := c.Create(ctx, pod(labNs, all(privileged, sandboxed, addCaps(0, "SYS_ADMIN", "SYS_MODULE"), func(p *corev1.Pod) {
				p.Spec.Containers[0].SecurityContext.Privileged = ptr.To(true)
			}))); err != nil {
				t.Errorf("%s: sandboxed pod with extra capabilities: %v", name, err)
			}
		}
		// Not a lab namespace: not the policy's business.
		if err := other.Create(ctx, pod(plainNs, privileged)); err != nil {
			t.Errorf("privileged pod outside lab namespaces: %v", err)
		}
	})

	t.Run("network setup and devices as the manager builds them", func(t *testing.T) {
		for name, p := range wiredPods(t, labNs) {
			if err := mgr.Create(ctx, p.DeepCopy()); err != nil {
				t.Errorf("%s by the manager: %v", name, err)
			}
			// The profile counts only on the manager's own pods.
			q := p.DeepCopy()
			q.Name += "-other"
			if err := other.Create(ctx, q); !denied(err) {
				t.Errorf("%s by another ServiceAccount: %v", name, err)
			}
		}
	})

	t.Run("capabilities beyond the platform's sets", func(t *testing.T) {
		wired := func(p *corev1.Pod) {
			p.Labels = map[string]string{network.LabelPodProfile: network.PodProfileWired}
		}
		netdev := func(p *corev1.Pod) {
			p.Labels = map[string]string{network.LabelPodProfile: network.PodProfileNetdev}
		}
		seccomp := func(p *corev1.Pod) {
			p.Spec.Containers[0].SecurityContext.SeccompProfile = &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}
		}
		netInit := func(caps ...corev1.Capability) func(*corev1.Pod) {
			return func(p *corev1.Pod) {
				p.Spec.InitContainers = []corev1.Container{{Name: network.InitContainerName, Image: "t",
					SecurityContext: &corev1.SecurityContext{Capabilities: &corev1.Capabilities{Add: caps}}}}
			}
		}
		cases := []struct {
			name    string
			c       client.Client
			mutate  func(*corev1.Pod)
			allowed bool
		}{
			{"baseline capabilities (virt-launcher, home-init)", other, addCaps(0, "NET_BIND_SERVICE", "CHOWN", "DAC_OVERRIDE", "FOWNER"), true},
			{"NET_ADMIN without a profile", mgr, addCaps(0, "NET_ADMIN"), false},
			{"NET_RAW without a profile", mgr, addCaps(0, "NET_RAW"), false},
			{"wired node NET_ADMIN, NET_RAW", mgr, all(wired, addCaps(0, "NET_ADMIN", "NET_RAW")), true},
			{"wired node NET_ADMIN by another creator", other, all(wired, addCaps(0, "NET_ADMIN")), false},
			{"wired node SYS_ADMIN", mgr, all(wired, addCaps(0, "SYS_ADMIN"), seccomp), false},
			{"wired node CAP_NET_ADMIN spelling", mgr, all(wired, addCaps(0, "CAP_NET_ADMIN")), false},
			{"wired node SYS_PTRACE", mgr, all(wired, addCaps(0, "SYS_PTRACE")), false},
			{"wired other container NET_ADMIN", mgr, all(wired, func(p *corev1.Pod) {
				p.Spec.Containers = append(p.Spec.Containers, corev1.Container{Name: "admin", Image: "a",
					SecurityContext: &corev1.SecurityContext{Capabilities: &corev1.Capabilities{Add: []corev1.Capability{"NET_ADMIN"}}}})
			}), false},
			{"wired net-init NET_ADMIN", mgr, all(wired, netInit("NET_ADMIN")), true},
			{"wired net-init NET_RAW", mgr, all(wired, netInit("NET_ADMIN", "NET_RAW")), false},
			{"wired net-init SYS_ADMIN", mgr, all(wired, netInit("NET_ADMIN", "SYS_ADMIN")), false},
			{"netdev node SYS_ADMIN with RuntimeDefault", mgr, all(netdev, addCaps(0, "NET_ADMIN", "NET_RAW", "NET_BIND_SERVICE", "SYS_ADMIN"), seccomp), true},
			{"netdev node SYS_ADMIN without seccomp", mgr, all(netdev, addCaps(0, "SYS_ADMIN")), false},
			{"netdev node SYS_ADMIN, pod-level RuntimeDefault", mgr, all(netdev, addCaps(0, "SYS_ADMIN"), func(p *corev1.Pod) {
				p.Spec.SecurityContext = &corev1.PodSecurityContext{SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}}
			}), true},
			{"netdev node SYS_MODULE", mgr, all(netdev, addCaps(0, "SYS_MODULE"), seccomp), false},
			{"netdev sidecar SYS_ADMIN", mgr, all(netdev, func(p *corev1.Pod) {
				p.Spec.Containers = append(p.Spec.Containers, corev1.Container{Name: network.SidecarName, Image: "t",
					SecurityContext: &corev1.SecurityContext{Capabilities: &corev1.Capabilities{Add: []corev1.Capability{"SYS_ADMIN"}},
						SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}}})
			}), false},
			{"unknown profile", mgr, all(func(p *corev1.Pod) { p.Labels = map[string]string{network.LabelPodProfile: "admin"} }, addCaps(0, "NET_ADMIN")), false},
			{"host network", mgr, func(p *corev1.Pod) { p.Spec.HostNetwork = true }, false},
			{"host PID, sandboxed", mgr, all(sandboxed, func(p *corev1.Pod) { p.Spec.HostPID = true }), false},
			{"hostPath, sandboxed", mgr, all(sandboxed, func(p *corev1.Pod) {
				p.Spec.Volumes = []corev1.Volume{{Name: "h", VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/"}}}}
			}), false},
		}
		for _, tc := range cases {
			err := tc.c.Create(ctx, pod(labNs, tc.mutate))
			switch {
			case tc.allowed && err != nil:
				t.Errorf("%s: want allowed, got %v", tc.name, err)
			case !tc.allowed && !denied(err):
				t.Errorf("%s: want denied by the policy, got %v", tc.name, err)
			}
		}
	})

	t.Run("ephemeral containers and workload templates", func(t *testing.T) {
		base := pod(labNs, nil)
		if err := mgr.Create(ctx, base); err != nil {
			t.Fatal(err)
		}
		add := func(name string, sc *corev1.SecurityContext) error {
			p := &corev1.Pod{}
			if err := mgr.Get(ctx, client.ObjectKeyFromObject(base), p); err != nil {
				return err
			}
			p.Spec.EphemeralContainers = append(p.Spec.EphemeralContainers, corev1.EphemeralContainer{
				EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: name, Image: "dbg", SecurityContext: sc}})
			return mgr.SubResource("ephemeralcontainers").Update(ctx, p)
		}
		if err := add("debug", nil); err != nil {
			t.Errorf("plain ephemeral container: %v", err)
		}
		if err := add("priv", &corev1.SecurityContext{Privileged: ptr.To(true)}); !denied(err) {
			t.Errorf("privileged ephemeral container: %v", err)
		}
		if err := add("ptrace", &corev1.SecurityContext{Capabilities: &corev1.Capabilities{Add: []corev1.Capability{"SYS_PTRACE"}}}); !denied(err) {
			t.Errorf("SYS_PTRACE ephemeral container: %v", err)
		}
		// An ephemeral container in a wired pod gets no profile.
		w := wiredPods(t, labNs)["h1-userns-false"].DeepCopy()
		w.Name = "wired-eph"
		if err := mgr.Create(ctx, w); err != nil {
			t.Fatal(err)
		}
		w.Spec.EphemeralContainers = []corev1.EphemeralContainer{{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "netdbg", Image: "dbg",
			SecurityContext: &corev1.SecurityContext{Capabilities: &corev1.Capabilities{Add: []corev1.Capability{"NET_ADMIN"}}}}}}
		if err := mgr.SubResource("ephemeralcontainers").Update(ctx, w); !denied(err) {
			t.Errorf("NET_ADMIN ephemeral container in a wired pod: %v", err)
		}

		dep := &appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Namespace: labNs, Name: "d"},
			Spec: appsv1.DeploymentSpec{
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"a": "b"}},
				Template: corev1.PodTemplateSpec{
					ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"a": "b", network.LabelPodProfile: network.PodProfileWired}},
					Spec:       pod(labNs, privileged).Spec,
				},
			},
		}
		if err := mgr.Create(ctx, dep); !denied(err) {
			t.Errorf("Deployment with a privileged template: %v", err)
		}
		dep.Spec.Template.Spec = pod(labNs, addCaps(0, "NET_ADMIN")).Spec
		if err := mgr.Create(ctx, dep); !denied(err) {
			t.Errorf("Deployment template with NET_ADMIN (no profile for templates): %v", err)
		}
		dep.Spec.Template.Spec = pod(labNs, nil).Spec
		if err := mgr.Create(ctx, dep); err != nil {
			t.Errorf("plain Deployment: %v", err)
		}
	})

	t.Run("scope own judges only the manager's requests", func(t *testing.T) {
		cur := &admissionv1.ValidatingAdmissionPolicy{}
		if err := admin.Get(ctx, client.ObjectKey{Name: pol.Name}, cur); err != nil {
			t.Fatal(err)
		}
		cur.Spec.MatchConditions = []admissionv1.MatchCondition{{Name: "own-requests", Expression: "request.userInfo.username == '" + mgrSA + "'"}}
		if err := admin.Update(ctx, cur); err != nil {
			t.Fatal(err)
		}
		eventually(t, func() error {
			if err := other.Create(ctx, pod(labNs, privileged)); err != nil {
				return fmt.Errorf("another creator's pod still judged: %v", err)
			}
			return nil
		})
		if err := mgr.Create(ctx, pod(labNs, privileged)); !denied(err) {
			t.Errorf("manager's privileged pod under scope own: %v", err)
		}
	})
}

// preflightNS is a labctl preflight probe namespace (lab-labelled too).
func preflightNS(name string) *corev1.Namespace {
	ns := labNS(name, true)
	ns.Labels["labs.cloudtrain.dev/preflight"] = "true"
	return ns
}
