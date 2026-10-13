package network

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

var sess = Session{Namespace: "labs", Name: "ospf-1", UID: "uid-1"}

// ospfTopology mirrors testdata/labs/net-ospf-two-routers plus a host-only link.
func ospfTopology() *labsv1.Topology {
	return &labsv1.Topology{
		Entry: "workstation",
		Nodes: []labsv1.Node{
			{Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1"},
			{Name: "edge-1", Driver: labsv1.DriverNetdev, Image: "frr:10"},
			{Name: "edge-2", Driver: labsv1.DriverNetdev, Image: "frr:10"},
			{Name: "core-host", Driver: labsv1.DriverContainer, Image: "nettools:1"},
			{Name: "wh-host", Driver: labsv1.DriverContainer, Image: "nettools:1"},
		},
		Links: []labsv1.Link{
			{A: "core-host:eth1", B: "edge-1:eth1", Subnet: "10.24.1.0/24"},
			{A: "edge-1:eth2", B: "edge-2:eth2", Subnet: "10.24.0.0/30",
				Impair: &labsv1.LinkImpairment{LatencyMs: ptr.To[int32](15), LossPct: "0.5", MTU: ptr.To[int32](1400)}},
			{A: "edge-2:eth1", B: "wh-host:eth1", Subnet: "10.24.2.0/24"},
			{A: "core-host:eth2", B: "wh-host:eth2", Subnet: "10.99.0.0/31"},
		},
	}
}

func TestBuildPlan(t *testing.T) {
	p, err := Build(sess, ospfTopology())
	if err != nil {
		t.Fatal(err)
	}
	if !p.Needed() || strings.Join(p.Wired, ",") != "edge-1,edge-2,core-host,wh-host" {
		t.Fatalf("wired = %v", p.Wired)
	}
	if p.IsWired("workstation") {
		t.Error("workstation has no links and must stay on the platform network")
	}
	if len(p.Links) != 4 {
		t.Fatalf("links = %d", len(p.Links))
	}
	wantCarrier := []string{"198.18.0.0/28", "198.18.0.16/28", "198.18.0.32/28", "198.18.0.48/28"}
	seen := map[string]bool{}
	for i, l := range p.Links {
		if l.Segment.CIDR.String() != wantCarrier[i] || l.Segment.Gateway != l.Segment.CIDR.Addr().Next() {
			t.Errorf("link %d carrier %s gw %s", i, l.Segment.CIDR, l.Segment.Gateway)
		}
		for _, n := range []string{l.Segment.Subnet, l.Segment.NAD} {
			if len(n) > 63 || seen[n] {
				t.Errorf("bad or duplicate name %q", n)
			}
			seen[n] = true
		}
		if l.Segment.Provider != l.Segment.NAD+".labs.ovn" {
			t.Errorf("provider = %s", l.Segment.Provider)
		}
	}
	// Links touching a router: the lab addresses every end.
	for i := 0; i < 3; i++ {
		for _, e := range p.Links[i].Ends {
			if e.Mode != AddressLab || e.Address.IsValid() {
				t.Errorf("link %d end %s: mode %s addr %s", i, e.Node, e.Mode, e.Address)
			}
		}
	}
	// Host-only /31: both addresses are usable.
	h := p.Links[3].Ends
	if h[0].Mode != AddressPlatform || h[0].Address.String() != "10.99.0.0/31" || h[1].Address.String() != "10.99.0.1/31" {
		t.Errorf("host link ends = %+v", h)
	}

	// Deterministic, and different for another session UID.
	p2, _ := Build(sess, ospfTopology())
	if p2.VPC != p.VPC || p2.Links[1].Segment.Subnet != p.Links[1].Segment.Subnet {
		t.Error("plan not deterministic")
	}
	other := sess
	other.UID = "uid-2"
	p3, _ := Build(other, ospfTopology())
	if p3.VPC == p.VPC || p3.Links[0].Segment.NAD == p.Links[0].Segment.NAD {
		t.Error("recreated session must not reuse names")
	}
}

func TestBuildAddressRule(t *testing.T) {
	topo := &labsv1.Topology{
		Nodes: []labsv1.Node{{Name: "a", Driver: labsv1.DriverContainer}, {Name: "b", Driver: labsv1.DriverVM}},
		Links: []labsv1.Link{{A: "a:eth1", B: "b:eth1", Subnet: "192.168.7.0/24"}, {A: "a:eth2", B: "b:eth2"}},
	}
	p, err := Build(sess, topo)
	if err != nil {
		t.Fatal(err)
	}
	if got := p.Links[0].Ends; got[0].Address.String() != "192.168.7.1/24" || got[1].Address.String() != "192.168.7.2/24" {
		t.Errorf("ends = %+v", got)
	}
	if got := p.Links[1].Ends; got[0].Mode != AddressNone || got[1].Mode != AddressNone {
		t.Errorf("no subnet ends = %+v", got)
	}
}

func TestBuildRejects(t *testing.T) {
	base := func(l labsv1.Link) *labsv1.Topology {
		return &labsv1.Topology{
			Nodes: []labsv1.Node{{Name: "a", Driver: labsv1.DriverContainer}, {Name: "r", Driver: labsv1.DriverNetdev}},
			Links: []labsv1.Link{l},
		}
	}
	for name, l := range map[string]labsv1.Link{
		"reserved subnet": {A: "a:eth1", B: "r:eth1", Subnet: "198.18.4.0/24"},
		"host bits":       {A: "a:eth1", B: "r:eth1", Subnet: "10.0.0.1/24"},
		"ipv6":            {A: "a:eth1", B: "r:eth1", Subnet: "2001:db8::/64"},
		"eth0":            {A: "a:eth0", B: "r:eth1"},
		"unknown node":    {A: "x:eth1", B: "r:eth1"},
		"no iface":        {A: "a", B: "r:eth1"},
		"mtu":             {A: "a:eth1", B: "r:eth1", Impair: &labsv1.LinkImpairment{MTU: ptr.To[int32](100)}},
		"loss":            {A: "a:eth1", B: "r:eth1", Impair: &labsv1.LinkImpairment{LossPct: "101"}},
		"/32 host link":   {A: "a:eth1", B: "a:eth2", Subnet: "10.0.0.1/32"},
	} {
		if _, err := Build(sess, base(l)); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	// No links, no netdev: no network.
	p, err := Build(sess, &labsv1.Topology{Nodes: []labsv1.Node{{Name: "a", Driver: labsv1.DriverContainer}}})
	if err != nil || p.Needed() {
		t.Errorf("needed = %v err = %v", p.Needed(), err)
	}
}

func TestDecoratePod(t *testing.T) {
	p, err := Build(sess, ospfTopology())
	if err != nil {
		t.Fatal(err)
	}
	pod := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "node"}}}}
	if err := p.DecoratePod("edge-1", pod, "node", PodOptions{ToolsImage: "cloudtrain/nettools:1", Router: true}); err != nil {
		t.Fatal(err)
	}
	if pod.Annotations[AnnotationLogicalSwitch] != p.Mgmt.Subnet {
		t.Errorf("primary switch = %q", pod.Annotations[AnnotationLogicalSwitch])
	}
	var nets []map[string]string
	if err := json.Unmarshal([]byte(pod.Annotations[AnnotationNetworks]), &nets); err != nil {
		t.Fatal(err)
	}
	if len(nets) != 2 || nets[0]["interface"] != "eth1" || nets[0]["name"] != p.Links[0].Segment.NAD ||
		nets[1]["interface"] != "eth2" || nets[1]["name"] != p.Links[1].Segment.NAD || nets[1]["namespace"] != "labs" {
		t.Errorf("networks = %v", nets)
	}
	if len(pod.Spec.InitContainers) != 1 || len(pod.Spec.Containers) != 2 || pod.Spec.Containers[1].Name != SidecarName {
		t.Fatalf("containers: init=%d main=%d", len(pod.Spec.InitContainers), len(pod.Spec.Containers))
	}
	script := pod.Spec.InitContainers[0].Command[2]
	for _, want := range []string{
		"net.ipv4.ip_forward=1",
		"ip -4 route del default via 198.19.255.1 dev eth0",
		"ip -4 addr flush dev eth1",
		"ip -4 addr flush dev eth2",
		"ip link set dev eth2 mtu 1400",
		"tc qdisc replace dev eth2 root netem delay 15ms loss 0.5%",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("init script lacks %q:\n%s", want, script)
		}
	}
	if strings.Contains(script, "dev eth1 root netem") || strings.Contains(script, "ip addr replace") {
		t.Errorf("unexpected commands:\n%s", script)
	}
	caps := pod.Spec.Containers[0].SecurityContext.Capabilities.Add
	if len(caps) != 2 {
		t.Errorf("node caps = %v", caps)
	}

	// A host on a host-only link gets its platform address, no forwarding.
	host := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "node"}}}}
	if err := p.DecoratePod("wh-host", host, "node", PodOptions{ToolsImage: "t"}); err != nil {
		t.Fatal(err)
	}
	hs := host.Spec.InitContainers[0].Command[2]
	if !strings.Contains(hs, "ip addr replace 10.99.0.1/31 dev eth2") || strings.Contains(hs, "ip_forward") {
		t.Errorf("host script:\n%s", hs)
	}

	// Unwired nodes are untouched.
	ws := &corev1.Pod{}
	if err := p.DecoratePod("workstation", ws, "node", PodOptions{ToolsImage: "t"}); err != nil || ws.Annotations != nil {
		t.Errorf("workstation decorated: %v %v", ws.Annotations, err)
	}
	if err := p.DecoratePod("edge-1", &corev1.Pod{}, "node", PodOptions{}); err == nil {
		t.Error("missing tools image must be an error")
	}
}

func TestLinkStatusesAndCapture(t *testing.T) {
	p, _ := Build(sess, ospfTopology())
	ls := p.LinkStatuses()
	if len(ls) != 4 || ls[1].ID != "link-1" || ls[1].Subnet != "10.24.0.0/30" || ls[1].Impair == nil ||
		ls[1].Network != "labs/"+p.Links[1].Segment.NAD || ls[1].Segment != p.Links[1].Segment.Subnet {
		t.Fatalf("status = %+v", ls)
	}
	if e := ls[0].Ends[0]; e.Node != "core-host" || e.Interface != "eth1" || e.AddressMode != "lab" || e.Address != "" {
		t.Errorf("end = %+v", e)
	}
	if e := ls[3].Ends[1]; e.AddressMode != "platform" || e.Address != "10.99.0.1/31" {
		t.Errorf("end = %+v", e)
	}
	if got := strings.Join(CaptureCommand("eth2", CaptureOptions{Filter: "proto ospf", Count: 3}), " "); got != "tcpdump -i eth2 -n -U -l -e -c 3 proto ospf" {
		t.Errorf("capture = %q", got)
	}
	if got := strings.Join(CaptureCommand("eth1", CaptureOptions{Pcap: true}), " "); got != "tcpdump -i eth1 -n -U -w -" {
		t.Errorf("pcap capture = %q", got)
	}
	if got := ImpairCommand("eth1", nil)[2]; !strings.Contains(got, "qdisc del dev eth1") {
		t.Errorf("clear = %q", got)
	}
}

func newFake(objs ...client.Object) client.Client {
	return fake.NewClientBuilder().WithScheme(runtime.NewScheme()).WithObjects(objs...).Build()
}

func setReady(t *testing.T, c client.Client, name string) {
	t.Helper()
	o := &unstructured.Unstructured{}
	o.SetGroupVersionKind(SubnetGVK)
	if err := c.Get(context.Background(), client.ObjectKey{Name: name}, o); err != nil {
		t.Fatal(err)
	}
	_ = unstructured.SetNestedSlice(o.Object, []any{map[string]any{"type": "Ready", "status": "True"}}, "status", "conditions")
	if err := c.Update(context.Background(), o); err != nil {
		t.Fatal(err)
	}
}

func TestManagerEnsureAndDelete(t *testing.T) {
	ctx := context.Background()
	c := newFake()
	m := &Manager{Client: c}
	p, _ := Build(sess, ospfTopology())

	ready, err := m.Ensure(ctx, p)
	if err != nil || ready {
		t.Fatalf("first ensure: ready=%v err=%v", ready, err)
	}
	objs := m.Objects(p)
	if len(objs) != 2+2*len(p.Links) {
		t.Fatalf("objects = %d", len(objs))
	}
	sub := &unstructured.Unstructured{}
	sub.SetGroupVersionKind(SubnetGVK)
	if err := c.Get(ctx, client.ObjectKey{Name: p.Links[1].Segment.Subnet}, sub); err != nil {
		t.Fatal(err)
	}
	if v, _, _ := unstructured.NestedString(sub.Object, "spec", "vpc"); v != p.VPC {
		t.Errorf("subnet vpc = %q", v)
	}
	if v, _, _ := unstructured.NestedString(sub.Object, "spec", "provider"); v != p.Links[1].Segment.Provider {
		t.Errorf("subnet provider = %q", v)
	}
	if v, _, _ := unstructured.NestedString(sub.Object, "spec", "cidrBlock"); v != "198.18.0.16/28" {
		t.Errorf("cidr = %q", v)
	}
	// Not ready until Kube-OVN marks every subnet Ready.
	if ready, _ := m.Ensure(ctx, p); ready {
		t.Error("ready before subnets are")
	}
	setReady(t, c, p.Mgmt.Subnet)
	for _, l := range p.Links {
		setReady(t, c, l.Segment.Subnet)
	}
	if ready, err := m.Ensure(ctx, p); !ready || err != nil {
		t.Fatalf("ensure: ready=%v err=%v", ready, err)
	}

	// Another session's objects are never touched.
	other := Session{Namespace: "labs", Name: "ospf-2", UID: "uid-9"}
	po, _ := Build(other, ospfTopology())
	if _, err := m.Ensure(ctx, po); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 5; i++ {
		done, err := m.Delete(ctx, sess)
		if err != nil {
			t.Fatal(err)
		}
		if done {
			break
		}
	}
	if done, _ := m.Delete(ctx, sess); !done {
		t.Fatal("delete not done")
	}
	for _, o := range objs {
		got := &unstructured.Unstructured{}
		got.SetGroupVersionKind(o.GroupVersionKind())
		if err := c.Get(ctx, client.ObjectKeyFromObject(o), got); err == nil {
			t.Errorf("%s %s still exists", o.GetKind(), o.GetName())
		}
	}
	vpc := &unstructured.Unstructured{}
	vpc.SetGroupVersionKind(VpcGVK)
	if err := c.Get(ctx, client.ObjectKey{Name: po.VPC}, vpc); err != nil {
		t.Errorf("other session's VPC deleted: %v", err)
	}
}

func TestManagerConflict(t *testing.T) {
	p, _ := Build(sess, ospfTopology())
	foreign := &unstructured.Unstructured{}
	foreign.SetGroupVersionKind(VpcGVK)
	foreign.SetName(p.VPC)
	m := &Manager{Client: newFake(foreign)}
	if _, err := m.Ensure(context.Background(), p); !errors.Is(err, ErrConflict) {
		t.Errorf("err = %v, want ErrConflict", err)
	}
}
