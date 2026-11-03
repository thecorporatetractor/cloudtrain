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
	// IngressRateSuffix and EgressRateSuffix, prefixed with an attachment's
	// provider, rate-limit that port in Mbit/s (Kube-OVN QoS: an HTB queue
	// towards the pod and OVS ingress policing from it, both on the host
	// side of the veth, so the learner cannot lift them).
	IngressRateSuffix = ".kubernetes.io/ingress_rate"
	EgressRateSuffix  = ".kubernetes.io/egress_rate"

	// InitContainerName applies addresses, MTU and impairment before the node starts.
	InitContainerName = "net-init"
	// SidecarName is the link sidecar: tcpdump and tc run here, out of the
	// node's own image (which may not ship them).
	SidecarName = "net"
)

// Wired pods carry LabelPodProfile so the lab pod admission policy
// (config/rbac/pod_admission_policy.yaml) can tell the platform's own
// containers apart: it lets exactly these capability sets through, and only
// on pods the manager's ServiceAccount creates.
const (
	LabelPodProfile = "labs.cloudtrain.dev/pod-profile"
	// PodProfileWired: a node pod with lab links (net-init, the sidecar,
	// the node container with NET_ADMIN and NET_RAW).
	PodProfileWired = "wired"
	// PodProfileNetdev: a network device pod (FRR), wired as above; its
	// node container also holds SYS_ADMIN (drivers.FRR.Capabilities).
	PodProfileNetdev = "netdev"
)

// Capabilities of the containers of a wired pod. The admission policy
// allows the same sets; keep both in step (TestPodPolicyMatchesBuilder).
var (
	// NodeCapabilities are added to the node container: labs manage
	// addresses, routes, qdiscs and bridges (NET_ADMIN), ping, traceroute
	// and raw-socket tools need NET_RAW.
	NodeCapabilities = []corev1.Capability{"NET_ADMIN", "NET_RAW"}
	// InitCapabilities are all net-init holds: ip and tc speak netlink in
	// the pod's network namespace; with a user namespace, NET_ADMIN over
	// that namespace also opens its network sysctls.
	InitCapabilities = []corev1.Capability{"NET_ADMIN"}
	// SidecarCapabilities: tcpdump opens packet sockets (NET_RAW) and sets
	// promiscuous mode, tc changes impairments (NET_ADMIN).
	SidecarCapabilities = []corev1.Capability{"NET_ADMIN", "NET_RAW"}
)

// platformSecurityContext is the security context of net-init and the
// sidecar: every capability dropped but add, no privilege escalation, a
// read-only root filesystem and the runtime's default seccomp profile.
// unmasked unmasks /proc (user namespaces only), so network sysctls are
// writable.
func platformSecurityContext(add []corev1.Capability, unmasked bool) *corev1.SecurityContext {
	sc := &corev1.SecurityContext{
		Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}, Add: append([]corev1.Capability(nil), add...)},
		AllowPrivilegeEscalation: ptr.To(false),
		ReadOnlyRootFilesystem:   ptr.To(true),
		SeccompProfile:           &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
	}
	if unmasked {
		sc.ProcMount = ptr.To(corev1.UnmaskedProcMount)
	}
	return sc
}

// RouterSysctls are the network sysctls of a router's network namespace,
// in CNI tuning plugin form (IFNAME = the attachment's interface). Each link
// attachment of a router applies them when user namespaces are unavailable
// (Options.RouterTuning); InitScript writes the same values itself in a
// user namespace. Interfaces attached later copy the default values.
func RouterSysctls() map[string]string {
	m := map[string]string{
		"net.ipv4.ip_forward":          "1",
		"net.ipv6.conf.all.forwarding": "1",
		// See InitScript: rp_filter off, connected routes of interfaces
		// without carrier ignored, ARP answered only for the receiving
		// interface's addresses.
		"net.ipv4.conf.all.arp_ignore":     "1",
		"net.ipv4.conf.default.arp_ignore": "1",
	}
	for _, dev := range []string{"all", "default", "eth0", "IFNAME"} {
		m["net.ipv4.conf."+dev+".rp_filter"] = "0"
		m["net.ipv4.conf."+dev+".ignore_routes_with_linkdown"] = "1"
		m["net.ipv6.conf."+dev+".ignore_routes_with_linkdown"] = "1"
	}
	return m
}

// PodOptions configure pod wiring.
type PodOptions struct {
	// ToolsImage is the pullable nettools image (iproute2, tc, tcpdump) used
	// by net-init and the sidecar.
	ToolsImage string
	// Router enables IP forwarding in the pod's network namespace (netdev nodes).
	Router bool
	// UserNamespace runs the wired pod in a user namespace (hostUsers:
	// false) with an unmasked /proc in net-init and the node container, so
	// the pod's network sysctls (ip_forward, rp_filter, accept_ra,
	// proxy_arp, ...) are writable by root in the node (networking handoff
	// P4). Host-wide sysctls stay read-only: the user namespace does not
	// own them. Without it /proc/sys is read-only in every container of
	// the pod, and routers take their sysctls from the CNI tuning plugin
	// (Options.RouterTuning).
	UserNamespace bool
	// LinkRateMbps caps every link attachment at this rate in each
	// direction (0 = no limit). A bridging loop on lab links (broadcast
	// storm labs) otherwise floods OVS and OVN as fast as the CPU allows;
	// capped, each port re-injects at most this much, and a frame dropped
	// at the cap leaves the loop for good.
	LinkRateMbps int
}

// DecoratePod wires node's pod into the session network: the primary
// interface moves to the management segment of the session VPC (ModePrimary:
// the Kube-OVN logical_switch annotation; ModeSecondary: the segment's NAD
// as the Multus default network), every link
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
	if p.Options.Mode == ModeSecondary {
		pod.Annotations[AnnotationDefaultNetwork] = p.Session.Namespace + "/" + p.Mgmt.NAD
		pod.Annotations[p.Mgmt.Provider+".kubernetes.io/logical_switch"] = p.Mgmt.Subnet
	} else {
		pod.Annotations[AnnotationLogicalSwitch] = p.Mgmt.Subnet
	}
	ends := p.EndsOf(node)
	if len(ends) > 0 {
		var nets []map[string]any
		for _, ne := range ends {
			att := map[string]any{}
			for k, v := range ne.Link.Segment.Attachment(p.Session.Namespace, ne.End.Interface) {
				att[k] = v
			}
			if o.Router && !o.UserNamespace && p.Options.RouterTuning {
				// Multus passes cni-args to every plugin of the NAD's
				// chain; tuning applies them in the pod's network namespace.
				att["cni-args"] = map[string]any{"sysctl": RouterSysctls()}
			}
			nets = append(nets, att)
			pod.Annotations[ne.Link.Segment.Provider+".kubernetes.io/logical_switch"] = ne.Link.Segment.Subnet
			pod.Annotations[ne.Link.Segment.Provider+Layer2ForwardSuffix] = "true"
			if o.LinkRateMbps > 0 {
				rate := strconv.Itoa(o.LinkRateMbps)
				pod.Annotations[ne.Link.Segment.Provider+IngressRateSuffix] = rate
				pod.Annotations[ne.Link.Segment.Provider+EgressRateSuffix] = rate
			}
		}
		raw, err := json.Marshal(nets)
		if err != nil {
			return err
		}
		pod.Annotations[AnnotationNetworks] = string(raw)
	}

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
		c.SecurityContext.Capabilities.Add = appendCaps(c.SecurityContext.Capabilities.Add, NodeCapabilities...)
	}
	small := corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("5m"), corev1.ResourceMemory: resource.MustParse("8Mi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("64Mi")},
	}
	// Neither platform container is privileged (docs/deploy.md, "Wired lab
	// pods"). net-init only needs NET_ADMIN: addresses, links, routes and
	// tc qdiscs are netlink operations on the pod's own network namespace.
	// Network sysctls are the one thing it cannot do in a plain container,
	// because the runtime mounts /proc/sys read-only:
	//   - with a user namespace (--link-sysctls, the default where the
	//     cluster supports it) /proc is unmasked and the sysctls of the
	//     pod's network namespace, which the user namespace owns, are
	//     writable with that NET_ADMIN;
	//   - without one, hosts only need the safe sysctl ping_group_range,
	//     which the pod sets itself, and routers get theirs from the CNI
	//     tuning plugin chained into their link attachments (Options.
	//     RouterTuning, RouterSysctls); net-init checks they arrived.
	if o.Router && !o.UserNamespace && !p.Options.RouterTuning {
		return fmt.Errorf("network: router node %s without a user namespace needs the CNI tuning plugin (network.Options.RouterTuning)", node)
	}
	if !o.UserNamespace {
		setPodSysctl(pod, "net.ipv4.ping_group_range", "0 65535")
	}
	if o.UserNamespace {
		pod.Spec.HostUsers = ptr.To(false)
		for i := range pod.Spec.Containers {
			if c := &pod.Spec.Containers[i]; c.Name == containerName {
				c.SecurityContext.ProcMount = ptr.To(corev1.UnmaskedProcMount)
			}
		}
	}
	if pod.Labels == nil {
		pod.Labels = map[string]string{}
	}
	if pod.Labels[LabelPodProfile] == "" {
		pod.Labels[LabelPodProfile] = PodProfileWired
	}
	pod.Spec.InitContainers = append(pod.Spec.InitContainers, corev1.Container{
		Name:            InitContainerName,
		Image:           o.ToolsImage,
		Command:         []string{"/bin/sh", "-ec", p.InitScript(node, o.Router)},
		SecurityContext: platformSecurityContext(InitCapabilities, o.UserNamespace),
		Resources:       small,
	})
	pod.Spec.Containers = append(pod.Spec.Containers, corev1.Container{
		Name:            SidecarName,
		Image:           o.ToolsImage,
		Command:         []string{"sleep", "infinity"},
		SecurityContext: platformSecurityContext(SidecarCapabilities, false),
		Resources:       small,
	})
	pod.Spec.TerminationGracePeriodSeconds = ptr.To[int64](5)
	return nil
}

// setPodSysctl sets a (safe, namespaced) sysctl on the pod.
func setPodSysctl(pod *corev1.Pod, name, value string) {
	if pod.Spec.SecurityContext == nil {
		pod.Spec.SecurityContext = &corev1.PodSecurityContext{}
	}
	for i, sc := range pod.Spec.SecurityContext.Sysctls {
		if sc.Name == name {
			pod.Spec.SecurityContext.Sysctls[i].Value = value
			return
		}
	}
	pod.Spec.SecurityContext.Sysctls = append(pod.Spec.SecurityContext.Sysctls, corev1.Sysctl{Name: name, Value: value})
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
//   - unprivileged ICMP echo (ping_group_range) is allowed,
//   - the default route via the management gateway is removed (the VPC has no
//     way out anyway; this keeps lab routing tables clean),
//   - every link interface loses its Kube-OVN carrier address and gets its
//     platform address (if any), MTU and tc netem impairment.
func (p *Plan) InitScript(node string, router bool) string {
	var b strings.Builder
	if router && p.Options.RouterTuning {
		// No user namespace: /proc/sys is read-only here and the CNI
		// tuning plugin set RouterSysctls on each link attachment. Fail
		// fast if it did not (a node without the plugin fails the CNI ADD
		// instead; an older Multus may drop cni-args).
		if len(p.EndsOf(node)) > 0 {
			b.WriteString("if [ \"$(cat /proc/sys/net/ipv4/ip_forward)\" != 1 ]; then echo 'net-init: IP forwarding is off: without user namespaces a router gets its sysctls from the CNI tuning plugin on its link attachments (Multus cni-args); install the reference CNI plugins on every node' >&2; exit 1; fi\n")
		}
	} else if router {
		b.WriteString("sysctl -qw net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1\n")
		// The kernel uses max(all, <dev>) for rp_filter, and interfaces
		// that exist already (eth0 and the Multus link ends, attached before
		// net-init runs) copied the host's default when they were created
		// (Ubuntu hosts: 2, loose). A loose check still drops a packet
		// whose source has no route at all, which is how a router without a
		// route back (regional-gw learning no inside prefixes) must still
		// forward, so turn it off on every interface, not only all/default.
		b.WriteString("sysctl -qw net.ipv4.conf.all.rp_filter=0 net.ipv4.conf.default.rp_filter=0\n")
		b.WriteString("for f in /proc/sys/net/ipv4/conf/*/rp_filter; do echo 0 > \"$f\"; done\n")
		// A router does not use the connected route of an interface without
		// carrier; Linux does unless ignore_routes_with_linkdown is set (per
		// device, new devices copy default). Without it a VRRP backup, whose
		// protodown macvlan still holds the virtual subnet, sends replies
		// arriving over an ECMP return path into that dead interface (the
		// neighbour stays FAILED) and the LAN loses them.
		b.WriteString("sysctl -qw net.ipv4.conf.all.ignore_routes_with_linkdown=1 net.ipv4.conf.default.ignore_routes_with_linkdown=1\n")
		b.WriteString("sysctl -qw net.ipv6.conf.all.ignore_routes_with_linkdown=1 net.ipv6.conf.default.ignore_routes_with_linkdown=1 || true\n")
		b.WriteString("for f in /proc/sys/net/ipv4/conf/*/ignore_routes_with_linkdown /proc/sys/net/ipv6/conf/*/ignore_routes_with_linkdown; do echo 1 > \"$f\" 2>/dev/null || true; done\n")
		// A router answers ARP only for addresses of the receiving
		// interface; Linux answers for any local address (arp_ignore uses
		// max(all, <dev>)). Otherwise a router holding a VRRP virtual
		// address on a protodown macvlan, VRRP not even configured, answers
		// for it on its LAN port and takes over as gateway.
		b.WriteString("sysctl -qw net.ipv4.conf.all.arp_ignore=1 net.ipv4.conf.default.arp_ignore=1\n")
	}
	// Unprivileged ICMP sockets, so the learner (no NET_RAW: no_new_privs
	// ignores ping's file capabilities) can ping across lab links. 0-65535
	// is the gid range a pod user namespace maps.
	b.WriteString("sysctl -qw net.ipv4.ping_group_range='0 65535' || true\n")
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
