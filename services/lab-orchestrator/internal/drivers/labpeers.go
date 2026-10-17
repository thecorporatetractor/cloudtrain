package drivers

// Lab peers: the container nodes of a session that live on the platform pod
// network (every container node without a topology link; wired nodes live in
// the session VPC instead, see links.go). They get
//
//   - stable names: one headless Service per session ("ct-<hash>-nodes") is
//     the pods' subdomain, and every pod searches it, so `ping moto`,
//     `curl http://moto:5000` or `ssh git` work from any peer, and
//     "<node>.ct-<hash>-nodes.<namespace>.svc.<domain>" is the full name;
//   - one NetworkPolicy ("ct-<hash>-peers", primary interface only) that lets
//     the peers talk to each other on any port and admits nothing else:
//     no ingress from other labs or the platform, egress only to the other
//     peers, cluster DNS and the shared mirrors. The entry node keeps its own
//     policy on top (vclusters, lab VPC), NetworkPolicies add up.
//
// Before this, only the entry pod had a policy (other container nodes were
// open in both directions) and it did not allow traffic to the other nodes.

import (
	"strings"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// LabelLabPeer marks container node pods on the platform network (lab peers).
const LabelLabPeer = "labs.cloudtrain.dev/lab-peer"

// PeerServiceName is the session's headless Service (the peers' subdomain).
func PeerServiceName(s *labsv1.LabSession) string { return "ct-" + SessionHash(s) + "-nodes" }

// PeerPolicyName is the session's lab peer NetworkPolicy.
func PeerPolicyName(s *labsv1.LabSession) string { return "ct-" + SessionHash(s) + "-peers" }

// PeerDomain is the DNS search domain of the session's peers.
func PeerDomain(s *labsv1.LabSession, clusterDomain string) string {
	if clusterDomain == "" {
		clusterDomain = "cluster.local"
	}
	return PeerServiceName(s) + "." + s.Namespace + ".svc." + clusterDomain
}

// peerSelector selects the session's lab peer pods.
func peerSelector(s *labsv1.LabSession) map[string]string {
	sel := map[string]string{LabelSession: LabelValue(s.Name), LabelLabPeer: "true"}
	if s.UID != "" {
		sel[LabelSessionUID] = string(s.UID)
	}
	return sel
}

// nodeWired reports whether node is an end of a topology link.
func nodeWired(topo *labsv1.Topology, node string) bool {
	if topo == nil {
		return false
	}
	for _, l := range topo.Links {
		if strings.HasPrefix(l.A, node+":") || strings.HasPrefix(l.B, node+":") {
			return true
		}
	}
	return false
}

// LabPeers lists the topology's container nodes on the platform network.
func LabPeers(topo *labsv1.Topology) []string {
	if topo == nil {
		return nil
	}
	var out []string
	for _, n := range topo.Nodes {
		if n.Driver == labsv1.DriverContainer && !nodeWired(topo, n.Name) {
			out = append(out, n.Name)
		}
	}
	return out
}

// applyLabPeer makes a container node pod a lab peer (label, subdomain, DNS
// search) unless it is wired into the session VPC.
func (d *ContainerDriver) applyLabPeer(ref NodeRef, pod *corev1.Pod) {
	if ref.Template == nil || nodeWired(&ref.Template.Topology, ref.Node.Name) || ref.Node.Driver != labsv1.DriverContainer {
		return
	}
	if pod.Labels == nil {
		pod.Labels = map[string]string{}
	}
	pod.Labels[LabelLabPeer] = "true"
	pod.Spec.Subdomain = PeerServiceName(ref.Session)
	if pod.Spec.DNSConfig == nil {
		pod.Spec.DNSConfig = &corev1.PodDNSConfig{}
	}
	pod.Spec.DNSConfig.Searches = append(pod.Spec.DNSConfig.Searches, PeerDomain(ref.Session, d.ClusterDomain))
}

// PeerService is the session's headless Service. It has no ports (DNS only)
// and publishes pods before they are ready, so setup steps can use names.
func PeerService(s *labsv1.LabSession) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: PeerServiceName(s), Namespace: s.Namespace, Labels: SessionLabels(s)},
		Spec: corev1.ServiceSpec{
			ClusterIP:                corev1.ClusterIPNone,
			Selector:                 peerSelector(s),
			PublishNotReadyAddresses: true,
		},
	}
}

// PeerNetworkPolicy lets the session's lab peers reach each other and keeps
// everything else out (see the file comment). It applies to the primary
// interface only (AnnotationNetworkPolicyFor "ovn"): the entry node's
// access attachment to the lab VPC keeps the entry policy alone.
func PeerNetworkPolicy(s *labsv1.LabSession) *networkingv1.NetworkPolicy {
	udp, tcp := corev1.ProtocolUDP, corev1.ProtocolTCP
	dns := intstr.FromInt32(53)
	peers := []networkingv1.NetworkPolicyPeer{{PodSelector: &metav1.LabelSelector{MatchLabels: peerSelector(s)}}}
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name: PeerPolicyName(s), Namespace: s.Namespace, Labels: SessionLabels(s),
			Annotations: map[string]string{AnnotationNetworkPolicyFor: "ovn"},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: peerSelector(s)},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress},
			Ingress:     []networkingv1.NetworkPolicyIngressRule{{From: peers}},
			Egress: []networkingv1.NetworkPolicyEgressRule{
				{To: peers},
				{
					To: []networkingv1.NetworkPolicyPeer{{
						NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": "kube-system"}},
						PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"k8s-app": "kube-dns"}},
					}},
					Ports: []networkingv1.NetworkPolicyPort{{Protocol: &udp, Port: &dns}, {Protocol: &tcp, Port: &dns}},
				},
				MirrorEgressRule(),
			},
		},
	}
}
