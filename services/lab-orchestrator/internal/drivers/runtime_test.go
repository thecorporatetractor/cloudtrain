package drivers

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func kubeadmTopology() *labsv1.LabTemplateSpec {
	return &labsv1.LabTemplateSpec{Topology: labsv1.Topology{
		Entry: "workstation",
		Nodes: []labsv1.Node{
			{Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1", Access: []labsv1.AccessType{labsv1.AccessShell}},
			{Name: "qm-yard", Driver: labsv1.DriverK8sCluster, Image: "kubeadm:1.37", Cluster: &labsv1.ClusterSpec{
				Mode: labsv1.ClusterModeKubeadm, Context: "qm-yard",
				Nodes: []labsv1.ClusterNode{
					{Name: "yard-cp-1", Role: "control-plane", Taints: []string{"node-role.kubernetes.io/control-plane:NoSchedule"}},
					{Name: "yard-wk-1", Role: "worker", Labels: map[string]string{"disk": "nvme"}},
					{Name: "yard-wk-2", Role: "worker", State: "notready", Taints: []string{"x=y:NoSchedule"}},
				},
			}},
			{Name: "etcd", Driver: labsv1.DriverVM, Image: "etcd-host:3.6"},
			{Name: "qm-virt", Driver: labsv1.DriverK8sCluster, Cluster: &labsv1.ClusterSpec{Context: "qm-virt"}},
		},
	}}
}

func testSession() *labsv1.LabSession {
	return &labsv1.LabSession{ObjectMeta: metav1.ObjectMeta{Name: "s1", Namespace: "labs", UID: "uid-1"}}
}

func TestCatalog(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("catalog.yaml", "apiVersion: cloudtrain.dev/v1\nkind: ImageCatalog\nimages:\n  jumphost:1: {kind: container, image: cloudtrain/jumphost:1}\n  kubeadm:1.37: {kind: containerDisk, image: cloudtrain/kubeadm-node:v1.37.1}\nworkloadImages: [busybox:1.37]\n")
	write("overlay.yaml", "images:\n  kubeadm:1.35: {kind: containerDisk, image: cloudtrain/kubeadm-node:v1.37.1}\n")
	c, err := LoadCatalog(dir)
	if err != nil {
		t.Fatal(err)
	}
	if img, err := c.Resolve("kubeadm:1.35", ImageKindContainerDisk); err != nil || img.Image != "cloudtrain/kubeadm-node:v1.37.1" {
		t.Errorf("overlay alias: %v %v", img, err)
	}
	if _, err := c.Resolve("nope:1", ""); !errors.Is(err, ErrUnsupported) || !strings.Contains(err.Error(), "not in the image catalog") {
		t.Errorf("unknown ref: %v", err)
	}
	if _, err := c.Resolve("jumphost:1", ImageKindContainerDisk); !errors.Is(err, ErrUnsupported) {
		t.Errorf("kind mismatch: %v", err)
	}
	if _, err := LoadCatalog("../../../../deploy/images/catalog.yaml"); err != nil {
		t.Errorf("repository catalog: %v", err)
	}
	if _, err := ParseCatalog([]byte("images:\n  x: {kind: vm, image: a}\n")); err == nil {
		t.Error("unknown kind must fail")
	}
	if _, err := ParseCatalog([]byte("images: {}\nbogus: 1\n")); err == nil {
		t.Error("unknown field must fail (strict)")
	}
}

func TestHostPlan(t *testing.T) {
	hosts := HostPlan(&kubeadmTopology().Topology)
	got := []string{}
	for _, h := range hosts {
		got = append(got, h.Name+"="+h.IP)
		if !ipInLab(h.IP) {
			t.Errorf("%s not in lab CIDR", h.IP)
		}
	}
	want := "yard-cp-1=192.168.100.10 yard-wk-1=192.168.100.11 yard-wk-2=192.168.100.12 etcd=192.168.100.13"
	if strings.Join(got, " ") != want {
		t.Errorf("plan = %v", got)
	}
}

func TestPKIAndKubeconfigs(t *testing.T) {
	ca, err := NewCA("kubernetes", certValidity)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := CAPublicKeyHash(ca.Cert)
	if err != nil || !strings.HasPrefix(hash, "sha256:") || len(hash) != 71 {
		t.Errorf("hash %q %v", hash, err)
	}
	cert, err := NewClientCert(ca, "admin", []string{adminGroup}, certValidity)
	if err != nil {
		t.Fatal(err)
	}
	a, err := ClientKubeconfig("qm-a", "https://192.168.100.10:6443", ca.Cert, cert)
	if err != nil {
		t.Fatal(err)
	}
	b, err := RenameKubeconfig(a, "qm-b", "https://vc.ns.svc:443")
	if err != nil {
		t.Fatal(err)
	}
	merged, err := MergeKubeconfigs("", a, b)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := clientcmd.Load(merged)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.CurrentContext != "" || len(cfg.Contexts) != 2 || cfg.Clusters["qm-b"].Server != "https://vc.ns.svc:443" {
		t.Errorf("merged = %+v", cfg)
	}
	tok, err := NewBootstrapToken()
	if err != nil || len(tok) != 23 || tok[6] != '.' {
		t.Errorf("token %q", tok)
	}
	kp, err := NewSSHKeyPair("root@x")
	if err != nil || !strings.HasPrefix(string(kp.Private), "-----BEGIN OPENSSH PRIVATE KEY-----") {
		t.Fatalf("key: %v", err)
	}
	if l := KnownHostsLine([]string{"x", "192.168.100.10"}, kp.Public); !strings.HasPrefix(l, "x,192.168.100.10 ssh-ed25519 ") || strings.Contains(l, "root@x") {
		t.Errorf("known_hosts %q", l)
	}
}

func TestEntryPod(t *testing.T) {
	d := &ContainerDriver{AdminImage: "cloudtrain/jumphost:1"}
	ref := NodeRef{Session: testSession(), Template: kubeadmTopology()}
	ref.Node = ref.Template.Topology.Nodes[0]
	pod := d.BuildPod(ref)
	if len(pod.Spec.Containers) != 2 || pod.Spec.Containers[1].Name != AdminContainerName {
		t.Fatalf("containers = %+v", pod.Spec.Containers)
	}
	node, admin := pod.Spec.Containers[0], pod.Spec.Containers[1]
	if *node.SecurityContext.RunAsUser != 0 || *node.SecurityContext.AllowPrivilegeEscalation {
		t.Error("node container must be root without privilege escalation")
	}
	if _, ok := pod.Annotations[AnnotationLearnerSudo]; ok {
		t.Error("learner-sudo annotation without opt-in")
	}
	// Opt-in (security trade-off): setuid programs may escalate in the node
	// container only; the admin sidecar stays locked down.
	sudo := ref
	sudo.Node.LearnerSudo = true
	sp := d.BuildPod(sudo)
	if !*sp.Spec.Containers[0].SecurityContext.AllowPrivilegeEscalation || sp.Annotations[AnnotationLearnerSudo] != "true" {
		t.Error("learnerSudo must allow privilege escalation and be annotated")
	}
	if *sp.Spec.Containers[1].SecurityContext.AllowPrivilegeEscalation {
		t.Error("admin sidecar must never allow privilege escalation")
	}
	if p := sp.Spec.Containers[0].SecurityContext.Privileged; p != nil && *p {
		t.Error("learnerSudo must not make the container privileged")
	}
	if len(admin.SecurityContext.Capabilities.Drop) != 1 || len(admin.VolumeMounts) != 0 || len(node.VolumeMounts) != 0 {
		t.Error("admin sidecar must drop caps and share no volume with the node container")
	}
	if pod.Spec.ShareProcessNamespace != nil && *pod.Spec.ShareProcessNamespace {
		t.Error("process namespace must not be shared")
	}
	if len(pod.Spec.HostAliases) != 4 {
		t.Errorf("host aliases = %+v", pod.Spec.HostAliases)
	}
	n := NewLabNet(ref.Session)
	if pod.Annotations["k8s.v1.cni.cncf.io/networks"] != n.NAD() || pod.Annotations[n.Provider()+".kubernetes.io/ip_address"] != EntryIP {
		t.Errorf("annotations = %v", pod.Annotations)
	}
	// A non-entry container node stays a plain pod.
	ref.Template.Topology.Entry = "other"
	if p := d.BuildPod(ref); len(p.Spec.Containers) != 1 || p.Annotations != nil {
		t.Error("non-entry pod decorated")
	}
}

func TestEntryPolicy(t *testing.T) {
	s := testSession()
	np := EntryNetworkPolicy(s, "workstation", VClusterReleases(s, &kubeadmTopology().Topology))
	if len(np.Spec.Ingress) != 0 || len(np.Spec.PolicyTypes) != 2 {
		t.Error("entry must have no ingress")
	}
	if len(np.Spec.Egress) != 4 || np.Spec.Egress[1].To[0].PodSelector.MatchExpressions[0].Values[0] != VClusterRelease(s, "qm-virt") {
		t.Errorf("egress = %+v", np.Spec.Egress)
	}
	if m := np.Spec.Egress[3]; m.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"] != MirrorNamespace || len(m.Ports) != 3 {
		t.Errorf("mirror egress = %+v", m)
	}
}

func TestEntryPolicyNetworks(t *testing.T) {
	s := testSession()
	topo := &kubeadmTopology().Topology
	if got := EntryPolicyNetworks(s, topo, "workstation"); got != "" {
		t.Errorf("unwired entry: %q", got)
	}
	topo.Links = append(topo.Links, labsv1.Link{A: "workstation:eth1", B: "r1:eth1"})
	if got, want := EntryPolicyNetworks(s, topo, "workstation"), "ovn,"+s.Namespace+"/"+NewLabNet(s).NAD(); got != want {
		t.Errorf("wired entry with VM hosts: %q, want %q", got, want)
	}
	plain := &labsv1.Topology{Entry: "sw1", Nodes: []labsv1.Node{{Name: "sw1", Driver: labsv1.DriverContainer}, {Name: "h1", Driver: labsv1.DriverContainer}},
		Links: []labsv1.Link{{A: "h1:eth1", B: "sw1:eth1"}}}
	if got := EntryPolicyNetworks(s, plain, "sw1"); got != "ovn" {
		t.Errorf("wired entry, no VMs: %q", got)
	}
	if got := EntryPolicyNetworks(s, plain, "s"); got != "" {
		t.Errorf("prefix match: %q", got)
	}
}

func TestKubeadmUserdata(t *testing.T) {
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[1]}
	d := &KubeadmDriver{}
	l, err := d.layout(ref)
	if err != nil {
		t.Fatal(err)
	}
	ca, _ := NewCA("kubernetes", certValidity)
	hash, _ := CAPublicKeyHash(ca.Cert)
	p := clusterPKI{ca: ca, token: "abcdef.0123456789abcdef", caHash: hash, hostKey: map[string]SSHKeyPair{}}
	for _, m := range l.members {
		p.hostKey[m.Name], _ = NewSSHKeyPair("root@" + m.Name)
	}
	kp, _ := NewSSHKeyPair("learner")
	for _, m := range l.members {
		ud, err := d.userdata(ref, l, m, p, kp.Public, kp.Public)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(string(ud), "#cloud-config\n") {
			t.Fatal("missing header")
		}
		doc := map[string]any{}
		if err := yaml.Unmarshal(ud, &doc); err != nil {
			t.Fatalf("%s: invalid yaml: %v", m.Name, err)
		}
		s := string(ud)
		switch m.Name {
		case "yard-cp-1":
			for _, w := range []string{"kubeadm init", "__KUBE_VERSION__", "controlPlaneEndpoint: 192.168.100.10:6443", "cni-install", PodCIDR, "node-role.kubernetes.io/control-plane"} {
				if !strings.Contains(s, w) {
					t.Errorf("cp userdata lacks %q", w)
				}
			}
			if strings.Contains(s, "__POD_CIDR__") || strings.Contains(s, "__INIT_ATTEMPTS__") || strings.Contains(s, "__CRI__") {
				t.Error("placeholder not replaced")
			}
			// Bounded init retry with reset, restoring the pre-seeded CA.
			for _, w := range []string{"seq 1 3", "kubeadm reset -f --cri-socket " + criSocket, "/root/ca-seed/ca.key /etc/kubernetes/pki/ca.key",
				"failed after 3 attempts", "kubernetesAPICall: 3m0s", "controlPlaneComponentHealthCheck: 10m0s"} {
				if !strings.Contains(s, w) {
					t.Errorf("cp userdata lacks %q", w)
				}
			}
		case "yard-wk-1":
			if !strings.Contains(s, "taints: []") || strings.Contains(s, "disable --now kubelet") {
				t.Errorf("worker: explicit empty taints, kubelet kept\n%s", s)
			}
			if !strings.Contains(s, "seq 1 8") || !strings.Contains(s, "kubeadm reset -f") || !strings.Contains(s, "tlsBootstrap: 10m0s") {
				t.Errorf("worker: bounded join retry with reset and timeouts\n%s", s)
			}
		case "yard-wk-2":
			if !strings.Contains(s, "systemctl disable --now kubelet") || !strings.Contains(s, "effect: NoSchedule") {
				t.Error("notready worker must stop its kubelet and carry its taint")
			}
		}
	}
	script := convergeScript(ref, l)
	for _, w := range []string{"want 'yard-cp-1' ready", "want 'yard-wk-2' notready", "'kubectl' 'label' 'node' 'yard-wk-1' '--overwrite' 'disk=nvme'", "CoreDNS", "echo READY"} {
		if !strings.Contains(script, w) {
			t.Errorf("converge script lacks %q:\n%s", w, script)
		}
	}
	if _, err := ParseTaint("bad"); err == nil {
		t.Error("taint without effect accepted")
	}
	if tt, err := ParseTaint("a=b:NoExecute"); err != nil || tt.Key != "a" || tt.Value != "b" {
		t.Errorf("taint %+v %v", tt, err)
	}
	two := tpl.DeepCopy()
	two.Topology.Nodes[1].Cluster.Nodes[1].Role = "control-plane"
	if _, err := d.layout(NodeRef{Session: testSession(), Template: two, Node: two.Topology.Nodes[1]}); !errors.Is(err, ErrUnsupported) {
		t.Error("two control planes must be unsupported")
	}
}

func TestVClusterValuesAndPolicy(t *testing.T) {
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
	d := &VClusterDriver{}
	rel := VClusterRelease(ref.Session, ref.Node.Name)
	if len(rel) != 13 || !strings.HasPrefix(rel, "vc-") {
		t.Errorf("release %q", rel)
	}
	v, err := d.values(ref, rel)
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range []string{rel + ".ct-" + rel + ".svc", "enabled: false", LabelSessionUID + ": uid-1"} {
		if !strings.Contains(string(v), w) {
			t.Errorf("values lack %q:\n%s", w, v)
		}
	}
	np := d.workloadPolicy(ref, rel)
	if np.Spec.PodSelector.MatchLabels[LabelVClusterManagedBy] != rel || len(np.Spec.Egress) != 3 {
		t.Errorf("policy %+v", np.Spec)
	}
}

type scriptExecutor struct {
	calls [][]string
	stdin []string
}

func (s *scriptExecutor) Exec(_ context.Context, ns, pod, container string, cmd []string, stdin io.Reader, stdout, _ io.Writer) error {
	s.calls = append(s.calls, append([]string{pod, container}, cmd...))
	if stdin != nil {
		b, _ := io.ReadAll(stdin)
		s.stdin = append(s.stdin, string(b))
	}
	return nil
}

func TestRemoteExecRouting(t *testing.T) {
	tpl := kubeadmTopology()
	s := testSession()
	ex := &scriptExecutor{}
	c := &ContainerDriver{Executor: ex}
	cluster := NodeRef{Session: s, Template: tpl, Node: tpl.Topology.Nodes[1]}
	entry := ResourceName(s.Name, string(s.UID), "workstation")

	ka := &KubeadmDriver{Container: c}
	if _, err := ka.Exec(context.Background(), cluster, ExecRequest{Kind: ExecKubeApply, Stdin: []byte("kind: X")}); err != nil {
		t.Fatal(err)
	}
	if _, err := ka.Exec(context.Background(), cluster, ExecRequest{Member: "yard-wk-1", Command: []string{"/bin/sh", "-c", "echo 'hi'"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ka.Exec(context.Background(), cluster, ExecRequest{User: labsv1.ActionAsLearner, Command: []string{"kubectl", "get", "nodes"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ka.Exec(context.Background(), cluster, ExecRequest{Member: "nope", Command: []string{"true"}}); !errors.Is(err, ErrUnsupported) {
		t.Errorf("unknown member: %v", err)
	}
	got := []string{}
	for _, call := range ex.calls {
		got = append(got, strings.Join(call, " "))
	}
	want := []string{
		entry + " admin env KUBECONFIG=/root/.kube/qm-yard.conf kubectl apply -f -",
		entry + ` admin ssh -T yard-wk-1 '/bin/sh' '-c' 'echo '\''hi'\'''`,
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("call %d = %q, want %q", i, got[i], w)
		}
	}
	if !strings.HasPrefix(got[2], entry+" node runuser -u learner --") || !strings.Contains(got[2], "sh qm-yard kubectl get nodes") {
		t.Errorf("learner call = %q", got[2])
	}
}

func TestWire(t *testing.T) {
	ctx := context.Background()
	tpl := kubeadmTopology()
	s := testSession()
	d, c := newContainerDriver(t)
	ex := &scriptExecutor{}
	d.Executor = ex
	ref := NodeRef{Session: s, Template: tpl, Node: tpl.Topology.Nodes[0]}
	if done, err := d.Wire(ctx, ref, EntryAccess{}); err != nil || done {
		t.Fatalf("no pod: %v %v", done, err)
	}
	pod := d.BuildPod(ref)
	pod.Status = corev1.PodStatus{Phase: corev1.PodRunning, Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}}
	if err := c.Create(ctx, pod); err != nil {
		t.Fatal(err)
	}
	kp, _ := NewSSHKeyPair("x")
	ca, _ := NewCA("k", certValidity)
	cert, _ := NewClientCert(ca, "a", nil, certValidity)
	kc, _ := ClientKubeconfig("qm-yard", "https://1.2.3.4:6443", ca.Cert, cert)
	access := EntryAccess{LearnerKey: kp, AdminKey: kp, Hosts: []HostAccess{{Name: "yard-cp-1", IP: "192.168.100.10", HostKey: kp.Public}},
		Clusters: []ClusterAccess{{Node: "qm-yard", Context: "qm-yard", Learner: kc, Admin: kc}}}
	if done, err := d.Wire(ctx, ref, access); err != nil || !done {
		t.Fatalf("wire: %v %v", done, err)
	}
	if len(ex.calls) != 2 || ex.calls[0][1] != ContainerName || ex.calls[1][1] != AdminContainerName {
		t.Fatalf("calls = %v", ex.calls)
	}
	if !strings.Contains(ex.stdin[0], "home/learner/.kube/config") || strings.Contains(ex.stdin[0], "root/.kube") {
		t.Error("learner tar must hold only learner files")
	}
	if !strings.Contains(ex.stdin[1], "root/.kube/qm-yard.conf") || strings.Contains(ex.stdin[1], "home/learner") {
		t.Error("admin tar must hold only admin files")
	}
	// Idempotent: same content on the same pod instance is not rewritten.
	if err := c.Get(ctx, client.ObjectKeyFromObject(pod), pod); err != nil {
		t.Fatal(err)
	}
	if pod.Annotations[AnnotationWired] == "" {
		t.Fatal("wired annotation missing")
	}
	if done, err := d.Wire(ctx, ref, access); err != nil || !done || len(ex.calls) != 2 {
		t.Errorf("rewired: %v %v %d", done, err, len(ex.calls))
	}
}

func TestCloudInitRender(t *testing.T) {
	kp, _ := NewSSHKeyPair("x")
	ud, err := cloudInit{Hostname: "etcd", LearnerPub: kp.Public, AdminPub: kp.Public, HostKey: kp,
		Hosts: []PlannedHost{{Name: "etcd", IP: "192.168.100.10"}}}.Render()
	if err != nil {
		t.Fatal(err)
	}
	doc := map[string]any{}
	if err := yaml.Unmarshal(ud, &doc); err != nil {
		t.Fatal(err)
	}
	if doc["disable_root"] != false || doc["hostname"] != "etcd" {
		t.Errorf("doc = %v", doc)
	}
	if !strings.Contains(string(ud), "192.168.100.10 etcd") || !strings.Contains(string(ud), "NOPASSWD:ALL") {
		t.Error("hosts / sudo missing")
	}
}

// labctl verify and exam runs build their runtime with NewRuntime and exec steps on
// FRR nodes through the netdev driver, so it must be the real one, not the stub.
func TestNewRuntimeRegistersRealNetdevDriver(t *testing.T) {
	rt, err := NewRuntime(RuntimeOptions{})
	if err != nil {
		t.Fatal(err)
	}
	d, err := rt.Registry.Get(labsv1.DriverNetdev)
	if err != nil {
		t.Fatal(err)
	}
	nd, ok := d.(*NetdevDriver)
	if !ok {
		t.Fatalf("netdev driver is %T, want *NetdevDriver", d)
	}
	if nd.ContainerDriver != rt.Container {
		t.Fatal("netdev driver must share the runtime's container driver (and its lab network)")
	}
}
