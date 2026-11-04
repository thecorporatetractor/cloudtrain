package drivers

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/gate"
)

// Isolation of virtual clusters (security review escape-3, network-1,
// network-2). The learner is cluster-admin inside the vcluster, so what
// their pods and Services may do on the host is decided here, on the host:
//
//   - Synced pods run in the tier V sandbox RuntimeClass when one is
//     configured (sync.toHost.pods.runtimeClassName). A configured but
//     unavailable sandbox holds the install back; it never installs without.
//   - The host namespace gets a ResourceQuota (pods, CPU, memory, storage,
//     and zero LoadBalancer and NodePort Services, so a learner cannot get a
//     public IP or a node port from inside the vcluster) and a LimitRange
//     (defaults for containers without resources, and a per-container cap).
//   - The control plane pod (the virtual API server, which the learner can
//     make dial out through webhooks, APIServices and services/proxy) gets a
//     NetworkPolicy: ingress only from the session's own pods and its synced
//     pods on 8443; egress only to DNS, its own synced pods and the host API
//     server.
//
//   - Services with externalIPs, LoadBalancer or NodePort, and Ingresses, are
//     refused in ct-vc-* namespaces by the lab-vcluster-host admission policy
//     (config/rbac/vcluster_host_policy.yaml): vcluster copies a Service's type
//     and externalIPs to the host. On Kubernetes 1.36+ the
//     lab-vcluster-host-services MutatingAdmissionPolicy
//     (config/rbac/vcluster_host_services_mutation.yaml) first turns such a
//     host copy into a plain ClusterIP Service, so learners can still create
//     NodePort and LoadBalancer Services inside their vcluster.
//
// Root inside synced pods is not refused: most Kubernetes labs run stock
// images (nginx, busybox) as root. The host namespace enforces Pod Security
// (--vcluster-pod-security, baseline by default, restricted available), and
// the sandbox RuntimeClass keeps root inside a VM. Their seccomp profile is
// not set by anyone here (baseline allows an unset profile): the lab nodes'
// kubelet seccompDefault (kind: deploy/kind/cluster.yaml; AKS: the lab pool's
// kubelet config) makes it RuntimeDefault. Under the production profile a
// vcluster is refused without a tier V sandbox or known API server addresses.

// VClusterQuota is the per-vcluster host namespace budget.
type VClusterQuota struct {
	Pods, CPU, Memory, Storage, PVCs string
	// EphemeralRequests and EphemeralLimits cap scratch disk (container
	// writable layers, emptyDirs, logs) of all pods together.
	EphemeralRequests, EphemeralLimits string
}

// DefaultVClusterQuota fits the Kubernetes labs (a few Deployments, a
// StatefulSet, a Job) with room for mistakes, but not a learner scaling to
// hundreds of replicas.
var DefaultVClusterQuota = VClusterQuota{Pods: "40", CPU: "4", Memory: "8Gi", Storage: "10Gi", PVCs: "10",
	EphemeralRequests: "4Gi", EphemeralLimits: "40Gi"}

// VClusterPodRuntimeClass is the RuntimeClass synced pods run in: the tier V
// sandbox when configured. A configured sandbox that is unavailable is an
// error (the install waits; it never falls back to the host runtime).
func (d *VClusterDriver) VClusterPodRuntimeClass(ctx context.Context) (string, error) {
	production := d.Container != nil && d.Container.RequireIsolation
	var cfg SandboxTier
	ok := false
	if d.Container != nil && d.Container.Sandboxes.Enabled() {
		cfg, ok = d.Container.Sandboxes.Tiers[SandboxTierVCluster]
	}
	if !ok {
		if production {
			return "", fmt.Errorf("the production isolation profile runs virtual cluster pods only in the tier %s sandbox, and none is configured: %w", SandboxTierVCluster, ErrUnsupported)
		}
		return "", nil
	}
	st := d.Container.Sandboxes.States(ctx)[SandboxTierVCluster]
	if !st.Available {
		return "", fmt.Errorf("virtual cluster pods run in the tier %s sandbox %s, which is unavailable: %s", SandboxTierVCluster, cfg.RuntimeClass, st.Reason)
	}
	return cfg.RuntimeClass, nil
}

func (d *VClusterDriver) quotaName(release string) string      { return release + "-quota" }
func (d *VClusterDriver) limitRangeName(release string) string { return release + "-limits" }
func (d *VClusterDriver) controlPlanePolicyName(release string) string {
	return release + "-control-plane"
}

// resourceQuota is the host namespace's budget (see DefaultVClusterQuota).
func (d *VClusterDriver) resourceQuota(ref NodeRef, release string) *corev1.ResourceQuota {
	q := d.Quota
	if q == (VClusterQuota{}) {
		q = DefaultVClusterQuota
	}
	return &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{Name: d.quotaName(release), Namespace: d.hostNS(ref), Labels: SessionLabels(ref.Session)},
		Spec: corev1.ResourceQuotaSpec{Hard: corev1.ResourceList{
			corev1.ResourcePods:                     resource.MustParse(q.Pods),
			corev1.ResourceRequestsCPU:              resource.MustParse(q.CPU),
			corev1.ResourceRequestsMemory:           resource.MustParse(q.Memory),
			corev1.ResourceLimitsMemory:             resource.MustParse(q.Memory),
			corev1.ResourceRequestsStorage:          resource.MustParse(q.Storage),
			corev1.ResourcePersistentVolumeClaims:   resource.MustParse(q.PVCs),
			corev1.ResourceRequestsEphemeralStorage: resource.MustParse(q.EphemeralRequests),
			corev1.ResourceLimitsEphemeralStorage:   resource.MustParse(q.EphemeralLimits),
			// No public IP and no node port from inside a vcluster: the
			// syncer cannot create such a Service on the host.
			corev1.ResourceServicesLoadBalancers: resource.MustParse("0"),
			corev1.ResourceServicesNodePorts:     resource.MustParse("0"),
		}},
	}
}

// limitRange gives containers without resources defaults (so the quota can
// count them) and caps a single container's memory. CPU gets a default
// request only: CPU is compressible and capped by requests.cpu in the quota,
// and a max CPU would reject every container without a CPU limit (the
// vcluster control plane among them).
// Per-container maximums of the vcluster host namespace's LimitRange. The
// control plane's own limits (vclusterControlPlaneResources) must stay within
// them, or its StatefulSet pod is refused: the vcluster chart's default
// syncer limit (10Gi ephemeral storage) is above the max.
var (
	vclusterContainerMaxMemory    = resource.MustParse("2Gi")
	vclusterContainerMaxEphemeral = resource.MustParse("4Gi")
)

// vclusterControlPlaneResources are the syncer's requests and limits (Helm
// values controlPlane.statefulSet.resources), set explicitly so the chart
// defaults never exceed the LimitRange.
var vclusterControlPlaneResources = map[string]any{
	"limits":   map[string]any{"memory": "1Gi", "ephemeral-storage": "2Gi"},
	"requests": map[string]any{"cpu": "100m", "memory": "256Mi", "ephemeral-storage": "512Mi"},
}

func (d *VClusterDriver) limitRange(ref NodeRef, release string) *corev1.LimitRange {
	return &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{Name: d.limitRangeName(release), Namespace: d.hostNS(ref), Labels: SessionLabels(ref.Session)},
		Spec: corev1.LimitRangeSpec{Limits: []corev1.LimitRangeItem{{
			Type: corev1.LimitTypeContainer,
			DefaultRequest: corev1.ResourceList{
				corev1.ResourceCPU: resource.MustParse("50m"), corev1.ResourceMemory: resource.MustParse("64Mi"),
				corev1.ResourceEphemeralStorage: resource.MustParse("64Mi"),
			},
			Default: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("512Mi"), corev1.ResourceEphemeralStorage: resource.MustParse("1Gi")},
			Max:     corev1.ResourceList{corev1.ResourceMemory: vclusterContainerMaxMemory, corev1.ResourceEphemeralStorage: vclusterContainerMaxEphemeral},
		}}},
	}
}

// privateRanges are never an API server fallback target: cluster, node and
// VNet ranges, link-local (IMDS 169.254.169.254) and the Azure wireserver.
var privateRanges = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "168.63.129.16/32"}

// controlPlanePolicy limits the virtual API server pod. Ingress: the
// session's own pods (the entry node and its admin sidecar, other lab nodes
// using the kubeconfig) and the vcluster's synced pods, on 8443. Egress: DNS,
// the synced pods, and the host API server (APIServer; when unknown, ports
// 443/6443 on public addresses only, never cluster, VNet, IMDS or the
// wireserver).
func (d *VClusterDriver) controlPlanePolicy(ref NodeRef, release string) *networkingv1.NetworkPolicy {
	udp, tcp := corev1.ProtocolUDP, corev1.ProtocolTCP
	dns, api := intstr.FromInt32(53), intstr.FromInt32(8443)
	synced := networkingv1.NetworkPolicyPeer{PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{LabelVClusterManagedBy: release}}}
	sessionPods := networkingv1.NetworkPolicyPeer{
		NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": ref.Session.Namespace}},
		PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{LabelSession: LabelValue(ref.Session.Name)}},
	}
	apiRule := networkingv1.NetworkPolicyEgressRule{}
	if len(d.APIServer.CIDRs) > 0 {
		for _, c := range d.APIServer.CIDRs {
			apiRule.To = append(apiRule.To, networkingv1.NetworkPolicyPeer{IPBlock: &networkingv1.IPBlock{CIDR: c}})
		}
		for _, p := range d.APIServer.Ports {
			port := intstr.FromInt32(p)
			apiRule.Ports = append(apiRule.Ports, networkingv1.NetworkPolicyPort{Protocol: &tcp, Port: &port})
		}
	} else {
		p443, p6443 := intstr.FromInt32(443), intstr.FromInt32(6443)
		apiRule.To = []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0", Except: privateRanges}}}
		apiRule.Ports = []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &p443}, {Protocol: &tcp, Port: &p6443}}
	}
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: d.controlPlanePolicyName(release), Namespace: d.hostNS(ref), Labels: SessionLabels(ref.Session)},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{"app": "vcluster", "release": release}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress},
			Ingress: []networkingv1.NetworkPolicyIngressRule{{
				From:  []networkingv1.NetworkPolicyPeer{sessionPods, synced},
				Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &api}},
			}},
			Egress: []networkingv1.NetworkPolicyEgressRule{
				{
					To: []networkingv1.NetworkPolicyPeer{{
						NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": "kube-system"}},
						PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"k8s-app": "kube-dns"}},
					}},
					Ports: []networkingv1.NetworkPolicyPort{{Protocol: &udp, Port: &dns}, {Protocol: &tcp, Port: &dns}},
				},
				{To: []networkingv1.NetworkPolicyPeer{synced}},
				apiRule,
			},
		},
	}
}

// APIServerEndpoints are the host API server's addresses as pods reach them
// after Service translation (the default/kubernetes Endpoints).
type APIServerEndpoints struct {
	CIDRs []string
	Ports []int32
}

// ParseAPIServerCIDRs parses --apiserver-cidrs ("ip[/bits][:port],...";
// port default 443).
func ParseAPIServerCIDRs(s string) (APIServerEndpoints, error) {
	var out APIServerEndpoints
	ports := map[int32]bool{}
	for _, part := range SplitList(s) {
		host, port := part, "443"
		if h, p, err := net.SplitHostPort(part); err == nil {
			host, port = h, p
		}
		pn, err := strconv.ParseInt(port, 10, 32)
		if err != nil || pn < 1 || pn > 65535 {
			return out, fmt.Errorf("apiserver cidr %q: bad port", part)
		}
		cidr, err := hostCIDR(host)
		if err != nil {
			return out, fmt.Errorf("apiserver cidr %q: %w", part, err)
		}
		out.CIDRs = append(out.CIDRs, cidr)
		ports[int32(pn)] = true
	}
	for p := range ports {
		out.Ports = append(out.Ports, p)
	}
	sort.Slice(out.Ports, func(i, j int) bool { return out.Ports[i] < out.Ports[j] })
	return out, nil
}

func hostCIDR(host string) (string, error) {
	if _, n, err := net.ParseCIDR(host); err == nil {
		return n.String(), nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return "", fmt.Errorf("not an IP or CIDR")
	}
	if ip.To4() != nil {
		return ip.String() + "/32", nil
	}
	return ip.String() + "/128", nil
}

// DetectAPIServerEndpoints reads the default/kubernetes Endpoints (the
// manager's Role in the default namespace allows exactly that).
func DetectAPIServerEndpoints(ctx context.Context, r client.Reader) (APIServerEndpoints, error) {
	ep := &corev1.Endpoints{} //nolint:staticcheck // the kubernetes Service's Endpoints are maintained by the API server itself
	if err := r.Get(ctx, client.ObjectKey{Namespace: "default", Name: "kubernetes"}, ep); err != nil {
		return APIServerEndpoints{}, err
	}
	var out APIServerEndpoints
	ports := map[int32]bool{}
	for _, ss := range ep.Subsets { //nolint:staticcheck // see above
		for _, a := range ss.Addresses {
			if c, err := hostCIDR(a.IP); err == nil {
				out.CIDRs = append(out.CIDRs, c)
			}
		}
		for _, p := range ss.Ports {
			ports[p.Port] = true
		}
	}
	for p := range ports {
		out.Ports = append(out.Ports, p)
	}
	sort.Strings(out.CIDRs)
	sort.Slice(out.Ports, func(i, j int) bool { return out.Ports[i] < out.Ports[j] })
	if len(out.CIDRs) == 0 || len(out.Ports) == 0 {
		return APIServerEndpoints{}, fmt.Errorf("default/kubernetes Endpoints have no addresses")
	}
	return out, nil
}

// ensureHostIsolation creates the quota, limit range and control plane
// policy in the vcluster's host namespace.
func (d *VClusterDriver) ensureHostIsolation(ctx context.Context, ref NodeRef, release string) error {
	if len(d.APIServer.CIDRs) == 0 && d.Container != nil && d.Container.RequireIsolation {
		// The fallback (any public address on 443/6443) would let the virtual
		// API server reach the internet: not under the production profile.
		return fmt.Errorf("the production isolation profile needs the API server's addresses for the vcluster control plane policy (--apiserver-cidrs, or the default/kubernetes Endpoints): %w", ErrUnsupported)
	}
	if err := gate.Err(ctx); err != nil {
		return err
	}
	for _, obj := range []client.Object{d.resourceQuota(ref, release), d.limitRange(ref, release), d.controlPlanePolicy(ref, release)} {
		if err := ensure(ctx, d.Client, d.reader(), ref.Session, obj); err != nil {
			return err
		}
	}
	return nil
}

// CheckPodCIDRs checks the pod CIDRs vcluster endpoints may point into
// (--vcluster-pod-cidrs, Helm orchestrator.vclusterPodCIDRs) against the
// nodes: no node address may fall inside them. Where pods take addresses
// from the node subnet (Azure CNI node-subnet mode, AWS VPC CNI), the
// allowlist would admit node and VNet addresses, so only overlay pod
// networks (Azure CNI overlay, Cilium/Calico overlay) are supported.
func CheckPodCIDRs(nodes []corev1.Node, cidrs []string) error {
	var nets []*net.IPNet
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			return fmt.Errorf("vcluster pod CIDR %q: %w", c, err)
		}
		nets = append(nets, n)
	}
	for _, node := range nodes {
		for _, a := range node.Status.Addresses {
			if a.Type != corev1.NodeInternalIP && a.Type != corev1.NodeExternalIP {
				continue
			}
			ip := net.ParseIP(a.Address)
			for _, n := range nets {
				if ip != nil && n.Contains(ip) {
					return fmt.Errorf("node %s address %s is inside the vcluster pod CIDR %s: pods share the node subnet (e.g. Azure CNI node-subnet mode), so the endpoints allowlist would admit node and VNet addresses; use an overlay pod network (Azure CNI overlay)", node.Name, a.Address, n)
				}
			}
		}
	}
	return nil
}
