package drivers

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// TestEnvtestSandbox runs the tier sandbox rules against a real API server
// (envtest: the RuntimeClass admission plugin, real RuntimeClass and Node
// objects). It needs the envtest binaries: make test-envtest
// (KUBEBUILDER_ASSETS).
func TestEnvtestSandbox(t *testing.T) {
	if os.Getenv("KUBEBUILDER_ASSETS") == "" {
		t.Skip("KUBEBUILDER_ASSETS not set (make test-envtest)")
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
	c, err := client.New(cfg, client.Options{Scheme: scheme})
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range []client.Object{
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "labs"}},
		kataNode(),
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "w2"}},
		kataRC("kata-clh-runtime-rs", "kata-clh-runtime-rs"),
	} {
		if err := c.Create(ctx, o); err != nil {
			t.Fatal(err)
		}
	}
	sb := &Sandboxes{Tiers: sandboxesB(""), Reader: c, TTL: time.Nanosecond}
	d := &ContainerDriver{Client: c, Reader: c, Catalog: sandboxCatalog(t), Sandboxes: sb}
	ref := func(node, image string) NodeRef {
		r := tierARef(image)
		r.Node.Name = node
		return r
	}
	getPod := func(r NodeRef) (*corev1.Pod, error) {
		pod := &corev1.Pod{}
		return pod, c.Get(ctx, client.ObjectKey{Namespace: r.Namespace(), Name: r.ResourceName()}, pod)
	}

	// Startup validation: the tier is available.
	if st := sb.Check(ctx)["B"]; !st.Available || !strings.Contains(st.Reason, "1 schedulable node") {
		t.Fatalf("startup check: %+v", st)
	}

	// 1. Sandbox available: privileged only inside the RuntimeClass, which
	// the API server's RuntimeClass admission resolves (its node selector
	// lands on the pod).
	sys := ref("sys", "deb-sys:24.04")
	if _, err := d.Provision(ctx, sys); err != nil {
		t.Fatal(err)
	}
	pod, err := getPod(sys)
	if err != nil {
		t.Fatal(err)
	}
	if ptr.Deref(pod.Spec.RuntimeClassName, "") != "kata-clh-runtime-rs" || !podHasPrivileged(pod) {
		t.Fatalf("sandboxed systemd pod: rc=%v privileged=%v", pod.Spec.RuntimeClassName, podHasPrivileged(pod))
	}
	if pod.Spec.NodeSelector[katalabel] != "true" {
		t.Fatalf("RuntimeClass admission did not apply the scheduling selector: %v", pod.Spec.NodeSelector)
	}

	// 2. The API server itself refuses a pod whose RuntimeClass does not
	// exist: no path lands such a pod on the host runtime.
	ghost := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "ghost", Namespace: "labs"}, Spec: corev1.PodSpec{
		RuntimeClassName: ptr.To("kata-missing"),
		Containers:       []corev1.Container{{Name: "c", Image: "x", SecurityContext: &corev1.SecurityContext{Privileged: ptr.To(true)}}},
	}}
	if err := c.Create(ctx, ghost); err == nil {
		t.Fatal("the API server accepted a pod with a missing RuntimeClass")
	}

	// 3. The RuntimeClass is deleted: new systemd nodes are refused (no pod),
	// plain tier-B nodes run on the default runtime, the existing sandboxed
	// pod is left alone, and the plan falls back to the VM twin.
	if err := c.Delete(ctx, kataRC("kata-clh-runtime-rs", "")); err != nil {
		t.Fatal(err)
	}
	if st := sb.States(ctx)["B"]; st.Available || !strings.Contains(st.Reason, "not found") {
		t.Fatalf("after delete: %+v", st)
	}
	sys2 := ref("sys2", "deb-sys:24.04")
	if _, err := d.Provision(ctx, sys2); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("systemd without sandbox: err = %v", err)
	}
	if _, err := getPod(sys2); err == nil {
		t.Fatal("a refused systemd node got a pod")
	}
	plain := ref("plain", "deb-tools:1")
	if _, err := d.Provision(ctx, plain); err != nil {
		t.Fatal(err)
	}
	if pod, err := getPod(plain); err != nil || pod.Spec.RuntimeClassName != nil || podHasPrivileged(pod) {
		t.Fatalf("plain tier-B pod without sandbox: %v %+v", err, pod.Spec)
	}
	if _, err := d.Provision(ctx, sys); err != nil {
		t.Fatalf("existing sandboxed pod: %v", err)
	}
	spec := fallbackSpec()
	if _, err := sb.PlanSandboxes(ctx, d.Catalog, spec, nil); err != nil {
		t.Fatal(err)
	}
	if n := nodeOf(spec, "tr-pis-01"); n.Driver != labsv1.DriverVM || n.Image != "ubuntu-vm:24.04" {
		t.Fatalf("VM fallback: %+v", n)
	}

	// 4. A RuntimeClass under the sandbox's name with the host runtime as
	// handler is never trusted.
	if err := c.Create(ctx, kataRC("kata-clh-runtime-rs", "runc")); err != nil {
		t.Fatal(err)
	}
	sys3 := ref("sys3", "deb-sys:24.04")
	if _, err := d.Provision(ctx, sys3); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("handler runc: err = %v", err)
	}
	if _, err := getPod(sys3); err == nil {
		t.Fatal("a systemd node got a pod on handler runc")
	}
	if st := sb.States(ctx)["B"]; st.Privileged() || !strings.Contains(st.Reason, `handler "runc"`) {
		t.Fatalf("handler runc: %+v", st)
	}

	// 5. Sandboxes off: systemd images are refused, as before.
	off := &ContainerDriver{Client: c, Reader: c, Catalog: sandboxCatalog(t)}
	if _, err := off.Provision(ctx, ref("sys4", "deb-sys:24.04")); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("off: err = %v", err)
	}
}
