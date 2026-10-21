package network

import "fmt"

// Mode says how lab-facing interfaces reach the session network
// (docs/any-kubernetes.md, section 2).
type Mode string

const (
	// ModePrimary: Kube-OVN is the cluster's primary CNI. The eth0 of wired
	// lab pods and lab VMs is put on a session subnet with the
	// ovn.kubernetes.io/logical_switch annotation (vCenter, bare metal, kind).
	ModePrimary Mode = "primary"
	// ModeSecondary: another CNI owns eth0 of ordinary pods (AKS, EKS, GKE)
	// and Kube-OVN runs in non-primary mode behind Multus. Wired lab pods
	// and lab VMs take a session segment as their Multus default network
	// (v1.multus-cni.io/default-network, KubeVirt multus.default), so their
	// eth0 still lives in the isolated session VPC. Also works where
	// Kube-OVN is primary.
	ModeSecondary Mode = "secondary"
)

// DefaultLinkMTU is the MTU of every session segment: lab content relies on
// 1400-byte lab links (net-fix-mtu-blackhole, ctr-net-mtu-hang, ...). It
// needs an underlay MTU of at least 1500 (geneve takes 100).
const DefaultLinkMTU = 1400

// ParseMode parses a --network-mode value ("" = primary).
func ParseMode(s string) (Mode, error) {
	switch Mode(s) {
	case "", ModePrimary:
		return ModePrimary, nil
	case ModeSecondary:
		return ModeSecondary, nil
	}
	return "", fmt.Errorf("network mode %q: want primary or secondary", s)
}

// Options are the cluster-wide settings of session networks.
type Options struct {
	Mode Mode
	// MTU of every session segment (Kube-OVN Subnet spec.mtu); 0 leaves it
	// to Kube-OVN (node MTU minus the tunnel overhead).
	MTU int
	// RouterTuning chains the CNI tuning plugin (containernetworking/plugins,
	// meta/tuning) behind kube-ovn in the NAD of every link that touches a
	// netdev node, and routers pass RouterSysctls to it as Multus cni-args.
	// Set it when wired pods run without a user namespace: routers need
	// IP forwarding and rp_filter changes in their network namespace, and
	// without a user namespace /proc/sys is read-only in every unprivileged
	// container. Every node then needs the tuning binary in its CNI bin
	// directory.
	RouterTuning bool
}

// AnnotationDefaultNetwork is the Multus annotation that replaces a pod's
// cluster default network (eth0) with a NetworkAttachmentDefinition
// ("<namespace>/<name>").
const AnnotationDefaultNetwork = "v1.multus-cni.io/default-network"

// ProviderOf is the Kube-OVN provider of a kube-ovn NAD: "<nad>.<namespace>.ovn".
func ProviderOf(nad, namespace string) string { return nad + "." + namespace + ".ovn" }

// NADConfig is the CNI config of a NetworkAttachmentDefinition served by
// Kube-OVN for provider.
func NADConfig(provider string) string {
	return fmt.Sprintf(`{"cniVersion":"0.3.1","type":"kube-ovn","server_socket":"/run/openvswitch/kube-ovn-daemon.sock","provider":%q}`, provider)
}

// NADConfigTuning is NADConfig with the CNI tuning plugin chained behind
// kube-ovn (Options.RouterTuning). Without cni-args tuning changes nothing,
// so the hosts on such a link are wired as before. The empty sysctl map is
// required: tuning (v1.9.1) merges args.cni.sysctl into it and panics on a
// nil map.
func NADConfigTuning(provider string) string {
	return fmt.Sprintf(`{"cniVersion":"0.3.1","name":%q,"plugins":[%s,{"type":"tuning","sysctl":{}}]}`, provider, NADConfig(provider))
}
