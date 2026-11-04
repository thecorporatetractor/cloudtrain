package drivers

import (
	"net/netip"
	"testing"

	networkingv1 "k8s.io/api/networking/v1"
)

// cloudMetadata are the addresses no lab pod may reach (security review
// network-4): link-local (the instance metadata service) and the Azure
// wireserver.
// All of link-local 169.254.0.0/16 counts (AWS/GCP/Azure IMDS at
// 169.254.169.254, Azure's IMDS for containers and other agents elsewhere in
// the range), sampled at its edges and the well-known addresses.
var cloudMetadata = []netip.Addr{
	netip.MustParseAddr("169.254.0.1"), netip.MustParseAddr("169.254.169.254"), netip.MustParseAddr("169.254.169.123"),
	netip.MustParseAddr("169.254.255.254"), netip.MustParseAddr("168.63.129.16"),
}

// allowsAddr reports whether an egress rule admits traffic to addr (any port).
func allowsAddr(r networkingv1.NetworkPolicyEgressRule, addr netip.Addr) bool {
	if len(r.To) == 0 {
		return true // no peers: every destination
	}
	for _, p := range r.To {
		if p.IPBlock == nil {
			continue // pod/namespace selectors never match host addresses
		}
		pfx, err := netip.ParsePrefix(p.IPBlock.CIDR)
		if err != nil || !pfx.Contains(addr) {
			continue
		}
		excluded := false
		for _, e := range p.IPBlock.Except {
			if ex, err := netip.ParsePrefix(e); err == nil && ex.Contains(addr) {
				excluded = true
			}
		}
		if !excluded {
			return true
		}
	}
	return false
}

// Every NetworkPolicy the orchestrator puts on lab pods keeps them away from
// IMDS and the wireserver, and none has an egress rule open to everywhere.
func TestLabPoliciesNeverAllowCloudMetadata(t *testing.T) {
	ref := vclusterTestRef()
	rel := VClusterRelease(ref.Session, ref.Node.Name)
	policies := map[string]*networkingv1.NetworkPolicy{
		"entry":             EntryNetworkPolicy(ref.Session, "workstation", []string{rel}),
		"lab peers":         PeerNetworkPolicy(ref.Session),
		"vcluster workload": (&VClusterDriver{}).workloadPolicy(ref, rel),
	}
	for name, np := range policies {
		hasEgress := false
		for _, pt := range np.Spec.PolicyTypes {
			hasEgress = hasEgress || pt == networkingv1.PolicyTypeEgress
		}
		if !hasEgress {
			t.Errorf("%s: no egress policy type, so egress is open", name)
		}
		for i, r := range np.Spec.Egress {
			for _, a := range cloudMetadata {
				if allowsAddr(r, a) {
					t.Errorf("%s: egress rule %d allows %s", name, i, a)
				}
			}
		}
	}
}

func vclusterTestRef() NodeRef {
	tpl := kubeadmTopology()
	return NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
}

func TestAllowsAddr(t *testing.T) {
	imds := cloudMetadata[0]
	open := networkingv1.NetworkPolicyEgressRule{}
	all := networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0"}}}}
	except := networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0", Except: []string{"169.254.0.0/16"}}}}}
	if !allowsAddr(open, imds) || !allowsAddr(all, imds) || allowsAddr(except, imds) {
		t.Error("allowsAddr is wrong")
	}
}
