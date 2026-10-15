package network

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/utils/ptr"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Pod wiring.
const (
	// AnnotationNetworks is the Multus network-selection annotation.
	AnnotationNetworks = "k8s.v1.cni.cncf.io/networks"
	// AnnotationLogicalSwitch puts the primary interface on a Kube-OVN subnet.
	AnnotationLogicalSwitch = "ovn.kubernetes.io/logical_switch"
	// Layer2ForwardSuffix, prefixed with an attachment's provider, makes
	// Kube-OVN add "unknown" to the port's addresses (Kube-OVN >= 1.16
	// Layer2ForwardAnnotationTemplate), so the port also receives unicast
	// for MACs that are not its own: Linux bridges, bonds, macvlans and
	// VRRP virtual MACs behind a link end.
	Layer2ForwardSuffix = ".kubernetes.io/layer2_forward"

	// InitContainerName applies addresses, MTU and impairment before the node starts.
	InitContainerName = "net-init"
	// SidecarName is the link sidecar: tcpdump and tc run here, out of the
	// node's own image (which may not ship them).
	SidecarName = "net"
)

// PodOptions configure pod wiring.
type PodOptions struct {
	// ToolsImage is the pullable nettools image (iproute2, tc, tcpdump) used
	// by net-init and the sidecar.
	ToolsImage string
	// Router enables IP forwarding in the pod's network namespace (netdev nodes).
	Router bool
}

// DecoratePod wires node's pod into the session network: the primary
// interface moves to the management segment of the session VPC, every link
// end becomes a Multus attachment with its interface name, net-init
// configures the interfaces, and the link sidecar is added. The node's own
// container (containerName) gets NET_ADMIN and NET_RAW so labs can manage
// addresses and routes. Nodes that are not wired are left untouched.
func (p *Plan) DecoratePod(node string, pod *corev1.Pod, containerName string, o PodOptions) error {
	if !p.IsWired(node) {
		return nil
	}
	if o.ToolsImage == "" {
		return fmt.Errorf("network: no tools image configured")
	}
	if pod.Annotations == nil {
		pod.Annotations = map[string]string{}
	}
	pod.Annotations[AnnotationLogicalSwitch] = p.Mgmt.Subnet
	ends := p.EndsOf(node)
	if len(ends) > 0 {
		var nets []map[string]string
		for _, ne := range ends {
			nets = append(nets, ne.Link.Segment.Attachment(p.Session.Namespace, ne.End.Interface))
			pod.Annotations[ne.Link.Segment.Provider+".kubernetes.io/logical_switch"] = ne.Link.Segment.Subnet
			pod.Annotations[ne.Link.Segment.Provider+Layer2ForwardSuffix] = "true"
		}
		raw, err := json.Marshal(nets)
		if err != nil {
			return err
		}
		pod.Annotations[AnnotationNetworks] = string(raw)
	}

	netCaps := &corev1.SecurityContext{Capabilities: &corev1.Capabilities{Add: []corev1.Capability{"NET_ADMIN", "NET_RAW"}}}
	for i := range pod.Spec.Containers {
		c := &pod.Spec.Containers[i]
		if c.Name != containerName {
			continue
		}
		if c.SecurityContext == nil {
			c.SecurityContext = &corev1.SecurityContext{}
		}
		if c.SecurityContext.Capabilities == nil {
			c.SecurityContext.Capabilities = &corev1.Capabilities{}
		}
		c.SecurityContext.Capabilities.Add = appendCaps(c.SecurityContext.Capabilities.Add, "NET_ADMIN", "NET_RAW")
	}
	small := corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("5m"), corev1.ResourceMemory: resource.MustParse("8Mi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("64Mi")},
	}
	pod.Spec.InitContainers = append(pod.Spec.InitContainers, corev1.Container{
		Name:    InitContainerName,
		Image:   o.ToolsImage,
		Command: []string{"/bin/sh", "-ec", p.InitScript(node, o.Router)},
		// Privileged only to write the netns-scoped sysctls (/proc/sys is
		// read-only otherwise); it exits before the node starts.
		SecurityContext: &corev1.SecurityContext{Privileged: ptr.To(true)},
		Resources:       small,
	})
	pod.Spec.Containers = append(pod.Spec.Containers, corev1.Container{
		Name:            SidecarName,
		Image:           o.ToolsImage,
		Command:         []string{"sleep", "infinity"},
		SecurityContext: netCaps,
		Resources:       small,
	})
	pod.Spec.TerminationGracePeriodSeconds = ptr.To[int64](5)
	return nil
}

func appendCaps(have []corev1.Capability, add ...corev1.Capability) []corev1.Capability {
	for _, a := range add {
		found := false
		for _, h := range have {
			if h == a {
				found = true
			}
		}
		if !found {
			have = append(have, a)
		}
	}
	return have
}

// InitScript is the net-init shell script for node. It runs once per pod
// sandbox (a fresh network namespace), so it may flush freely:
//   - the default route via the management gateway is removed (the VPC has no
//     way out anyway; this keeps lab routing tables clean),
//   - every link interface loses its Kube-OVN carrier address and gets its
//     platform address (if any), MTU and tc netem impairment.
func (p *Plan) InitScript(node string, router bool) string {
	var b strings.Builder
	if router {
		b.WriteString("sysctl -qw net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1\n")
		b.WriteString("sysctl -qw net.ipv4.conf.all.rp_filter=0 net.ipv4.conf.default.rp_filter=0\n")
	}
	fmt.Fprintf(&b, "ip -4 route del default via %s dev eth0 2>/dev/null || true\n", p.Mgmt.Gateway)
	for _, ne := range p.EndsOf(node) {
		for _, line := range EndCommands(ne) {
			b.WriteString(line + "\n")
		}
	}
	b.WriteString("ip -br addr\n")
	return b.String()
}

// EndCommands configures one link end inside its pod's network namespace.
func EndCommands(ne NodeEnd) []string {
	dev := ne.End.Interface
	out := []string{
		fmt.Sprintf("ip -4 addr flush dev %s", dev),
	}
	if im := ne.Link.Impair; im != nil && im.MTU != nil {
		out = append(out, fmt.Sprintf("ip link set dev %s mtu %d", dev, *im.MTU))
	}
	if ne.End.Mode == AddressPlatform {
		out = append(out, fmt.Sprintf("ip addr replace %s dev %s", ne.End.Address, dev))
	}
	out = append(out, fmt.Sprintf("ip link set dev %s up", dev))
	if q := NetemArgs(ne.Link.Impair); q != "" {
		out = append(out, fmt.Sprintf("tc qdisc replace dev %s root netem %s", dev, q))
	}
	return out
}

// NetemArgs renders the netem options of an impairment ("" = none). Each
// end shapes its own egress, so every direction is delayed and dropped
// once: RTT grows by 2 x latencyMs.
func NetemArgs(im *labsv1.LinkImpairment) string {
	if im == nil {
		return ""
	}
	var parts []string
	if im.LatencyMs != nil && *im.LatencyMs > 0 {
		parts = append(parts, "delay "+strconv.Itoa(int(*im.LatencyMs))+"ms")
	}
	if im.LossPct != "" {
		if v, err := strconv.ParseFloat(im.LossPct, 64); err == nil && v > 0 {
			parts = append(parts, "loss "+im.LossPct+"%")
		}
	}
	return strings.Join(parts, " ")
}
