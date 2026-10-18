package drivers

// Per-session lab network for VM-backed nodes (kubeadm cluster members and
// vm nodes), ported from deploy/scripts/lab-demo.sh:
//
//	Kube-OVN VPC ct-<hash>          (no route to the platform pod network or the internet)
//	 ├─ subnet ct-<hash>-lab     192.168.100.0/24  VM hosts .10, .11, ... in topology order
//	 └─ subnet ct-<hash>-access  192.168.99.0/24   entry node .5 (Multus NAD, provider ct-<hash>-access.<ns>.ovn)
//
// In network mode secondary (Kube-OVN not the primary CNI) the lab subnet is
// a NAD segment too (NAD ct-<hash>-lab, provider ct-<hash>-lab.<ns>.ovn), and
// VMs take it as their Multus default network (KubeVirt multus.default).
//
// Every session gets its own VPC, so all sessions use the same private IPs.
// This file is self-contained on purpose: it is expected to move onto the
// shared internal/network package (per-link segments) later.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"strings"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/intstr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

// Lab network addressing (identical in every session).
const (
	LabCIDR       = "192.168.100.0/24"
	LabGateway    = "192.168.100.1"
	AccessCIDR    = "192.168.99.0/24"
	AccessGateway = "192.168.99.1"
	EntryIP       = "192.168.99.5"
	firstHostIP   = 10
)

// GVKs of the Kube-OVN, Multus and KubeVirt objects (handled unstructured to
// keep their Go modules out of the build).
var (
	GVKVpc            = schema.GroupVersionKind{Group: "kubeovn.io", Version: "v1", Kind: "Vpc"}
	GVKSubnet         = schema.GroupVersionKind{Group: "kubeovn.io", Version: "v1", Kind: "Subnet"}
	GVKNAD            = schema.GroupVersionKind{Group: "k8s.cni.cncf.io", Version: "v1", Kind: "NetworkAttachmentDefinition"}
	GVKVirtualMachine = schema.GroupVersionKind{Group: "kubevirt.io", Version: "v1", Kind: "VirtualMachine"}
	GVKVMI            = schema.GroupVersionKind{Group: "kubevirt.io", Version: "v1", Kind: "VirtualMachineInstance"}
	GVKDataVolume     = schema.GroupVersionKind{Group: "cdi.kubevirt.io", Version: "v1beta1", Kind: "DataVolume"}
)

// PlannedHost is a VM-backed host on the lab subnet.
type PlannedHost struct {
	// Name is the host name ("ctl-1" for a cluster member, the node name for a vm node).
	Name string
	// Node is the topology node the host belongs to.
	Node string
	// Member is the cluster member name, empty for a vm node.
	Member string
	IP     string
}

// HostPlan assigns lab subnet IPs to every VM-backed host of the topology,
// in topology order: kubeadm cluster members, then vm nodes as they appear.
func HostPlan(topo *labsv1.Topology) []PlannedHost {
	var out []PlannedHost
	next := firstHostIP
	add := func(name, node, member string) {
		out = append(out, PlannedHost{Name: name, Node: node, Member: member, IP: fmt.Sprintf("192.168.100.%d", next)})
		next++
	}
	for _, n := range topo.Nodes {
		switch {
		case n.Driver == labsv1.DriverVM:
			add(n.Name, n.Name, "")
		case n.Driver == labsv1.DriverK8sCluster && n.Cluster != nil && n.Cluster.Mode == labsv1.ClusterModeKubeadm:
			for _, m := range n.Cluster.Nodes {
				add(m.Name, n.Name, m.Name)
			}
		}
	}
	return out
}

// NeedsLabNetwork reports whether the topology has VM-backed hosts.
func NeedsLabNetwork(topo *labsv1.Topology) bool { return len(HostPlan(topo)) > 0 }

// SessionHash is a short stable id of a session (name + UID), used for
// cluster-scoped and per-session object names.
func SessionHash(s *labsv1.LabSession) string {
	sum := sha256.Sum256([]byte(s.Namespace + "\x00" + s.Name + "\x00" + string(s.UID)))
	return hex.EncodeToString(sum[:])[:10]
}

// LabNet names the per-session network objects.
type LabNet struct {
	Namespace string
	Hash      string
	// Options: network mode and segment MTU (zero value: primary, CNI MTU).
	Options network.Options
}

// NewLabNet returns the network names of a session.
func NewLabNet(s *labsv1.LabSession) LabNet {
	return LabNet{Namespace: s.Namespace, Hash: SessionHash(s)}
}

func (n LabNet) VPC() string          { return "ct-" + n.Hash }
func (n LabNet) LabSubnet() string    { return "ct-" + n.Hash + "-lab" }
func (n LabNet) AccessSubnet() string { return "ct-" + n.Hash + "-access" }
func (n LabNet) NAD() string          { return "ct-" + n.Hash + "-access" }

// Provider is the Kube-OVN provider of the access attachment.
func (n LabNet) Provider() string { return network.ProviderOf(n.NAD(), n.Namespace) }

// Secondary reports network mode secondary.
func (n LabNet) Secondary() bool { return n.Options.Mode == network.ModeSecondary }

// LabNAD is the NAD of the lab subnet (network mode secondary only): the
// Multus default network of the session's VMs.
func (n LabNet) LabNAD() string { return "ct-" + n.Hash + "-lab" }

// LabProvider is the Kube-OVN provider of the lab subnet in mode secondary.
func (n LabNet) LabProvider() string { return network.ProviderOf(n.LabNAD(), n.Namespace) }

// VMNetworkAnnotations are the pod-template annotations that put a VM's
// eth0 on the lab subnet with a fixed IP.
func (n LabNet) VMNetworkAnnotations(ip string) map[string]any {
	prefix := "ovn"
	if n.Secondary() {
		prefix = n.LabProvider()
	}
	return map[string]any{
		prefix + ".kubernetes.io/logical_switch": n.LabSubnet(),
		prefix + ".kubernetes.io/ip_address":     ip,
	}
}

// VMNetworks is the networks stanza of a lab VM: the pod network (Kube-OVN
// primary) or the lab NAD as the Multus default network (secondary). Both
// pair with one bridge-bound interface "default".
func (n LabNet) VMNetworks() []any {
	if n.Secondary() {
		return []any{map[string]any{"name": "default", "multus": map[string]any{
			"networkName": n.Namespace + "/" + n.LabNAD(), "default": true,
		}}}
	}
	return []any{map[string]any{"name": "default", "pod": map[string]any{}}}
}

// SessionLabels are set on every object created for a session.
func SessionLabels(s *labsv1.LabSession) map[string]string {
	l := map[string]string{LabelSession: LabelValue(s.Name), LabelManagedBy: ManagedBy}
	if s.UID != "" {
		l[LabelSessionUID] = string(s.UID)
	}
	return l
}

func ownedBySession(s *labsv1.LabSession, obj client.Object) bool {
	got := obj.GetLabels()
	for k, v := range SessionLabels(s) {
		if got[k] != v {
			return false
		}
	}
	return true
}

// LabNetwork provisions the per-session network. It also implements
// TopologyProvisioner for the drivers that need it.
type LabNetwork struct {
	Client client.Client
	// Reader is an uncached reader (cluster-scoped and unlabelled objects).
	Reader client.Reader
	// Options: network mode and segment MTU.
	Options network.Options
}

// LabNet returns the session's network names in this network's mode.
func (l *LabNetwork) LabNet(s *labsv1.LabSession) LabNet {
	n := NewLabNet(s)
	if l != nil {
		n.Options = l.Options
	}
	return n
}

func (l *LabNetwork) reader() client.Reader {
	if l.Reader != nil {
		return l.Reader
	}
	return l.Client
}

func newObj(gvk schema.GroupVersionKind, ns, name string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(gvk)
	u.SetNamespace(ns)
	u.SetName(name)
	return u
}

// ensure creates obj unless it exists; an existing object must carry the
// session's labels (ErrConflict otherwise).
func ensure(ctx context.Context, c client.Client, r client.Reader, s *labsv1.LabSession, obj client.Object) error {
	existing := obj.DeepCopyObject().(client.Object)
	err := r.Get(ctx, client.ObjectKeyFromObject(obj), existing)
	if err == nil {
		if !ownedBySession(s, existing) {
			return fmt.Errorf("%s %s exists but does not belong to session %s/%s: %w",
				obj.GetObjectKind().GroupVersionKind().Kind, obj.GetName(), s.Namespace, s.Name, ErrConflict)
		}
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return err
	}
	if err := c.Create(ctx, obj); err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}
	return nil
}

// setOwner makes the session the controller owner of a namespaced object.
func setOwner(s *labsv1.LabSession, obj client.Object, c client.Client) error {
	if s.UID == "" {
		return nil
	}
	return controllerutil.SetControllerReference(s, obj, c.Scheme())
}

// Ensure creates the VPC, subnets, NAD and the entry isolation policy.
// ready is true once both subnets report Ready.
func (l *LabNetwork) Ensure(ctx context.Context, s *labsv1.LabSession) (bool, error) {
	n := l.LabNet(s)
	labels := SessionLabels(s)

	vpc := newObj(GVKVpc, "", n.VPC())
	vpc.SetLabels(labels)
	_ = unstructured.SetNestedMap(vpc.Object, map[string]any{}, "spec")

	labSpec := map[string]any{
		"vpc": n.VPC(), "protocol": "IPv4", "cidrBlock": LabCIDR, "gateway": LabGateway,
		"excludeIps": []any{"192.168.100.1..192.168.100.9"},
	}
	if n.Secondary() {
		labSpec["provider"] = n.LabProvider()
	}
	accSpec := map[string]any{
		"vpc": n.VPC(), "protocol": "IPv4", "cidrBlock": AccessCIDR, "gateway": AccessGateway,
		"provider": n.Provider(),
	}
	if mtu := n.Options.MTU; mtu > 0 {
		labSpec["mtu"], accSpec["mtu"] = int64(mtu), int64(mtu)
	}
	lab := newObj(GVKSubnet, "", n.LabSubnet())
	lab.SetLabels(labels)
	_ = unstructured.SetNestedMap(lab.Object, labSpec, "spec")

	acc := newObj(GVKSubnet, "", n.AccessSubnet())
	acc.SetLabels(labels)
	_ = unstructured.SetNestedMap(acc.Object, accSpec, "spec")

	objs := []client.Object{vpc, lab, acc}
	nads := [][2]string{{n.NAD(), n.Provider()}}
	if n.Secondary() {
		nads = append(nads, [2]string{n.LabNAD(), n.LabProvider()})
	}
	for _, d := range nads {
		nad := newObj(GVKNAD, s.Namespace, d[0])
		nad.SetLabels(labels)
		_ = unstructured.SetNestedField(nad.Object, network.NADConfig(d[1]), "spec", "config")
		if err := setOwner(s, nad, l.Client); err != nil {
			return false, err
		}
		objs = append(objs, nad)
	}

	for _, obj := range objs {
		if err := ensure(ctx, l.Client, l.reader(), s, obj); err != nil {
			return false, fmt.Errorf("lab network %s: %w", obj.GetName(), err)
		}
	}
	for _, name := range []string{n.LabSubnet(), n.AccessSubnet()} {
		sub := newObj(GVKSubnet, "", name)
		if err := l.reader().Get(ctx, client.ObjectKeyFromObject(sub), sub); err != nil {
			return false, client.IgnoreNotFound(err)
		}
		if !conditionTrue(sub, "Ready") {
			return false, nil
		}
	}
	return true, nil
}

// Destroy deletes the namespaced objects, then the subnets and the VPC. It
// returns ErrInProgress until they are gone. Callers destroy every VM and
// the entry pod first (they hold IPs in the subnets).
func (l *LabNetwork) Destroy(ctx context.Context, s *labsv1.LabSession) error {
	n := NewLabNet(s)
	pending := false
	for _, obj := range []*unstructured.Unstructured{
		newObj(GVKNAD, s.Namespace, n.NAD()),
		newObj(GVKNAD, s.Namespace, n.LabNAD()), // mode secondary only; absent otherwise
		newObj(GVKSubnet, "", n.AccessSubnet()),
		newObj(GVKSubnet, "", n.LabSubnet()),
		newObj(GVKVpc, "", n.VPC()),
	} {
		gone, err := deleteIfOwned(ctx, l.Client, l.reader(), s, obj)
		if err != nil {
			if meta.IsNoMatchError(err) {
				continue // CRD not installed: nothing was ever created
			}
			return err
		}
		if !gone {
			pending = true
		}
	}
	if pending {
		return inProgress("lab network of session %s/%s is being deleted", s.Namespace, s.Name)
	}
	return nil
}

// deleteIfOwned deletes obj if it exists and belongs to the session.
// gone reports whether it no longer exists.
func deleteIfOwned(ctx context.Context, c client.Client, r client.Reader, s *labsv1.LabSession, obj client.Object) (bool, error) {
	if err := r.Get(ctx, client.ObjectKeyFromObject(obj), obj); err != nil {
		if apierrors.IsNotFound(err) {
			return true, nil
		}
		return false, err
	}
	if !ownedBySession(s, obj) {
		return true, nil // not ours: leave it alone
	}
	if obj.GetDeletionTimestamp() == nil {
		uid := obj.GetUID()
		err := c.Delete(ctx, obj, client.Preconditions{UID: &uid}, client.PropagationPolicy(metav1.DeletePropagationBackground))
		if apierrors.IsNotFound(err) {
			return true, nil
		}
		if err != nil {
			return false, err
		}
	}
	return false, nil
}

func conditionTrue(u *unstructured.Unstructured, typ string) bool {
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	for _, c := range conds {
		m, ok := c.(map[string]any)
		if ok && m["type"] == typ && m["status"] == "True" {
			return true
		}
	}
	return false
}

// MirrorNamespace holds the shared read-only lab mirrors (deploy/mirrors): content
// (dnf/apt/PyPI/Ansible, pod port 8080), registry (5000) and Gitea (3000). Lab pods
// may reach them; the mirrors' own NetworkPolicy admits only pods carrying LabelSession.
const MirrorNamespace = "cloudtrain-mirrors"

// MirrorEgressRule allows egress to the shared mirrors (pod ports).
func MirrorEgressRule() networkingv1.NetworkPolicyEgressRule {
	tcp := corev1.ProtocolTCP
	var ports []networkingv1.NetworkPolicyPort
	for _, p := range []int32{8080, 5000, 3000} {
		port := intstr.FromInt32(p)
		ports = append(ports, networkingv1.NetworkPolicyPort{Protocol: &tcp, Port: &port})
	}
	return networkingv1.NetworkPolicyEgressRule{
		To: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": MirrorNamespace}},
		}},
		Ports: ports,
	}
}

// EntryPolicyName is the NetworkPolicy isolating a session's entry node.
func EntryPolicyName(s *labsv1.LabSession) string { return "ct-" + SessionHash(s) + "-entry" }

// EntryNetworkPolicy isolates the entry pod on the platform network (eth0):
// no ingress; egress only to cluster DNS, the session's own vclusters and the
// lab VPC CIDRs, plus the shared mirrors (MirrorNamespace). Without it the learner shell could reach the host API
// server, the OVN databases, KubeVirt, other labs and the internet.
func EntryNetworkPolicy(s *labsv1.LabSession, entry string, vclusterReleases []string) *networkingv1.NetworkPolicy {
	udp, tcp := corev1.ProtocolUDP, corev1.ProtocolTCP
	dns := intstr.FromInt32(53)
	sel := map[string]string{LabelNode: LabelValue(entry), LabelSession: LabelValue(s.Name)}
	if s.UID != "" {
		sel[LabelSessionUID] = string(s.UID)
	}
	egress := []networkingv1.NetworkPolicyEgressRule{{
		To: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": "kube-system"}},
			PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"k8s-app": "kube-dns"}},
		}},
		Ports: []networkingv1.NetworkPolicyPort{{Protocol: &udp, Port: &dns}, {Protocol: &tcp, Port: &dns}},
	}}
	if len(vclusterReleases) > 0 {
		vcPort := intstr.FromInt32(8443)
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{
			To: []networkingv1.NetworkPolicyPeer{{
				// Each vcluster runs in its own namespace "ct-<release>".
				NamespaceSelector: &metav1.LabelSelector{MatchExpressions: []metav1.LabelSelectorRequirement{{
					Key: "kubernetes.io/metadata.name", Operator: metav1.LabelSelectorOpIn, Values: vclusterNamespaces(vclusterReleases),
				}}},
				PodSelector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"app": "vcluster"},
					MatchExpressions: []metav1.LabelSelectorRequirement{{
						Key: "release", Operator: metav1.LabelSelectorOpIn, Values: vclusterReleases,
					}},
				},
			}},
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &vcPort}},
		})
	}
	egress = append(egress, networkingv1.NetworkPolicyEgressRule{
		To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: AccessCIDR}}, {IPBlock: &networkingv1.IPBlock{CIDR: LabCIDR}}},
	}, MirrorEgressRule())
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: EntryPolicyName(s), Namespace: s.Namespace, Labels: SessionLabels(s)},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: sel},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress},
			Ingress:     []networkingv1.NetworkPolicyIngressRule{},
			Egress:      egress,
		},
	}
}

// AnnotationNetworkPolicyFor limits a NetworkPolicy to some of a pod's
// networks in Kube-OVN (>= 1.15): a comma-separated list of "ovn" (the
// primary interface) and "<namespace>/<net-attach-def>". Without it a
// policy applies to every Kube-OVN interface of the selected pods.
const AnnotationNetworkPolicyFor = "ovn.kubernetes.io/network_policy_for"

// EntryPolicyNetworks is the AnnotationNetworkPolicyFor value of the entry
// policy when the entry node is wired into topology links ("" otherwise:
// the policy then covers the primary interface and the access attachment,
// which are all the entry pod has). Kube-OVN would otherwise apply the
// policy to the link attachments too and drop unicast to the entry node
// over lab links (networking handoff P3). Link segments live in the
// session VPC, which has no route out, so they need no policy; the primary
// interface and the access attachment (when the topology has VM hosts)
// keep it.
//
// In network mode secondary the entry's eth0 belongs to the cluster's CNI,
// which enforces the policy there on its own; Kube-OVN only sees the access
// attachment, and for a wired entry also its eth0 on the management segment
// (a NAD then), so those two are listed instead of "ovn".
func EntryPolicyNetworks(s *labsv1.LabSession, topo *labsv1.Topology, entry string, mode network.Mode) string {
	if topo == nil || entry == "" {
		return ""
	}
	wired := false
	for _, l := range topo.Links {
		if strings.HasPrefix(l.A, entry+":") || strings.HasPrefix(l.B, entry+":") {
			wired = true
		}
	}
	if !wired {
		return ""
	}
	nets := []string{"ovn"}
	if mode == network.ModeSecondary {
		nets = []string{s.Namespace + "/" + network.MgmtSegment(network.SessionOf(s), mode).NAD}
	}
	if NeedsLabNetwork(topo) {
		nets = append(nets, s.Namespace+"/"+NewLabNet(s).NAD())
	}
	return strings.Join(nets, ",")
}

func vclusterNamespaces(releases []string) []string {
	out := make([]string, len(releases))
	for i, r := range releases {
		out[i] = "ct-" + r
	}
	return out
}

// ipInLab reports whether ip is on the lab subnet (sanity check for tests).
func ipInLab(ip string) bool {
	_, n, _ := net.ParseCIDR(LabCIDR)
	return n.Contains(net.ParseIP(ip))
}
