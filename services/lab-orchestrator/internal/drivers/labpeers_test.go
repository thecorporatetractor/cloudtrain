package drivers

import (
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func peerTopology() *labsv1.LabTemplateSpec {
	return &labsv1.LabTemplateSpec{Topology: labsv1.Topology{
		Entry: "workstation",
		Nodes: []labsv1.Node{
			{Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1"},
			{Name: "moto", Driver: labsv1.DriverContainer, Image: "moto:5"},
			{Name: "h1", Driver: labsv1.DriverContainer, Image: "nettools:1"},
			{Name: "r1", Driver: labsv1.DriverNetdev, Image: "frr:10"},
		},
		Links: []labsv1.Link{{A: "h1:eth1", B: "r1:eth1"}},
	}}
}

func TestLabPeers(t *testing.T) {
	tpl := peerTopology()
	got := LabPeers(&tpl.Topology)
	if len(got) != 2 || got[0] != "workstation" || got[1] != "moto" {
		t.Fatalf("peers = %v, want [workstation moto] (wired h1 and netdev r1 excluded)", got)
	}
	s := testSession()
	d := &ContainerDriver{}
	for _, n := range tpl.Topology.Nodes[:3] {
		ref := NodeRef{Session: s, Template: tpl, Node: n}
		pod := d.BuildPod(ref)
		d.applyLabPeer(ref, pod)
		peer := n.Name != "h1"
		if (pod.Labels[LabelLabPeer] == "true") != peer {
			t.Errorf("%s: lab-peer label %q, want peer=%v", n.Name, pod.Labels[LabelLabPeer], peer)
		}
		if !peer {
			if pod.Spec.Subdomain != "" || pod.Spec.DNSConfig != nil {
				t.Errorf("%s: wired node got peer DNS", n.Name)
			}
			continue
		}
		if pod.Spec.Hostname != n.Name || pod.Spec.Subdomain != PeerServiceName(s) {
			t.Errorf("%s: hostname %q subdomain %q", n.Name, pod.Spec.Hostname, pod.Spec.Subdomain)
		}
		want := PeerServiceName(s) + "." + s.Namespace + ".svc.cluster.local"
		if pod.Spec.DNSConfig == nil || len(pod.Spec.DNSConfig.Searches) != 1 || pod.Spec.DNSConfig.Searches[0] != want {
			t.Errorf("%s: dns config %+v, want search %s", n.Name, pod.Spec.DNSConfig, want)
		}
		for k, v := range PeerService(s).Spec.Selector {
			if pod.Labels[k] != v {
				t.Errorf("%s: service selector %s=%s does not match pod", n.Name, k, v)
			}
		}
	}
}

func TestPeerObjects(t *testing.T) {
	s := testSession()
	svc := PeerService(s)
	if svc.Spec.ClusterIP != "None" || !svc.Spec.PublishNotReadyAddresses || len(svc.Spec.Ports) != 0 {
		t.Errorf("service spec %+v", svc.Spec)
	}
	if len(svc.Name) > 63 {
		t.Errorf("service name too long: %s", svc.Name)
	}
	np := PeerNetworkPolicy(s)
	if np.Annotations[AnnotationNetworkPolicyFor] != "ovn" {
		t.Errorf("policy must cover the primary interface only: %v", np.Annotations)
	}
	if len(np.Spec.Ingress) != 1 || len(np.Spec.Ingress[0].From) != 1 || np.Spec.Ingress[0].From[0].NamespaceSelector != nil || np.Spec.Ingress[0].From[0].IPBlock != nil {
		t.Fatalf("ingress must admit only the session's peers: %+v", np.Spec.Ingress)
	}
	if got := np.Spec.Ingress[0].From[0].PodSelector.MatchLabels[LabelSessionUID]; got != string(s.UID) {
		t.Errorf("ingress peers not scoped to the session uid: %q", got)
	}
	for _, e := range np.Spec.Egress {
		for _, p := range e.To {
			if p.IPBlock != nil {
				t.Errorf("peer egress must not allow an IP block: %+v", p.IPBlock)
			}
		}
	}
}
