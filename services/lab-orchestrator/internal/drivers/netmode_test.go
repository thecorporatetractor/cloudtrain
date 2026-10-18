package drivers

import (
	"context"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

var secondary = network.Options{Mode: network.ModeSecondary, MTU: network.DefaultLinkMTU}

func TestBuildVMNetworkModes(t *testing.T) {
	s := testSession()
	spec := vmSpec{Name: "vm-a", Hostname: "a", IP: "192.168.100.10", Image: "img", CISecret: "ci"}

	prim := buildVM(s, NewLabNet(s), spec)
	ann, _, _ := unstructured.NestedStringMap(prim.Object, "spec", "template", "metadata", "annotations")
	if ann["ovn.kubernetes.io/logical_switch"] != NewLabNet(s).LabSubnet() || ann["ovn.kubernetes.io/ip_address"] != "192.168.100.10" || len(ann) != 2 {
		t.Errorf("primary VM annotations = %v", ann)
	}
	nets, _, _ := unstructured.NestedSlice(prim.Object, "spec", "template", "spec", "networks")
	if _, ok := nets[0].(map[string]any)["pod"]; !ok || len(nets) != 1 {
		t.Errorf("primary VM networks = %v", nets)
	}

	n := NewLabNet(s)
	n.Options = secondary
	sec := buildVM(s, n, spec)
	ann, _, _ = unstructured.NestedStringMap(sec.Object, "spec", "template", "metadata", "annotations")
	p := n.LabProvider()
	if p != n.LabNAD()+"."+s.Namespace+".ovn" || ann[p+".kubernetes.io/logical_switch"] != n.LabSubnet() || ann[p+".kubernetes.io/ip_address"] != "192.168.100.10" || len(ann) != 2 {
		t.Errorf("secondary VM annotations = %v", ann)
	}
	nets, _, _ = unstructured.NestedSlice(sec.Object, "spec", "template", "spec", "networks")
	m, _, _ := unstructured.NestedMap(nets[0].(map[string]any), "multus")
	if len(nets) != 1 || nets[0].(map[string]any)["name"] != "default" || m["networkName"] != s.Namespace+"/"+n.LabNAD() || m["default"] != true {
		t.Errorf("secondary VM networks = %v", nets)
	}
	ifs, _, _ := unstructured.NestedSlice(sec.Object, "spec", "template", "spec", "domain", "devices", "interfaces")
	if _, ok := ifs[0].(map[string]any)["bridge"]; !ok {
		t.Errorf("secondary VM interface binding = %v", ifs)
	}
}

func TestLabNetworkEnsureSecondary(t *testing.T) {
	ctx := context.Background()
	s := testSession()
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	l := &LabNetwork{Client: c, Options: secondary}
	if _, err := l.Ensure(ctx, s); err != nil {
		t.Fatal(err)
	}
	n := l.LabNet(s)
	get := func(gvk, ns, name string) *unstructured.Unstructured {
		t.Helper()
		var g = map[string]*unstructured.Unstructured{"subnet": newObj(GVKSubnet, ns, name), "nad": newObj(GVKNAD, ns, name)}[gvk]
		if err := c.Get(ctx, client.ObjectKeyFromObject(g), g); err != nil {
			t.Fatalf("%s %s: %v", gvk, name, err)
		}
		return g
	}
	lab := get("subnet", "", n.LabSubnet())
	if prov, _, _ := unstructured.NestedString(lab.Object, "spec", "provider"); prov != n.LabProvider() {
		t.Errorf("lab subnet provider = %q", prov)
	}
	for _, sub := range []*unstructured.Unstructured{lab, get("subnet", "", n.AccessSubnet())} {
		if mtu, _, _ := unstructured.NestedInt64(sub.Object, "spec", "mtu"); mtu != 1400 {
			t.Errorf("%s mtu = %d", sub.GetName(), mtu)
		}
	}
	nad := get("nad", s.Namespace, n.LabNAD())
	if cfg, _, _ := unstructured.NestedString(nad.Object, "spec", "config"); cfg != network.NADConfig(n.LabProvider()) {
		t.Errorf("lab NAD config = %s", cfg)
	}
	get("nad", s.Namespace, n.NAD())

	// Primary mode creates no lab NAD and keeps the lab subnet provider-less.
	c2 := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	if _, err := (&LabNetwork{Client: c2}).Ensure(ctx, s); err != nil {
		t.Fatal(err)
	}
	if err := c2.Get(ctx, client.ObjectKey{Namespace: s.Namespace, Name: n.LabNAD()}, newObj(GVKNAD, "", "")); err == nil {
		t.Error("primary mode created a lab NAD")
	}
	lab2 := newObj(GVKSubnet, "", n.LabSubnet())
	if err := c2.Get(ctx, client.ObjectKeyFromObject(lab2), lab2); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := unstructured.NestedString(lab2.Object, "spec", "provider"); ok {
		t.Error("primary lab subnet has a provider")
	}
}

func TestEntryPolicyNetworksSecondary(t *testing.T) {
	s := testSession()
	topo := &kubeadmTopology().Topology
	if got := EntryPolicyNetworks(s, topo, "workstation", network.ModeSecondary); got != "" {
		t.Errorf("unwired entry: %q", got)
	}
	topo.Links = append(topo.Links, labsv1.Link{A: "workstation:eth1", B: "r1:eth1"})
	mgmt := network.MgmtSegment(network.SessionOf(s), network.ModeSecondary).NAD
	want := s.Namespace + "/" + mgmt + "," + s.Namespace + "/" + NewLabNet(s).NAD()
	if got := EntryPolicyNetworks(s, topo, "workstation", network.ModeSecondary); got != want {
		t.Errorf("wired entry: %q, want %q", got, want)
	}
}

func TestSessionNamespacePodSecurity(t *testing.T) {
	l := SessionNamespacePodSecurity()
	if l[LabelPodSecurityEnforce] != "privileged" || l[LabelPodSecurityAudit] != "baseline" || l[LabelPodSecurityEnforceVersion] != "latest" {
		t.Errorf("labels = %v", l)
	}
}

func TestRuntimeNetworkOptions(t *testing.T) {
	rt, err := NewRuntime(RuntimeOptions{Scheme: testScheme(t), Network: secondary})
	if err != nil {
		t.Fatal(err)
	}
	if rt.Session.networkMode() != network.ModeSecondary || !rt.Session.labNet(testSession()).Secondary() {
		t.Error("runtime does not carry the network mode to the VM lab network")
	}
	var nilRT *SessionRuntime
	if nilRT.networkMode() != network.ModePrimary || nilRT.labNet(testSession()).Secondary() {
		t.Error("nil runtime is not primary")
	}
}
