package drivers

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

func netTemplate() *labsv1.LabTemplateSpec {
	return &labsv1.LabTemplateSpec{Topology: labsv1.Topology{
		Nodes: []labsv1.Node{
			{Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1", Access: []labsv1.AccessType{labsv1.AccessShell}},
			{Name: "edge-1", Driver: labsv1.DriverNetdev, Image: "frr:10", Access: []labsv1.AccessType{labsv1.AccessConsole, labsv1.AccessSSH}},
			{Name: "host", Driver: labsv1.DriverContainer, Image: "nettools:1"},
		},
		Links: []labsv1.Link{{A: "host:eth1", B: "edge-1:eth1", Subnet: "10.1.0.0/24"}},
	}}
}

func netRef(node string) NodeRef {
	tpl := netTemplate()
	n, _ := func() (labsv1.Node, bool) {
		for _, n := range tpl.Topology.Nodes {
			if n.Name == node {
				return n, true
			}
		}
		return labsv1.Node{}, false
	}()
	return NodeRef{
		Session:  &labsv1.LabSession{ObjectMeta: metav1.ObjectMeta{Name: "s-net", Namespace: "labs", UID: "uid-n"}},
		Template: tpl,
		Node:     n,
	}
}

func newNetdev(t *testing.T) (*NetdevDriver, client.Client, *recordingExecutor) {
	s := testScheme(t)
	c := fake.NewClientBuilder().WithScheme(s).Build()
	rec := &recordingExecutor{}
	base := &ContainerDriver{Client: c, Scheme: s, ImageRegistry: "cloudtrain", Executor: rec}
	base.Network = &LinkNetwork{Manager: &network.Manager{Client: c}, ToolsImage: base.ImageFor("nettools:1"), DestroyWait: time.Millisecond}
	return NewNetdev(base), c, rec
}

func TestNetdevProvisionPod(t *testing.T) {
	ctx := context.Background()
	d, c, _ := newNetdev(t)
	ref := netRef("edge-1")
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	pod := &corev1.Pod{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}, pod); err != nil {
		t.Fatal(err)
	}
	main := pod.Spec.Containers[0]
	if main.Image != "cloudtrain/frr:10" || main.StartupProbe == nil ||
		strings.Join(main.StartupProbe.Exec.Command, " ") != "vtysh -c show version" {
		t.Errorf("main container = %+v", main)
	}
	assertNetdevLockedDown(t, pod, false)
	if pod.Annotations[network.AnnotationNetworks] == "" || pod.Annotations[network.AnnotationLogicalSwitch] == "" {
		t.Errorf("annotations = %v", pod.Annotations)
	}
	if len(pod.Spec.InitContainers) != 1 || !strings.Contains(pod.Spec.InitContainers[0].Command[2], "ip_forward=1") {
		t.Error("router pod needs net-init with forwarding")
	}
	if pod.Spec.InitContainers[0].Image != "cloudtrain/nettools:1" {
		t.Errorf("tools image = %s", pod.Spec.InitContainers[0].Image)
	}
	// No Service for devices.
	if err := c.Get(ctx, client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}, &corev1.Service{}); err == nil {
		t.Error("netdev must not create a Service")
	}
	if err := d.Destroy(ctx, ref); err != nil {
		t.Fatal(err)
	}
}

func TestNetdevExec(t *testing.T) {
	ctx := context.Background()
	ref := netRef("edge-1")
	pfx := "labs " + ref.ResourceName() + " node "
	tests := []struct {
		name    string
		req     ExecRequest
		wantCmd string
		wantErr error
	}{
		{name: "config", req: ExecRequest{Kind: ExecDeviceConfig, Stdin: []byte("router ospf\n")}, wantCmd: pfx + "/bin/sh -c"},
		{name: "cli", req: ExecRequest{Kind: ExecDeviceCommand, Command: []string{"show ip ospf neighbor"}}, wantCmd: pfx + "vtysh -c show ip ospf neighbor"},
		{name: "cli lines", req: ExecRequest{Kind: ExecDeviceCommand, Command: []string{"show version\nshow ip route"}}, wantCmd: pfx + "vtysh -c show version -c show ip route"},
		{name: "shell", req: ExecRequest{Command: []string{"ip", "route"}}, wantCmd: pfx + "ip route"},
		{name: "learner shell", req: ExecRequest{User: labsv1.ActionAsLearner, Command: []string{"id"}}, wantErr: ErrUnsupported},
		{name: "apply", req: ExecRequest{Kind: ExecKubeApply}, wantErr: ErrUnsupported},
		{name: "empty cli", req: ExecRequest{Kind: ExecDeviceCommand}, wantErr: errors.New("x")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, _, rec := newNetdev(t)
			_, err := d.Exec(ctx, ref, tt.req)
			if tt.wantErr != nil {
				if err == nil || (tt.wantErr == ErrUnsupported && !errors.Is(err, ErrUnsupported)) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(rec.cmd, " "); !strings.HasPrefix(got, tt.wantCmd) {
				t.Errorf("cmd = %q, want prefix %q", got, tt.wantCmd)
			}
			if tt.req.Kind == ExecDeviceConfig {
				if rec.stdin != "router ospf\n" || !strings.Contains(strings.Join(rec.cmd, " "), `vtysh -f "$f"`) {
					t.Errorf("config exec = %q stdin %q", rec.cmd, rec.stdin)
				}
			}
		})
	}
}

func TestNetdevConnectAndFamilies(t *testing.T) {
	d, _, _ := newNetdev(t)
	ref := netRef("edge-1")
	ep, err := d.Connect(context.Background(), ref, labsv1.AccessConsole)
	if err != nil || ep.Protocol != "k8s-exec" || ep.Command != "vtysh" || ep.Target != "labs/"+ref.ResourceName()+"/node" {
		t.Errorf("console = %+v, %v", ep, err)
	}
	if _, err := d.Connect(context.Background(), ref, labsv1.AccessWeb); !errors.Is(err, ErrUnsupported) {
		t.Errorf("web: %v", err)
	}
	bad := ref
	bad.Node.Image = "ceos:4"
	if _, err := d.Provision(context.Background(), bad); !IsPermanent(err) {
		t.Errorf("unknown family must be permanent: %v", err)
	}
	vm := &NetdevDriver{ContainerDriver: d.ContainerDriver, Families: []DeviceFamily{vmFamily{}}}
	if _, err := vm.Provision(context.Background(), ref); !errors.Is(err, ErrNotImplemented) {
		t.Errorf("vm backend: %v", err)
	}
	noNet := NewNetdev(&ContainerDriver{Client: d.Client})
	if _, err := noNet.Provision(context.Background(), ref); !errors.Is(err, ErrUnsupported) {
		t.Errorf("no network: %v", err)
	}
}

type vmFamily struct{ FRR }

func (vmFamily) Backend() NetdevBackend { return NetdevVM }

func TestContainerLinksNeedNetwork(t *testing.T) {
	ctx := context.Background()
	d, _ := newContainerDriver(t)
	if _, err := d.Provision(ctx, netRef("host")); !errors.Is(err, ErrUnsupported) {
		t.Errorf("host with links and no network: %v", err)
	}
	// The workstation has no links: fine without a network.
	if _, err := d.Provision(ctx, netRef("workstation")); err != nil {
		t.Error(err)
	}
	if ok, err := d.ProvisionTopology(ctx, SessionRef{Session: netRef("host").Session, Template: netTemplate()}); !ok || err != nil {
		t.Errorf("topology without network: %v %v", ok, err)
	}
}

func TestLinkNetworkTopology(t *testing.T) {
	ctx := context.Background()
	d, c, rec := newNetdev(t)
	ref := netRef("host")
	sref := SessionRef{Session: ref.Session, Template: ref.Template}
	ready, err := d.ProvisionTopology(ctx, sref)
	if err != nil || ready {
		t.Fatalf("ready=%v err=%v", ready, err)
	}
	// Host pod: sidecar + net-init, NET_ADMIN on the node container, Service kept.
	if _, err := d.ContainerDriver.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	pod := &corev1.Pod{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}, pod); err != nil {
		t.Fatal(err)
	}
	if len(pod.Spec.Containers) != 2 || strings.Contains(pod.Spec.InitContainers[0].Command[2], "ip_forward") {
		t.Errorf("host pod wiring wrong")
	}
	links, err := d.Links(sref)
	if err != nil || len(links) != 1 || links[0].Ends[0].Node != "host" || links[0].Ends[0].AddressMode != "lab" {
		t.Errorf("links = %+v %v", links, err)
	}
	// Capture runs tcpdump in the sidecar of the end's pod.
	ln := d.Network.(*LinkNetwork)
	if err := ln.Capture(ctx, rec, sref, "edge-1", "eth1", network.CaptureOptions{Filter: "proto ospf", Count: 2}, &strings.Builder{}, &strings.Builder{}); err != nil {
		t.Fatal(err)
	}
	want := "labs " + ResourceName("s-net", "uid-n", "edge-1") + " net tcpdump -i eth1"
	if got := strings.Join(rec.cmd, " "); !strings.HasPrefix(got, want) {
		t.Errorf("capture cmd = %q", got)
	}
	if _, err := ln.CaptureTarget(sref, "edge-1", "eth9", network.CaptureOptions{}); !errors.Is(err, ErrUnsupported) {
		t.Errorf("unknown end: %v", err)
	}
	// Teardown waits for the session's pods, then removes the network.
	if err := d.DestroyTopology(ctx, sref); !errors.Is(err, errNetworkTerminating) {
		t.Fatalf("destroy with pods left: %v", err)
	}
	if err := d.ContainerDriver.Destroy(ctx, ref); err != nil {
		t.Fatal(err)
	}
	var derr error
	for i := 0; i < 5; i++ {
		if derr = d.DestroyTopology(ctx, sref); derr == nil {
			break
		}
	}
	if derr != nil {
		t.Fatal(derr)
	}
	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(network.SubnetGVK.GroupVersion().WithKind("SubnetList"))
	if err := c.List(ctx, list); err != nil || len(list.Items) != 0 {
		t.Errorf("subnets left: %d %v", len(list.Items), err)
	}
}

// assertNetdevLockedDown checks the device pod's isolation: seccomp
// RuntimeDefault for the pod, every capability dropped and only the
// allowlist added back, and privilege escalation only with learnerSudo.
func assertNetdevLockedDown(t *testing.T, pod *corev1.Pod, sudo bool) {
	t.Helper()
	if sc := pod.Spec.SecurityContext; sc == nil || sc.SeccompProfile == nil || sc.SeccompProfile.Type != corev1.SeccompProfileTypeRuntimeDefault {
		t.Errorf("pod seccomp = %+v, want RuntimeDefault", pod.Spec.SecurityContext)
	}
	main := pod.Spec.Containers[0]
	sc := main.SecurityContext
	if sc == nil || sc.AllowPrivilegeEscalation == nil || *sc.AllowPrivilegeEscalation != sudo {
		t.Errorf("allowPrivilegeEscalation = %v, want %v", sc.AllowPrivilegeEscalation, sudo)
	}
	if sc.Privileged != nil && *sc.Privileged {
		t.Error("device container must not be privileged")
	}
	if got := sc.Capabilities.Drop; len(got) != 1 || got[0] != "ALL" {
		t.Errorf("drop = %v, want [ALL]", got)
	}
	allowed := map[corev1.Capability]bool{}
	for _, c := range append(append([]corev1.Capability{}, netdevBaseCapabilities...), FRR{}.Capabilities()...) {
		allowed[c] = true
	}
	for _, c := range sc.Capabilities.Add {
		if !allowed[c] {
			t.Errorf("capability %s is not in the netdev allowlist", c)
		}
		delete(allowed, c)
	}
	if len(allowed) != 0 {
		t.Errorf("missing capabilities %v", allowed)
	}
	for _, c := range []corev1.Capability{"MKNOD", "SETFCAP", "SETPCAP", "SYS_MODULE", "SYS_PTRACE", "BPF", "PERFMON"} {
		for _, a := range sc.Capabilities.Add {
			if a == c {
				t.Errorf("capability %s must not be added", c)
			}
		}
	}
	if got := pod.Annotations[AnnotationLearnerSudo] == "true"; got != sudo {
		t.Errorf("learner-sudo annotation = %v, want %v", got, sudo)
	}
}

func TestNetdevLearnerSudoException(t *testing.T) {
	ctx := context.Background()
	ref := netRef("edge-1")
	ref.Node.LearnerSudo = true

	// Host users and no sandbox: sudo would be root with SYS_ADMIN on the host
	// kernel, so the device is refused.
	d0, c0, _ := newNetdev(t)
	st, err := d0.Provision(ctx, ref)
	if !errors.Is(err, ErrUnsupported) || st.Phase != labsv1.NodeFailed || !strings.Contains(err.Error(), "user namespace or a sandbox") {
		t.Fatalf("learnerSudo with host users: state %+v err %v", st, err)
	}
	if err := c0.Get(ctx, client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}, &corev1.Pod{}); err == nil {
		t.Error("refused device must not get a pod")
	}

	// In a user namespace (the lab network runs wired pods with hostUsers: false).
	d, c, _ := newNetdev(t)
	d.Network.(*LinkNetwork).UserNamespaces = true
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	pod := &corev1.Pod{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}, pod); err != nil {
		t.Fatal(err)
	}
	assertNetdevLockedDown(t, pod, true)

	if p := mustPod(t, c, ref); p.Spec.HostUsers == nil || *p.Spec.HostUsers {
		t.Error("learnerSudo device must run with hostUsers: false")
	}

	// The operator can refuse it.
	d2, c2, _ := newNetdev(t)
	d2.Network.(*LinkNetwork).UserNamespaces = true
	d2.DenyLearnerSudo = true
	st, err = d2.Provision(ctx, ref)
	if !errors.Is(err, ErrUnsupported) || st.Phase != labsv1.NodeFailed {
		t.Fatalf("deny learner sudo: state %+v err %v", st, err)
	}
	if err := c2.Get(ctx, client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}, &corev1.Pod{}); err == nil {
		t.Error("refused node must not get a pod")
	}
}

func TestNetdevSandboxTier(t *testing.T) {
	ctx := context.Background()
	cat, err := ParseCatalog([]byte(`
images:
  frr:10: { kind: container, image: cloudtrain/frr:10, netdev: frr, tier: "N" }
  nettools:1: { kind: container, image: cloudtrain/nettools:1 }
`))
	if err != nil {
		t.Fatal(err)
	}
	s := testScheme(t)
	c := fake.NewClientBuilder().WithScheme(s).WithObjects(kataRC("kata-vm-isolation", "kata"), kataNode()).Build()
	base := &ContainerDriver{Client: c, Scheme: s, ImageRegistry: "cloudtrain", Executor: &recordingExecutor{}, Catalog: cat}
	base.Sandboxes = &Sandboxes{Tiers: map[string]SandboxTier{"N": {RuntimeClass: "kata-vm-isolation", Fallback: SandboxFallbackFail}}, Reader: c}
	base.Network = &LinkNetwork{Manager: &network.Manager{Client: c}, ToolsImage: base.ImageFor("nettools:1"), DestroyWait: time.Millisecond}
	d := NewNetdev(base)
	ref := netRef("edge-1")
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	pod := &corev1.Pod{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}, pod); err != nil {
		t.Fatal(err)
	}
	if pod.Spec.RuntimeClassName == nil || *pod.Spec.RuntimeClassName != "kata-vm-isolation" {
		t.Errorf("runtimeClassName = %v, want the tier N sandbox", pod.Spec.RuntimeClassName)
	}
	if pod.Annotations[AnnotationSandbox] != "kata-vm-isolation" {
		t.Errorf("sandbox annotation = %q", pod.Annotations[AnnotationSandbox])
	}
	assertNetdevLockedDown(t, pod, false)
}

func TestCatalogRejectsUnknownTier(t *testing.T) {
	// A bare `tier: N` is YAML 1.1 false and would silently disable the tier N sandbox.
	if _, err := ParseCatalog([]byte("images:\n  frr:10: { kind: container, image: cloudtrain/frr:10, tier: N }\n")); err == nil {
		t.Fatal("bare tier N must be rejected")
	}
	if _, err := ParseCatalog([]byte("images:\n  frr:10: { kind: container, image: cloudtrain/frr:10, tier: \"N\" }\n")); err != nil {
		t.Fatal(err)
	}
}

func mustPod(t *testing.T, c client.Client, ref NodeRef) *corev1.Pod {
	t.Helper()
	p := &corev1.Pod{}
	if err := c.Get(context.Background(), client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, p); err != nil {
		t.Fatal(err)
	}
	return p
}

// learnerSudo in the tier N sandbox (a VM per pod) is allowed without user namespaces.
func TestNetdevLearnerSudoInSandbox(t *testing.T) {
	ctx := context.Background()
	cat, err := ParseCatalog([]byte("images:\n  frr:10: { kind: container, image: cloudtrain/frr:10, netdev: frr, tier: \"N\" }\n  nettools:1: { kind: container, image: cloudtrain/nettools:1 }\n"))
	if err != nil {
		t.Fatal(err)
	}
	s := testScheme(t)
	c := fake.NewClientBuilder().WithScheme(s).WithObjects(kataRC("kata-vm-isolation", "kata"), kataNode()).Build()
	base := &ContainerDriver{Client: c, Scheme: s, ImageRegistry: "cloudtrain", Executor: &recordingExecutor{}, Catalog: cat}
	base.Sandboxes = &Sandboxes{Tiers: map[string]SandboxTier{"N": {RuntimeClass: "kata-vm-isolation", Fallback: SandboxFallbackFail}}, Reader: c}
	base.Network = &LinkNetwork{Manager: &network.Manager{Client: c}, ToolsImage: base.ImageFor("nettools:1"), DestroyWait: time.Millisecond}
	ref := netRef("edge-1")
	ref.Node.LearnerSudo = true
	if _, err := NewNetdev(base).Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if p := mustPod(t, c, ref); p.Spec.RuntimeClassName == nil || *p.Spec.RuntimeClassName != "kata-vm-isolation" {
		t.Errorf("runtimeClassName = %v", p.Spec.RuntimeClassName)
	}
}
