package drivers

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// recordingHelm records helm invocations and the per-session values file.
type recordingHelm struct {
	args   [][]string
	values []string
}

func (h *recordingHelm) Helm(_ context.Context, args ...string) ([]byte, error) {
	h.args = append(h.args, args)
	for i, a := range args {
		if a == "-f" || a == "--values" {
			if i+1 < len(args) && strings.HasSuffix(args[i+1], "session.yaml") {
				b, _ := os.ReadFile(args[i+1])
				h.values = append(h.values, string(b))
			}
		}
	}
	return nil, nil
}

func vclusterRef() NodeRef {
	tpl := kubeadmTopology()
	return NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
}

func TestVClusterHostIsolationObjects(t *testing.T) {
	ctx := context.Background()
	ref := vclusterRef()
	rel := VClusterRelease(ref.Session, ref.Node.Name)
	ns := VClusterNamespace(ref.Session, ref.Node.Name)
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	d := &VClusterDriver{Client: c, Helm: &recordingHelm{}, Chart: "vcluster.tgz"}
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}

	q := &corev1.ResourceQuota{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ns, Name: rel + "-quota"}, q); err != nil {
		t.Fatal(err)
	}
	for res, want := range map[corev1.ResourceName]string{
		corev1.ResourceServicesLoadBalancers: "0", corev1.ResourceServicesNodePorts: "0",
		corev1.ResourcePods: DefaultVClusterQuota.Pods, corev1.ResourceRequestsCPU: DefaultVClusterQuota.CPU,
		corev1.ResourceRequestsMemory: DefaultVClusterQuota.Memory, corev1.ResourceLimitsMemory: DefaultVClusterQuota.Memory,
		corev1.ResourceRequestsStorage:          DefaultVClusterQuota.Storage,
		corev1.ResourceRequestsEphemeralStorage: "4Gi", corev1.ResourceLimitsEphemeralStorage: "40Gi",
	} {
		got, ok := q.Spec.Hard[res]
		if !ok || got.String() != want {
			t.Errorf("quota %s = %v, want %s", res, got.String(), want)
		}
	}

	lr := &corev1.LimitRange{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ns, Name: rel + "-limits"}, lr); err != nil {
		t.Fatal(err)
	}
	item := lr.Spec.Limits[0]
	if item.Type != corev1.LimitTypeContainer || item.DefaultRequest.Memory().IsZero() || item.DefaultRequest.Cpu().IsZero() || item.Default.Memory().IsZero() || item.Max.Memory().IsZero() {
		t.Errorf("limit range = %+v", item)
	}
	if item.DefaultRequest.StorageEphemeral().String() != "64Mi" || item.Default.StorageEphemeral().String() != "1Gi" || item.Max.StorageEphemeral().String() != "4Gi" {
		t.Errorf("ephemeral storage defaults = %+v", item)
	}
	if _, ok := item.Max[corev1.ResourceCPU]; ok {
		t.Error("a CPU max would reject containers without a CPU limit (the control plane)")
	}

	np := &networkingv1.NetworkPolicy{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ns, Name: rel + "-control-plane"}, np); err != nil {
		t.Fatal(err)
	}
	if np.Spec.PodSelector.MatchLabels["app"] != "vcluster" || np.Spec.PodSelector.MatchLabels["release"] != rel || len(np.Spec.PolicyTypes) != 2 {
		t.Errorf("control plane policy = %+v", np.Spec)
	}
}

func TestVClusterControlPlanePolicy(t *testing.T) {
	ref := vclusterRef()
	rel := VClusterRelease(ref.Session, ref.Node.Name)

	// Known API server: egress only there, on its port.
	d := &VClusterDriver{APIServer: APIServerEndpoints{CIDRs: []string{"20.1.2.3/32"}, Ports: []int32{443}}}
	np := d.controlPlanePolicy(ref, rel)
	in := np.Spec.Ingress
	if len(in) != 1 || len(in[0].Ports) != 1 || in[0].Ports[0].Port.IntValue() != 8443 {
		t.Fatalf("ingress = %+v", in)
	}
	var fromSession, fromSynced bool
	for _, p := range in[0].From {
		if p.NamespaceSelector != nil && p.NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"] == ref.Session.Namespace &&
			p.PodSelector.MatchLabels[LabelSession] == LabelValue(ref.Session.Name) {
			fromSession = true
		}
		if p.NamespaceSelector == nil && p.PodSelector.MatchLabels[LabelVClusterManagedBy] == rel {
			fromSynced = true
		}
		if p.IPBlock != nil {
			t.Errorf("ingress from an IP block: %+v", p)
		}
	}
	if !fromSession || !fromSynced {
		t.Errorf("ingress peers = %+v", in[0].From)
	}
	api := np.Spec.Egress[2]
	if len(api.To) != 1 || api.To[0].IPBlock.CIDR != "20.1.2.3/32" || len(api.Ports) != 1 || api.Ports[0].Port.IntValue() != 443 {
		t.Errorf("api egress = %+v", api)
	}
	for _, e := range np.Spec.Egress {
		for _, p := range e.To {
			if p.IPBlock != nil && p.IPBlock.CIDR == "0.0.0.0/0" {
				t.Error("known API server: no egress to everywhere")
			}
		}
	}

	// Unknown API server: public addresses on 443/6443 only, never the
	// cluster, the VNet, IMDS or the wireserver.
	np = (&VClusterDriver{}).controlPlanePolicy(ref, rel)
	api = np.Spec.Egress[2]
	if api.To[0].IPBlock == nil || api.To[0].IPBlock.CIDR != "0.0.0.0/0" || len(api.Ports) != 2 {
		t.Fatalf("fallback api egress = %+v", api)
	}
	except := strings.Join(api.To[0].IPBlock.Except, ",")
	for _, w := range []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "168.63.129.16/32", "100.64.0.0/10"} {
		if !strings.Contains(except, w) {
			t.Errorf("fallback does not exclude %s: %s", w, except)
		}
	}
}

func TestVClusterSyncedPodsRuntimeClass(t *testing.T) {
	ctx := context.Background()
	ref := vclusterRef()
	rel := VClusterRelease(ref.Session, ref.Node.Name)
	rc := kataRC("kata-vm-isolation", "kata")

	// Tier V sandbox available: synced pods get its RuntimeClass.
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(rc, kataNode()).Build()
	base := &ContainerDriver{Client: c, Sandboxes: &Sandboxes{Tiers: map[string]SandboxTier{"V": {RuntimeClass: "kata-vm-isolation", Fallback: SandboxFallbackFail}}, Reader: c}}
	h := &recordingHelm{}
	d := &VClusterDriver{Client: c, Container: base, Helm: h, Chart: "vcluster.tgz"}
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if len(h.values) != 1 {
		t.Fatalf("helm values = %v (args %v)", h.values, h.args)
	}
	var vals struct {
		Sync struct {
			ToHost struct {
				Pods struct {
					RuntimeClassName string `json:"runtimeClassName"`
				} `json:"pods"`
			} `json:"toHost"`
		} `json:"sync"`
	}
	if err := yaml.Unmarshal([]byte(h.values[0]), &vals); err != nil {
		t.Fatal(err)
	}
	if vals.Sync.ToHost.Pods.RuntimeClassName != "kata-vm-isolation" {
		t.Errorf("runtimeClassName = %q\n%s", vals.Sync.ToHost.Pods.RuntimeClassName, h.values[0])
	}

	// Configured but unavailable (no matching node): no install at all.
	c2 := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(rc).Build()
	base2 := &ContainerDriver{Client: c2, Sandboxes: &Sandboxes{Tiers: map[string]SandboxTier{"V": {RuntimeClass: "kata-vm-isolation"}}, Reader: c2}}
	h2 := &recordingHelm{}
	d2 := &VClusterDriver{Client: c2, Container: base2, Helm: h2, Chart: "vcluster.tgz"}
	if _, err := d2.Provision(ctx, ref); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("unavailable sandbox: err = %v", err)
	}
	for _, a := range h2.args {
		if len(a) > 0 && (a[0] == "install" || a[0] == "upgrade") {
			t.Errorf("installed without the sandbox: %v", a)
		}
	}

	// No tier V sandbox: no runtimeClassName.
	v, err := (&VClusterDriver{}).values(ref, rel)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(v), "runtimeClassName") {
		t.Errorf("values without a sandbox set a runtimeClassName:\n%s", v)
	}
}

func TestParseAPIServerCIDRs(t *testing.T) {
	got, err := ParseAPIServerCIDRs("20.1.2.3, 10.0.0.0/24:6443,[fd00::1]:443")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got.CIDRs, ",") != "20.1.2.3/32,10.0.0.0/24,fd00::1/128" {
		t.Errorf("cidrs = %v", got.CIDRs)
	}
	if len(got.Ports) != 2 || got.Ports[0] != 443 || got.Ports[1] != 6443 {
		t.Errorf("ports = %v", got.Ports)
	}
	for _, bad := range []string{"example.com", "1.2.3.4:0", "1.2.3.4:x"} {
		if _, err := ParseAPIServerCIDRs(bad); err == nil {
			t.Errorf("%q must be rejected", bad)
		}
	}
}

func TestDetectAPIServerEndpoints(t *testing.T) {
	ep := &corev1.Endpoints{ //nolint:staticcheck // the API server maintains it
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "kubernetes"},
		Subsets: []corev1.EndpointSubset{{ //nolint:staticcheck // see above
			Addresses: []corev1.EndpointAddress{{IP: "172.18.0.2"}},
			Ports:     []corev1.EndpointPort{{Name: "https", Port: 6443}},
		}},
	}
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(ep).Build()
	got, err := DetectAPIServerEndpoints(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.CIDRs) != 1 || got.CIDRs[0] != "172.18.0.2/32" || len(got.Ports) != 1 || got.Ports[0] != 6443 {
		t.Errorf("got %+v", got)
	}
	if _, err := DetectAPIServerEndpoints(context.Background(), fake.NewClientBuilder().WithScheme(testScheme(t)).Build()); err == nil {
		t.Error("missing Endpoints must be an error")
	}
}

// The production profile reaches vclusters: no tier V sandbox or no known API
// server addresses, no vcluster.
func TestVClusterProductionProfile(t *testing.T) {
	ctx := context.Background()
	ref := vclusterRef()
	cases := map[string]struct {
		tiers map[string]SandboxTier
		api   APIServerEndpoints
		want  string
	}{
		"no tier V sandbox":     {map[string]SandboxTier{"B": {RuntimeClass: "kata-vm-isolation"}}, APIServerEndpoints{CIDRs: []string{"20.1.2.3/32"}, Ports: []int32{443}}, "tier V sandbox"},
		"API server unknown":    {map[string]SandboxTier{"V": {RuntimeClass: "kata-vm-isolation"}}, APIServerEndpoints{}, "API server's addresses"},
		"tier V and API server": {map[string]SandboxTier{"V": {RuntimeClass: "kata-vm-isolation"}}, APIServerEndpoints{CIDRs: []string{"20.1.2.3/32"}, Ports: []int32{443}}, ""},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(kataRC("kata-vm-isolation", "kata"), kataNode()).Build()
			base := &ContainerDriver{Client: c, RequireIsolation: true, Sandboxes: &Sandboxes{Tiers: tc.tiers, Reader: c}}
			h := &recordingHelm{}
			d := &VClusterDriver{Client: c, Container: base, Helm: h, Chart: "vcluster.tgz", APIServer: tc.api}
			st, err := d.Provision(ctx, ref)
			if tc.want == "" {
				if err != nil || len(h.values) != 1 {
					t.Fatalf("provision: %+v %v", st, err)
				}
				return
			}
			if !errors.Is(err, ErrUnsupported) || !strings.Contains(err.Error(), tc.want) || st.Phase != labsv1.NodeFailed {
				t.Fatalf("state %+v err %v, want a refusal naming %q", st, err, tc.want)
			}
			if len(h.values) != 0 {
				t.Error("installed anyway")
			}
		})
	}
}

func TestCheckPodCIDRs(t *testing.T) {
	node := func(ip string) corev1.Node {
		return corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "n-" + ip}, Status: corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: ip}, {Type: corev1.NodeHostName, Address: "n"}}}}
	}
	// Azure CNI overlay: nodes in the VNet, pods in 10.244.0.0/16.
	if err := CheckPodCIDRs([]corev1.Node{node("10.224.0.4"), node("10.224.0.5")}, []string{"10.244.0.0/16"}); err != nil {
		t.Error(err)
	}
	// Node-subnet mode: pods and nodes share 10.224.0.0/16.
	if err := CheckPodCIDRs([]corev1.Node{node("10.224.0.4")}, []string{"10.224.0.0/16"}); err == nil || !strings.Contains(err.Error(), "node-subnet") {
		t.Errorf("node subnet: %v", err)
	}
	if err := CheckPodCIDRs(nil, []string{"bogus"}); err == nil {
		t.Error("bad CIDR")
	}
}

// The control plane's limits fit the LimitRange (a chart default above the
// max made the StatefulSet pod forbidden and the session never got Ready).
func TestVClusterControlPlaneFitsLimitRange(t *testing.T) {
	ref := vclusterRef()
	rel := VClusterRelease(ref.Session, ref.Node.Name)
	v, err := (&VClusterDriver{}).values(ref, rel)
	if err != nil {
		t.Fatal(err)
	}
	var vals struct {
		ControlPlane struct {
			StatefulSet struct {
				Resources struct {
					Limits   map[string]string `json:"limits"`
					Requests map[string]string `json:"requests"`
				} `json:"resources"`
			} `json:"statefulSet"`
		} `json:"controlPlane"`
	}
	if err := yaml.Unmarshal(v, &vals); err != nil {
		t.Fatal(err)
	}
	r := vals.ControlPlane.StatefulSet.Resources
	lr := (&VClusterDriver{}).limitRange(ref, rel).Spec.Limits[0]
	for _, name := range []corev1.ResourceName{corev1.ResourceMemory, corev1.ResourceEphemeralStorage} {
		l, ok := r.Limits[string(name)]
		if !ok {
			t.Fatalf("control plane has no %s limit, so the chart default applies:\n%s", name, v)
		}
		limit := resource.MustParse(l)
		if max := lr.Max[name]; limit.Cmp(max) > 0 {
			t.Errorf("control plane %s limit %s exceeds the LimitRange max %s", name, l, max.String())
		}
		if req, ok := r.Requests[string(name)]; ok {
			if q := resource.MustParse(req); q.Cmp(limit) > 0 {
				t.Errorf("control plane %s request %s exceeds its limit %s", name, req, l)
			}
		}
	}
}
