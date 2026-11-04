package drivers

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/gate"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

func ksDS(name string) *appsv1.DaemonSet {
	return &appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: name},
		Status: appsv1.DaemonSetStatus{DesiredNumberScheduled: 3, NumberReady: 3}}
}

func notReady(ds *appsv1.DaemonSet, ready, desired int32) *appsv1.DaemonSet {
	ds.Status.NumberReady, ds.Status.DesiredNumberScheduled = ready, desired
	return ds
}

func ciliumConfig(mode string) *corev1.ConfigMap {
	cm := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "cilium-config"}, Data: map[string]string{}}
	if mode != "" {
		cm.Data["enable-policy"] = mode
	}
	return cm
}

func TestCheckPolicyEngine(t *testing.T) {
	ovnCtrl := func(args ...string) *appsv1.Deployment {
		return &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "kube-ovn-controller"},
			Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "c", Args: args}}}}}}
	}
	cases := []struct {
		name string
		objs []client.Object
		want bool
		says string
	}{
		{"AKS Azure CNI powered by Cilium", []client.Object{ksDS("azure-cns"), ksDS("cilium"), ciliumConfig("default")}, true, "Cilium (enable-policy default)"},
		{"Cilium without enable-policy key", []client.Object{ksDS("cilium"), ciliumConfig("")}, true, "enable-policy default"},
		{"Cilium with policy switched off", []client.Object{ksDS("cilium"), ciliumConfig("never")}, false, "enable-policy never"},
		{"plain Azure CNI", []client.Object{ksDS("azure-cns")}, false, "no NetworkPolicy engine"},
		{"AWS VPC CNI", []client.Object{ksDS("aws-node")}, false, "no NetworkPolicy engine"},
		{"Kube-OVN primary", []client.Object{ksDS("kube-ovn-cni"), ovnCtrl("--enable-np=true")}, true, "Kube-OVN"},
		{"Kube-OVN with NetworkPolicy off", []client.Object{ksDS("kube-ovn-cni"), ovnCtrl("--enable-np=false")}, false, "--enable-np=false"},
		{"Calico", []client.Object{ksDS("calico-node")}, true, "Calico"},
		{"Cilium agents not all ready", []client.Object{notReady(ksDS("cilium"), 2, 3), ciliumConfig("default")}, false, "2 of 3 agents ready"},
		{"Cilium scheduled nowhere", []client.Object{notReady(ksDS("cilium"), 0, 0), ciliumConfig("default")}, false, "0 of 0 agents ready"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, c := newContainerDriver(t, tc.objs...)
			v, err := CheckPolicyEngine(context.Background(), c, nil)
			if err != nil {
				t.Fatal(err)
			}
			got := strings.Join(v.Engines, ",") + " " + v.Reason
			if v.Enforcing != tc.want || !strings.Contains(got, tc.says) {
				t.Errorf("verdict %+v, want enforcing=%v mentioning %q", v, tc.want, tc.says)
			}
		})
	}
	// cilium-config unreadable: an error, not a guess.
	_, c := newContainerDriver(t, ksDS("cilium"))
	if _, err := CheckPolicyEngine(context.Background(), c, nil); err == nil {
		t.Error("missing cilium-config must be an error")
	}
}

// The gate's verdict joins every failing key; one failing key still holds.
func TestProvisionGateKeys(t *testing.T) {
	g := &ProvisionGate{}
	if g.Err() != nil {
		t.Fatal("empty gate")
	}
	g.Set(GateNetworkPolicy, PolicyEngine{Reason: "Cilium (no ready agent on lab nodes lab2)"}.Verdict(nil))
	g.Set(GateKubelet, "lab2: no podPidsLimit")
	if err := g.Err(); err == nil || !strings.Contains(err.Error(), "kubelet: lab2") || !strings.Contains(err.Error(), "network-policy: ") {
		t.Fatalf("err = %v", err)
	}
	g.Set(GateNetworkPolicy, "")
	if g.Err() == nil {
		t.Fatal("one failing key must still hold")
	}
	g.Set(GateKubelet, "")
	if g.Err() != nil {
		t.Fatal("cleared")
	}
}

// With a lab pool, readiness is judged on the lab nodes only.
func TestPolicyEngineReadinessOnLabNodes(t *testing.T) {
	ds := ksDS("cilium")
	ds.Spec.Selector = &metav1.LabelSelector{MatchLabels: map[string]string{"k8s-app": "cilium"}}
	ds.Status.NumberReady = 2 // one agent (on a system node) not ready
	agent := func(node string, ready bool) *corev1.Pod {
		st := corev1.ConditionFalse
		if ready {
			st = corev1.ConditionTrue
		}
		return &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "cilium-" + node, Labels: map[string]string{"k8s-app": "cilium"}},
			Spec: corev1.PodSpec{NodeName: node}, Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: st}}}}
	}
	lab := map[string]string{"cloudtrain.dev/pool": "labs"}
	node := func(name string, l map[string]string) *corev1.Node {
		return &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: name, Labels: l}}
	}
	pool := labels.SelectorFromSet(lab)
	_, c := newContainerDriver(t, ds, ciliumConfig("default"), node("lab1", lab), node("lab2", lab), node("sys1", nil),
		agent("lab1", true), agent("lab2", true), agent("sys1", false))
	v, err := CheckPolicyEngine(context.Background(), c, pool)
	if err != nil || !v.Enforcing {
		t.Fatalf("lab agents ready, a system agent not: %+v %v", v, err)
	}
	// Without a pool the same cluster counts every agent.
	if v, _ := CheckPolicyEngine(context.Background(), c, nil); v.Enforcing {
		t.Error("without a lab pool every agent must be ready")
	}
	_, c2 := newContainerDriver(t, ds, ciliumConfig("default"), node("lab1", lab), node("lab2", lab), agent("lab1", true), agent("lab2", false))
	if v, _ := CheckPolicyEngine(context.Background(), c2, pool); v.Enforcing || !strings.Contains(v.Reason, "lab2") {
		t.Errorf("a lab node without a ready agent: %+v", v)
	}
}

// While the gate is closed nothing at all is created: not the pod, the
// Service or the home PVC of a container node, not the session network (VPC,
// subnets, NADs) or the device pod of a netdev node, not a VM or its
// Secrets, not a vcluster's namespace, quota or policies. Once it opens,
// the same calls create them.
func TestProvisionGateHoldsEveryCreate(t *testing.T) {
	closed := &ProvisionGate{}
	closed.Set(GateNetworkPolicy, "no engine")
	gated := gate.With(context.Background(), true, closed)
	var created []string
	count := interceptor.Funcs{Create: func(ctx context.Context, c client.WithWatch, obj client.Object, opts ...client.CreateOption) error {
		created = append(created, fmt.Sprintf("%T %s", obj, obj.GetName()))
		return c.Create(ctx, obj, opts...)
	}}
	s := testScheme(t)
	cat, err := ParseCatalog([]byte("images:\n  jumphost:1: { kind: container, image: cloudtrain/jumphost:1 }\n  frr:10: { kind: container, image: cloudtrain/frr:10, netdev: frr }\n  nettools:1: { kind: container, image: cloudtrain/nettools:1 }\n  etcd-host:3.6: { kind: containerDisk, image: cloudtrain/etcd-host:3.6 }\n"))
	if err != nil {
		t.Fatal(err)
	}
	c := fake.NewClientBuilder().WithScheme(s).WithInterceptorFuncs(count).Build()
	base := &ContainerDriver{Client: c, Scheme: s, ImageRegistry: "cloudtrain", Executor: &recordingExecutor{}, Catalog: cat, PersistentHome: true}
	base.Network = &LinkNetwork{Manager: &network.Manager{Client: c}, ToolsImage: base.ImageFor("nettools:1"), DestroyWait: time.Millisecond}
	netdev := NewNetdev(base)
	vm := &VMDriver{Client: c, Catalog: cat, Container: base, Session: &SessionRuntime{Client: c, Container: base}}
	vc := &VClusterDriver{Client: c, Container: base, Helm: &recordingHelm{}, Chart: "vcluster.tgz", APIServer: APIServerEndpoints{CIDRs: []string{"20.1.2.3/32"}, Ports: []int32{443}}}
	labnet := &LabNetwork{Client: c}
	sess := testSession()
	vmTpl := &labsv1.LabTemplateSpec{Topology: labsv1.Topology{Nodes: []labsv1.Node{{Name: "etcd", Driver: labsv1.DriverVM, Image: "etcd-host:3.6"}}}}
	vmRef := NodeRef{Session: sess, Template: vmTpl, Node: vmTpl.Topology.Nodes[0]}

	// The session's SSH keys exist (ProvisionTopology made them before any VM).
	if _, err := vm.Session.keys(context.Background(), sess, true); err != nil {
		t.Fatal(err)
	}
	steps := map[string]func(ctx context.Context) error{
		"container node": func(ctx context.Context) error { _, err := base.Provision(ctx, jumphostRef()); return err },
		"netdev node":    func(ctx context.Context) error { _, err := netdev.Provision(ctx, netRef("edge-1")); return err },
		"vm node":        func(ctx context.Context) error { _, err := vm.Provision(ctx, vmRef); return err },
		"vcluster":       func(ctx context.Context) error { _, err := vc.Provision(ctx, vclusterRef()); return err },
		"lab network":    func(ctx context.Context) error { _, err := labnet.Ensure(ctx, sess); return err },
	}
	for name, step := range steps {
		created = nil
		if err := step(gated); err == nil || !strings.Contains(err.Error(), "no engine") {
			t.Errorf("%s with the gate closed: %v", name, err)
		}
		if len(created) != 0 {
			t.Errorf("%s created %v while the gate was closed", name, created)
		}
	}
	// Open: the same calls create objects (errors past the gate are fine here).
	for name, step := range steps {
		created = nil
		_ = step(context.Background())
		if len(created) == 0 {
			t.Errorf("%s created nothing with the gate open", name)
		}
	}
}

// A hibernated VM or vcluster is not resumed while the gate is closed:
// ensure() would create nothing for the existing VM, but setRunStrategy
// ("Always") and the control plane scale-up are provisioning too.
func TestProvisionGateHoldsResume(t *testing.T) {
	closed := &ProvisionGate{}
	closed.Set(GateKubelet, "lab2: no podPidsLimit")
	gated := gate.With(context.Background(), true, closed)

	// VM: hibernated (runStrategy Halted, no VMI).
	cat, err := ParseCatalog([]byte("images:\n  etcd-host:3.6: { kind: containerDisk, image: cloudtrain/etcd-host:3.6 }\n"))
	if err != nil {
		t.Fatal(err)
	}
	s := testSession()
	tpl := &labsv1.LabTemplateSpec{Topology: labsv1.Topology{Nodes: []labsv1.Node{{Name: "etcd", Driver: labsv1.DriverVM, Image: "etcd-host:3.6"}}}}
	ref := NodeRef{Session: s, Template: tpl, Node: tpl.Topology.Nodes[0]}
	name := ref.ResourceName()
	halted := vmObj(s, name, "vm-uid-1")
	_ = unstructured.SetNestedField(halted.Object, "Halted", "spec", "runStrategy")
	d := &VMDriver{Catalog: cat, Disks: VMDiskOptions{Persistent: true}}
	secret := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: s.Namespace, Name: d.secretName(ref)}}
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(halted, secret).Build()
	d.Client, d.Container = c, &ContainerDriver{Client: c}
	runStrategy := func() string {
		vm := newObj(GVKVirtualMachine, s.Namespace, name)
		if err := c.Get(context.Background(), client.ObjectKeyFromObject(vm), vm); err != nil {
			t.Fatal(err)
		}
		rs, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy")
		return rs
	}
	if _, err := d.Provision(gated, ref); err == nil || !strings.Contains(err.Error(), "podPidsLimit") {
		t.Fatalf("resume with the gate closed: %v", err)
	}
	if rs := runStrategy(); rs != "Halted" {
		t.Fatalf("VM resumed while the gate was closed: runStrategy %s", rs)
	}
	if err := setRunStrategy(gated, c, c, s.Namespace, []string{name}, "Always"); err == nil {
		t.Error("setRunStrategy Always must be gated")
	}
	if err := setRunStrategy(gated, c, c, s.Namespace, []string{name}, "Halted"); err != nil {
		t.Errorf("halting is never gated: %v", err)
	}
	_, _ = d.Provision(context.Background(), ref)
	if rs := runStrategy(); rs != "Always" {
		t.Fatalf("gate open: runStrategy %s", rs)
	}

	// vcluster: hibernated (control plane scaled to zero).
	vd, vc, vref, rel := vclusterFixture(t, 0)
	vd.Container = &ContainerDriver{Client: vc}
	vd.APIServer = APIServerEndpoints{CIDRs: []string{"20.1.2.3/32"}, Ports: []int32{443}}
	if _, err := vd.Provision(gated, vref); err == nil {
		t.Fatal("vcluster resume with the gate closed")
	}
	sts := &appsv1.StatefulSet{}
	if err := vc.Get(context.Background(), client.ObjectKey{Namespace: VClusterNamespace(vref.Session, vref.Node.Name), Name: rel}, sts); err != nil || *sts.Spec.Replicas != 0 {
		t.Fatalf("vcluster scaled up while the gate was closed: %v %v", err, sts.Spec.Replicas)
	}
}

// Every Secret a driver writes is gated: ensureSecret (VM cloud-init, kubeadm
// cloud-init and kubeconfigs) through ensure(), the session SSH keys and the
// kubeadm PKI with their own check.
func TestProvisionGateHoldsSecrets(t *testing.T) {
	closed := &ProvisionGate{}
	closed.Set(GateNetworkPolicy, "no engine")
	gated := gate.With(context.Background(), true, closed)
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	s := testSession()
	if err := ensureSecret(gated, c, c, s, "vm-cloudinit", map[string][]byte{"userdata": []byte("x")}); err == nil || !strings.Contains(err.Error(), "no engine") {
		t.Fatalf("ensureSecret with the gate closed: %v", err)
	}
	rt := &SessionRuntime{Client: c}
	if _, err := rt.keys(gated, s, true); err == nil {
		t.Fatal("session keys with the gate closed")
	}
	list := &corev1.SecretList{}
	if err := c.List(context.Background(), list); err != nil || len(list.Items) != 0 {
		t.Fatalf("secrets created while the gate was closed: %v %d", err, len(list.Items))
	}
	if err := ensureSecret(context.Background(), c, c, s, "vm-cloudinit", map[string][]byte{"userdata": []byte("x")}); err != nil {
		t.Fatal(err)
	}
}
