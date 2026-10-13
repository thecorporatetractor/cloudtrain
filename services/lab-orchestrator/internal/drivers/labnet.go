package drivers

// Per-session lab network for VM-backed nodes (kubeadm cluster members and
// vm nodes), ported from deploy/scripts/lab-demo.sh:
//
//	Kube-OVN VPC ct-<hash>          (no route to the platform pod network or the internet)
//	 ├─ subnet ct-<hash>-lab     192.168.100.0/24  VM hosts .10, .11, ... in topology order
//	 └─ subnet ct-<hash>-access  192.168.99.0/24   entry node .5 (Multus NAD, provider ct-<hash>-access.<ns>.ovn)
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
}

// NewLabNet returns the network names of a session.
func NewLabNet(s *labsv1.LabSession) LabNet { return LabNet{Namespace: s.Namespace, Hash: SessionHash(s)} }

func (n LabNet) VPC() string          { return "ct-" + n.Hash }
func (n LabNet) LabSubnet() string    { return "ct-" + n.Hash + "-lab" }
func (n LabNet) AccessSubnet() string { return "ct-" + n.Hash + "-access" }
func (n LabNet) NAD() string          { return "ct-" + n.Hash + "-access" }

// Provider is the Kube-OVN provider of the access attachment.
func (n LabNet) Provider() string { return n.NAD() + "." + n.Namespace + ".ovn" }

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
	n := NewLabNet(s)
	labels := SessionLabels(s)

	vpc := newObj(GVKVpc, "", n.VPC())
	vpc.SetLabels(labels)
	_ = unstructured.SetNestedMap(vpc.Object, map[string]any{}, "spec")

	lab := newObj(GVKSubnet, "", n.LabSubnet())
	lab.SetLabels(labels)
	_ = unstructured.SetNestedMap(lab.Object, map[string]any{
		"vpc": n.VPC(), "protocol": "IPv4", "cidrBlock": LabCIDR, "gateway": LabGateway,
		"excludeIps": []any{"192.168.100.1..192.168.100.9"},
	}, "spec")

	acc := newObj(GVKSubnet, "", n.AccessSubnet())
	acc.SetLabels(labels)
	_ = unstructured.SetNestedMap(acc.Object, map[string]any{
		"vpc": n.VPC(), "protocol": "IPv4", "cidrBlock": AccessCIDR, "gateway": AccessGateway,
		"provider": n.Provider(),
	}, "spec")

	nad := newObj(GVKNAD, s.Namespace, n.NAD())
	nad.SetLabels(labels)
	_ = unstructured.SetNestedField(nad.Object,
		fmt.Sprintf(`{"cniVersion":"0.3.1","type":"kube-ovn","server_socket":"/run/openvswitch/kube-ovn-daemon.sock","provider":%q}`, n.Provider()),
		"spec", "config")
	if err := setOwner(s, nad, l.Client); err != nil {
		return false, err
	}

	for _, obj := range []client.Object{vpc, lab, acc, nad} {
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

// EntryPolicyName is the NetworkPolicy isolating a session's entry node.
func EntryPolicyName(s *labsv1.LabSession) string { return "ct-" + SessionHash(s) + "-entry" }

// EntryNetworkPolicy isolates the entry pod on the platform network (eth0):
// no ingress; egress only to cluster DNS, the session's own vclusters and the
// lab VPC CIDRs. Without it the learner shell could reach the host API
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
			To: []networkingv1.NetworkPolicyPeer{{PodSelector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "vcluster"},
				MatchExpressions: []metav1.LabelSelectorRequirement{{
					Key: "release", Operator: metav1.LabelSelectorOpIn, Values: vclusterReleases,
				}},
			}}},
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &vcPort}},
		})
	}
	egress = append(egress, networkingv1.NetworkPolicyEgressRule{
		To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: AccessCIDR}}, {IPBlock: &networkingv1.IPBlock{CIDR: LabCIDR}}},
	})
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

// ipInLab reports whether ip is on the lab subnet (sanity check for tests).
func ipInLab(ip string) bool {
	_, n, _ := net.ParseCIDR(LabCIDR)
	return n.Contains(net.ParseIP(ip))
}

