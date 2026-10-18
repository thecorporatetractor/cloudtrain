package main

// labctl preflight: can this cluster run CloudTrain labs? (docs/any-kubernetes.md,
// section 5, "cloudtrain preflight"). This file implements the network section:
//
//   - Multus and the NetworkAttachmentDefinition API,
//   - Kube-OVN: CRDs, components, version (>= 1.16 for layer2_forward) and its
//     mode (primary or non-primary), checked against the orchestrator's
//     --network-mode,
//   - the primary CNI and a NetworkPolicy engine for the cloud network,
//   - Kube-OVN's CNI config priority in non-primary mode (Multus must keep the
//     primary CNI as the cluster network),
//   - overlaps of node, pod and service CIDRs with the lab ranges,
//   - with --probe: a throwaway session network built by the orchestrator's own
//     code (internal/network) with two wired pods on two nodes: MTU of the
//     segments, 1400-byte frames with DF on a lab link and on eth0 (the session
//     management segment: the Multus default network in secondary mode),
//     isolation from the API service, and the kernel modules on those nodes.
//
// Every check reports PASS, WARN or FAIL with a fix; any FAIL exits 1. Other
// sections (KVM, storage, Pod Security, registry) are added next to it.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

// Check outcomes.
const (
	pfPass = "PASS"
	pfWarn = "WARN"
	pfFail = "FAIL"
)

// pfCheck is one preflight result.
type pfCheck struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Fix     string `json:"fix,omitempty"`
}

type pfReport struct {
	Section string    `json:"section"`
	Mode    string    `json:"networkMode"`
	Checks  []pfCheck `json:"checks"`
}

func (r *pfReport) add(name, status, msg, fix string) {
	r.Checks = append(r.Checks, pfCheck{Name: "network/" + name, Status: status, Message: msg, Fix: fix})
}

func (r *pfReport) failed() bool {
	for _, c := range r.Checks {
		if c.Status == pfFail {
			return true
		}
	}
	return false
}

// platformModules are the node modules the lab network itself needs.
var platformModules = []string{"openvswitch", "geneve", "vhost_net", "tun"}

type preflightOpts struct {
	mode        string // auto, primary, secondary
	probe       bool
	toolsImage  string
	modulesFile string
	mtu         int
	timeout     time.Duration
}

func cmdPreflight(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("preflight", flag.ContinueOnError)
	fl.SetOutput(stderr)
	kubeconfig := fl.String("kubeconfig", "", "kubeconfig file (default: $KUBECONFIG or ~/.kube/config)")
	kctx := fl.String("context", "", "kubeconfig context (default: current)")
	mode := fl.String("network-mode", "auto", "the orchestrator's --network-mode to check against: auto (from Kube-OVN's mode), primary or secondary")
	probe := fl.Bool("probe", false, "build a throwaway session network with two wired pods (MTU, 1400-byte frames, isolation, kernel modules); needs the tools image on the nodes")
	toolsImage := fl.String("tools-image", "cloudtrain/nettools:1", "image of the probe pods (iproute2, ping); the orchestrator's net-tools image")
	repoRoot := fl.String("repo-root", "", "repository root, for deploy/scripts/lab-kernel-modules.txt (default: found from the working directory)")
	mtu := fl.Int("lab-mtu", network.DefaultLinkMTU, "the orchestrator's --lab-mtu (the segment MTU the probe sets and expects)")
	timeout := fl.Duration("timeout", 5*time.Minute, "probe timeout")
	asJSON := fl.Bool("json", false, "print the report as JSON")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	if *mode != "auto" {
		if _, err := network.ParseMode(*mode); err != nil || *mode == "" {
			fmt.Fprintln(stderr, "--network-mode must be auto, primary or secondary")
			return 2
		}
	}
	root := *repoRoot
	if root == "" {
		root = findRepoRoot()
	}
	cfg, err := restConfig(*kubeconfig, *kctx)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	o := preflightOpts{mode: *mode, probe: *probe, toolsImage: *toolsImage, mtu: *mtu, timeout: *timeout,
		modulesFile: filepath.Join(root, "deploy", "scripts", "lab-kernel-modules.txt")}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout+2*time.Minute)
	defer cancel()
	rep, err := runNetworkPreflight(ctx, cfg, o, stderr)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(rep)
	} else {
		printPreflight(stdout, rep)
	}
	if rep.failed() {
		return 1
	}
	return 0
}

func printPreflight(w io.Writer, rep *pfReport) {
	fmt.Fprintf(w, "preflight %s (network mode %s)\n", rep.Section, rep.Mode)
	for _, c := range rep.Checks {
		fmt.Fprintf(w, "%-4s  %-28s %s\n", c.Status, c.Name, c.Message)
		if c.Fix != "" && c.Status != pfPass {
			fmt.Fprintf(w, "      %-28s fix: %s\n", "", c.Fix)
		}
	}
}

// pfCluster is what the static checks read from the cluster.
type pfCluster struct {
	DaemonSets  []appsv1.DaemonSet
	Deployments []appsv1.Deployment
	Nodes       []corev1.Node
	// ServiceCIDRs (networking.k8s.io/v1 ServiceCIDR), empty when not served.
	ServiceCIDRs []string
	// Resources maps "group/version" to the served resource names.
	Resources map[string][]string
	// Subnets are Kube-OVN subnets that are not session segments (name -> CIDR).
	Subnets map[string]string
}

func (c *pfCluster) served(gv, resource string) bool {
	for _, r := range c.Resources[gv] {
		if r == resource {
			return true
		}
	}
	return false
}

func runNetworkPreflight(ctx context.Context, cfg *rest.Config, o preflightOpts, logOut io.Writer) (*pfReport, error) {
	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		return nil, err
	}
	if err := labsv1.AddToScheme(scheme); err != nil {
		return nil, err
	}
	c, err := client.New(cfg, client.Options{Scheme: scheme})
	if err != nil {
		return nil, err
	}
	disc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		return nil, err
	}
	cl, err := readCluster(ctx, c, disc)
	if err != nil {
		return nil, err
	}
	rep := &pfReport{Section: "network"}
	mode := evaluateNetwork(cl, o.mode, rep)
	rep.Mode = string(mode)
	if o.probe {
		ex, err := drivers.NewRESTPodExecutor(cfg)
		if err != nil {
			return nil, err
		}
		p := &netProbe{c: c, ex: ex, o: o, mode: mode, log: logOut}
		p.run(ctx, cl, rep)
	} else {
		rep.add("probe", pfWarn, "not run: MTU, 1400-byte frames, isolation and kernel modules unchecked", "re-run with --probe")
	}
	return rep, nil
}

func readCluster(ctx context.Context, c client.Client, disc discovery.DiscoveryInterface) (*pfCluster, error) {
	cl := &pfCluster{Resources: map[string][]string{}, Subnets: map[string]string{}}
	ds := &appsv1.DaemonSetList{}
	if err := c.List(ctx, ds); err != nil {
		return nil, fmt.Errorf("list daemonsets: %w", err)
	}
	cl.DaemonSets = ds.Items
	deps := &appsv1.DeploymentList{}
	if err := c.List(ctx, deps); err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}
	cl.Deployments = deps.Items
	nodes := &corev1.NodeList{}
	if err := c.List(ctx, nodes); err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	cl.Nodes = nodes.Items
	for _, gv := range []string{"k8s.cni.cncf.io/v1", "kubeovn.io/v1", "kubevirt.io/v1", "networking.k8s.io/v1"} {
		rl, err := disc.ServerResourcesForGroupVersion(gv)
		if err != nil {
			continue // not served
		}
		for _, r := range rl.APIResources {
			cl.Resources[gv] = append(cl.Resources[gv], r.Name)
		}
	}
	if cl.served("networking.k8s.io/v1", "servicecidrs") {
		sc := &networkingv1.ServiceCIDRList{}
		if err := c.List(ctx, sc); err == nil {
			for _, s := range sc.Items {
				cl.ServiceCIDRs = append(cl.ServiceCIDRs, s.Spec.CIDRs...)
			}
		}
	}
	if cl.served("kubeovn.io/v1", "subnets") {
		list := &unstructured.UnstructuredList{}
		list.SetGroupVersionKind(network.SubnetGVK.GroupVersion().WithKind("SubnetList"))
		if err := c.List(ctx, list); err == nil {
			for _, s := range list.Items {
				// Session segments reuse the lab ranges on purpose (VPC isolation).
				if s.GetLabels()[network.LabelManagedBy] == network.ManagedBy {
					continue
				}
				if vpc, _, _ := unstructured.NestedString(s.Object, "spec", "vpc"); vpc != "" && vpc != "ovn-cluster" {
					continue // another isolated VPC
				}
				if cidr, _, _ := unstructured.NestedString(s.Object, "spec", "cidrBlock"); cidr != "" {
					cl.Subnets[s.GetName()] = strings.Split(cidr, ",")[0]
				}
			}
		}
	}
	return cl, nil
}

// evaluateNetwork runs the static checks and returns the network mode the
// orchestrator should use (or the one requested).
func evaluateNetwork(cl *pfCluster, requested string, rep *pfReport) network.Mode {
	// Multus.
	multus := findDaemonSet(cl.DaemonSets, func(d appsv1.DaemonSet) bool {
		return strings.Contains(d.Name, "multus") || d.Labels["app"] == "multus"
	})
	switch {
	case multus == nil:
		rep.add("multus", pfFail, "no Multus DaemonSet found", "install Multus thick (deploy/multus) or the provider's Multus")
	case !dsReady(multus):
		rep.add("multus", pfFail, fmt.Sprintf("%s/%s ready %d/%d", multus.Namespace, multus.Name, multus.Status.NumberReady, multus.Status.DesiredNumberScheduled), "check the Multus pods")
	default:
		rep.add("multus", pfPass, fmt.Sprintf("%s/%s ready %d/%d", multus.Namespace, multus.Name, multus.Status.NumberReady, multus.Status.DesiredNumberScheduled), "")
	}
	if cl.served("k8s.cni.cncf.io/v1", "network-attachment-definitions") {
		rep.add("nad-api", pfPass, "k8s.cni.cncf.io/v1 network-attachment-definitions served", "")
	} else {
		rep.add("nad-api", pfFail, "NetworkAttachmentDefinition CRD not served", "install Multus (it ships the CRD)")
	}

	// Kube-OVN.
	ovnMode, version, ovnErr := kubeOVNMode(cl)
	if ovnErr != nil {
		rep.add("kube-ovn", pfFail, ovnErr.Error(), "install Kube-OVN (primary on vCenter/bare metal, non-primary behind Multus elsewhere: deploy/kube-ovn/values-secondary.yaml)")
	} else {
		msg := fmt.Sprintf("kube-ovn-controller %s, %s CNI", version, map[network.Mode]string{network.ModePrimary: "primary", network.ModeSecondary: "non-primary"}[ovnMode])
		if !versionAtLeast(version, 1, 16) {
			rep.add("kube-ovn", pfWarn, msg+"; layer2_forward (bridges, bonds, VRRP behind link ends) needs >= v1.16", "upgrade Kube-OVN to v1.16 or later")
		} else {
			rep.add("kube-ovn", pfPass, msg, "")
		}
		for _, name := range []string{"ovs-ovn", "kube-ovn-cni"} {
			d := findDaemonSet(cl.DaemonSets, func(d appsv1.DaemonSet) bool { return d.Name == name })
			switch {
			case d == nil:
				rep.add(name, pfFail, "DaemonSet not found", "check the Kube-OVN install")
			case !dsReady(d):
				rep.add(name, pfFail, fmt.Sprintf("ready %d/%d", d.Status.NumberReady, d.Status.DesiredNumberScheduled), "check the Kube-OVN pods on the lab nodes")
			default:
				rep.add(name, pfPass, fmt.Sprintf("ready %d/%d", d.Status.NumberReady, d.Status.DesiredNumberScheduled), "")
			}
		}
		for _, r := range []string{"vpcs", "subnets"} {
			if !cl.served("kubeovn.io/v1", r) {
				rep.add("kube-ovn-api", pfFail, "kubeovn.io/v1 "+r+" not served", "check the Kube-OVN CRDs")
			}
		}
	}

	// Mode the orchestrator must run in.
	mode := network.ModePrimary
	if ovnErr == nil && ovnMode == network.ModeSecondary {
		mode = network.ModeSecondary
	}
	switch requested {
	case "auto":
		rep.add("mode", pfPass, fmt.Sprintf("deploy the orchestrator with --network-mode=%s", mode), "")
	case string(network.ModePrimary):
		if ovnErr == nil && ovnMode == network.ModeSecondary {
			rep.add("mode", pfFail, "--network-mode=primary, but Kube-OVN is not the primary CNI: wired pods and VMs would get no session network", "use --network-mode=secondary")
		} else {
			rep.add("mode", pfPass, "--network-mode=primary matches Kube-OVN as the primary CNI", "")
		}
		mode = network.ModePrimary
	case string(network.ModeSecondary):
		if ovnErr == nil && ovnMode == network.ModePrimary {
			rep.add("mode", pfWarn, "--network-mode=secondary with Kube-OVN as the primary CNI is not verified (docs/any-kubernetes.md, section 8)", "use --network-mode=primary on this cluster")
		} else {
			rep.add("mode", pfPass, "--network-mode=secondary matches Kube-OVN in non-primary mode", "")
		}
		mode = network.ModeSecondary
	}

	// The primary CNI and its policy engine (secondary mode: the cloud's CNI
	// owns eth0 of the entry node and the lab peers, and enforces their policies).
	if mode == network.ModeSecondary {
		cni, policy := primaryCNI(cl.DaemonSets)
		switch {
		case cni == "":
			rep.add("primary-cni", pfWarn, "no known primary CNI found (Cilium, Calico, AWS VPC CNI, Azure CNI, GKE Dataplane V2, Flannel, kindnet)", "make sure a NetworkPolicy engine enforces policies on eth0")
		case !policy:
			rep.add("primary-cni", pfWarn, cni+": NetworkPolicy may not be enforced (entry and lab peer isolation depend on it)", "enable network policy (EKS: VPC CNI enableNetworkPolicy; or install Calico/Cilium policy)")
		default:
			rep.add("primary-cni", pfPass, cni+" (enforces NetworkPolicy)", "")
		}
		if prio, ok := kubeOVNCNIPriority(cl.DaemonSets); ok && prio < 10 {
			rep.add("cni-priority", pfFail, fmt.Sprintf("Kube-OVN writes %02d-kube-ovn.conflist: Multus (multusConfigFile auto) may take Kube-OVN as the cluster network", prio),
				"set cni_conf.CNI_CONFIG_PRIORITY to sort after the primary CNI's config (deploy/kube-ovn/values-secondary.yaml uses 90)")
		} else if ok {
			rep.add("cni-priority", pfPass, fmt.Sprintf("Kube-OVN conflist priority %02d", prio), "")
		}
	}

	// CIDR overlaps with the lab ranges.
	rep.Checks = append(rep.Checks, cidrOverlapChecks(cl)...)
	return mode
}

var nonPrimaryArg = regexp.MustCompile(`--non-primary-cni-mode=(\S+)`)

// kubeOVNMode reads the mode and version of kube-ovn-controller.
func kubeOVNMode(cl *pfCluster) (network.Mode, string, error) {
	for _, d := range cl.Deployments {
		if d.Name != "kube-ovn-controller" {
			continue
		}
		mode := network.ModePrimary
		version := "unknown"
		for _, ctr := range d.Spec.Template.Spec.Containers {
			if i := strings.LastIndex(ctr.Image, ":"); i > 0 && version == "unknown" {
				version = strings.SplitN(ctr.Image[i+1:], "@", 2)[0]
			}
			for _, a := range append(append([]string{}, ctr.Command...), ctr.Args...) {
				if m := nonPrimaryArg.FindStringSubmatch(a); m != nil && m[1] == "true" {
					mode = network.ModeSecondary
				}
			}
		}
		if d.Status.AvailableReplicas == 0 {
			return mode, version, fmt.Errorf("%s/kube-ovn-controller has no available replica", d.Namespace)
		}
		return mode, version, nil
	}
	return "", "", errors.New("kube-ovn-controller Deployment not found")
}

var semverRe = regexp.MustCompile(`^v?(\d+)\.(\d+)`)

func versionAtLeast(v string, major, minor int) bool {
	m := semverRe.FindStringSubmatch(v)
	if m == nil {
		return false
	}
	ma, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	return ma > major || (ma == major && mi >= minor)
}

var cniNameArg = regexp.MustCompile(`--cni-conf-name=(\d+)-`)

// kubeOVNCNIPriority is the numeric prefix of Kube-OVN's conflist.
func kubeOVNCNIPriority(dss []appsv1.DaemonSet) (int, bool) {
	d := findDaemonSet(dss, func(d appsv1.DaemonSet) bool { return d.Name == "kube-ovn-cni" })
	if d == nil {
		return 0, false
	}
	for _, ctr := range append(append([]corev1.Container{}, d.Spec.Template.Spec.InitContainers...), d.Spec.Template.Spec.Containers...) {
		for _, a := range append(append([]string{}, ctr.Command...), ctr.Args...) {
			if m := cniNameArg.FindStringSubmatch(a); m != nil {
				n, _ := strconv.Atoi(m[1])
				return n, true
			}
		}
	}
	return 0, false
}

// primaryCNI recognises the cluster's primary CNI by its DaemonSet and
// whether it enforces NetworkPolicy out of the box.
func primaryCNI(dss []appsv1.DaemonSet) (string, bool) {
	known := []struct {
		name, ds string
		policy   bool
	}{
		{"Cilium", "cilium", true},
		{"GKE Dataplane V2", "anetd", true},
		{"Calico", "calico-node", true},
		{"Azure NPM", "azure-npm", true},
		{"AWS VPC CNI", "aws-node", false},
		{"Azure CNI", "azure-cns", false},
		{"Flannel", "kube-flannel-ds", false},
		{"kindnet", "kindnet", true},
	}
	found, policy := []string{}, false
	for _, k := range known {
		if findDaemonSet(dss, func(d appsv1.DaemonSet) bool { return d.Name == k.ds }) != nil {
			found = append(found, k.name)
			policy = policy || k.policy
		}
	}
	return strings.Join(found, " + "), policy
}

func findDaemonSet(dss []appsv1.DaemonSet, match func(appsv1.DaemonSet) bool) *appsv1.DaemonSet {
	for i := range dss {
		if match(dss[i]) {
			return &dss[i]
		}
	}
	return nil
}

func dsReady(d *appsv1.DaemonSet) bool {
	return d.Status.DesiredNumberScheduled > 0 && d.Status.NumberReady == d.Status.DesiredNumberScheduled
}

// labRanges are the address ranges every session reuses.
var labRanges = []struct {
	name string
	pfx  netip.Prefix
}{
	{"lab subnet", netip.MustParsePrefix(drivers.LabCIDR)},
	{"access subnet", netip.MustParsePrefix(drivers.AccessCIDR)},
	{"link carriers / management", network.Reserved},
}

// cidrOverlapChecks compares node IPs, node pod CIDRs, service CIDRs and the
// cluster's own Kube-OVN subnets with the lab ranges. The entry node routes
// the lab ranges over its access attachment, so an overlap makes those
// cluster addresses unreachable from it (or breaks the lab).
func cidrOverlapChecks(cl *pfCluster) []pfCheck {
	type src struct{ what, cidr string }
	var srcs []src
	for _, n := range cl.Nodes {
		for _, a := range n.Status.Addresses {
			if a.Type == corev1.NodeInternalIP || a.Type == corev1.NodeExternalIP {
				srcs = append(srcs, src{"node " + n.Name, a.Address})
			}
		}
		for _, c := range n.Spec.PodCIDRs {
			srcs = append(srcs, src{"pod CIDR of " + n.Name, c})
		}
	}
	for _, c := range cl.ServiceCIDRs {
		srcs = append(srcs, src{"service CIDR", c})
	}
	names := make([]string, 0, len(cl.Subnets))
	for n := range cl.Subnets {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		srcs = append(srcs, src{"Kube-OVN subnet " + n, cl.Subnets[n]})
	}
	var bad []string
	checked := 0
	for _, s := range srcs {
		pfx, err := netip.ParsePrefix(s.cidr)
		if err != nil {
			a, aerr := netip.ParseAddr(s.cidr)
			if aerr != nil || !a.Is4() {
				continue
			}
			pfx = netip.PrefixFrom(a, 32)
		}
		if !pfx.Addr().Is4() {
			continue
		}
		checked++
		for _, r := range labRanges {
			if pfx.Overlaps(r.pfx) {
				bad = append(bad, fmt.Sprintf("%s %s overlaps the %s %s", s.what, pfx, r.name, r.pfx))
			}
		}
	}
	if len(bad) > 0 {
		return []pfCheck{{Name: "network/cidr-overlap", Status: pfFail, Message: strings.Join(bad, "; "),
			Fix: "move the node/pod/service ranges off 192.168.99.0/24, 192.168.100.0/24 and 198.18.0.0/15 (lab content names these addresses)"}}
	}
	msg := fmt.Sprintf("%d node, pod, service and Kube-OVN ranges clear of 192.168.99.0/24, 192.168.100.0/24, 198.18.0.0/15", checked)
	if len(cl.ServiceCIDRs) == 0 {
		return []pfCheck{{Name: "network/cidr-overlap", Status: pfWarn, Message: msg + "; service CIDR unknown (no ServiceCIDR API)", Fix: "check the service CIDR by hand"}}
	}
	return []pfCheck{{Name: "network/cidr-overlap", Status: pfPass, Message: msg}}
}

// netProbe builds a throwaway session network with the orchestrator's code.
type netProbe struct {
	c    client.Client
	ex   drivers.PodExecutor
	o    preflightOpts
	mode network.Mode
	log  io.Writer
}

// probeTopology: two hosts joined by one link with a platform subnet
// (TEST-NET-1, outside every reserved range).
func probeTopology() *labsv1.Topology {
	return &labsv1.Topology{
		Nodes: []labsv1.Node{{Name: "a", Driver: labsv1.DriverContainer}, {Name: "b", Driver: labsv1.DriverContainer}},
		Links: []labsv1.Link{{A: "a:eth1", B: "b:eth1", Subnet: "192.0.2.0/30"}},
	}
}

// probeNodes picks two Ready, schedulable nodes (one if that is all there is).
func probeNodes(nodes []corev1.Node) []string {
	var out []string
	for _, n := range nodes {
		if n.Spec.Unschedulable {
			continue
		}
		ready, tainted := false, false
		for _, c := range n.Status.Conditions {
			if c.Type == corev1.NodeReady && c.Status == corev1.ConditionTrue {
				ready = true
			}
		}
		for _, t := range n.Spec.Taints {
			if t.Effect == corev1.TaintEffectNoSchedule || t.Effect == corev1.TaintEffectNoExecute {
				tainted = true
			}
		}
		if ready && !tainted {
			out = append(out, n.Name)
		}
	}
	sort.Strings(out)
	if len(out) > 2 {
		out = out[:2]
	}
	return out
}

func (p *netProbe) logf(format string, args ...any) {
	if p.log != nil {
		fmt.Fprintf(p.log, "preflight: "+format+"\n", args...)
	}
}

func (p *netProbe) run(ctx context.Context, cl *pfCluster, rep *pfReport) {
	nodes := probeNodes(cl.Nodes)
	if len(nodes) == 0 {
		rep.add("probe", pfFail, "no Ready schedulable node for the probe pods", "")
		return
	}
	ns := "ct-preflight-" + randSuffix()
	sess := network.Session{Namespace: ns, Name: "preflight", UID: types.UID("preflight-" + randSuffix())}
	plan, err := network.BuildWith(sess, probeTopology(), network.Options{Mode: p.mode, MTU: p.o.mtu})
	if err != nil {
		rep.add("probe", pfFail, err.Error(), "")
		return
	}
	mgr := &network.Manager{Client: p.c}
	defer p.cleanup(ns, sess, mgr)
	nsObj := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns, Labels: sessionNamespaceLabels(map[string]string{"labs.cloudtrain.dev/preflight": "true"})}}
	if err := p.c.Create(ctx, nsObj); err != nil {
		rep.add("probe", pfFail, "create namespace: "+err.Error(), "")
		return
	}
	pctx, cancel := context.WithTimeout(ctx, p.o.timeout)
	defer cancel()
	p.logf("session network in %s (%s mode, nodes %v)", ns, p.mode, nodes)
	if err := waitFor(pctx, 2*time.Second, func() (bool, error) { return mgr.Ensure(pctx, plan) }); err != nil {
		rep.add("probe-segments", pfFail, "session VPC/subnets not Ready: "+err.Error(), "check kube-ovn-controller logs")
		return
	}
	rep.add("probe-segments", pfPass, fmt.Sprintf("VPC, management and link segments Ready (%d NADs)", len(plan.Links)+map[bool]int{true: 1}[plan.Mgmt.NAD != ""]), "")
	pods := map[string]*corev1.Pod{}
	for i, name := range []string{"a", "b"} {
		pod := p.probePod(ns, sess, name, nodes[i%len(nodes)])
		if err := plan.DecoratePod(name, pod, "node", network.PodOptions{ToolsImage: p.o.toolsImage}); err != nil {
			rep.add("probe-pods", pfFail, err.Error(), "")
			return
		}
		if err := p.c.Create(pctx, pod); err != nil {
			rep.add("probe-pods", pfFail, "create pod: "+err.Error(), "")
			return
		}
		pods[name] = pod
	}
	for name, pod := range pods {
		err := waitFor(pctx, 2*time.Second, func() (bool, error) {
			if err := p.c.Get(pctx, client.ObjectKeyFromObject(pod), pod); err != nil {
				return false, err
			}
			if pod.Status.Phase == corev1.PodFailed {
				return false, fmt.Errorf("pod %s failed", name)
			}
			return pod.Status.Phase == corev1.PodRunning && pod.Status.PodIP != "", nil
		})
		if err != nil {
			rep.add("probe-pods", pfFail, fmt.Sprintf("pod %s not running: %v (%s)", name, err, podEvents(pctx, p.c, pod)), "check Multus and kube-ovn-cni logs on "+pod.Spec.NodeName)
			return
		}
	}
	a, b := pods["a"], pods["b"]
	cross := a.Spec.NodeName != b.Spec.NodeName
	where := fmt.Sprintf("%s -> %s", a.Spec.NodeName, b.Spec.NodeName)
	rep.add("probe-pods", pfPass, fmt.Sprintf("wired pods running (%s), eth0 %s / %s", where, a.Status.PodIP, b.Status.PodIP), "")
	if !cross {
		rep.add("probe-cross-node", pfWarn, "one schedulable node: cross-node L2 (geneve) unchecked", "run on a cluster with two lab nodes")
	}

	// Segment MTU.
	if p.o.mtu > 0 {
		out, err := p.exec(pctx, a, "cat /sys/class/net/eth0/mtu /sys/class/net/eth1/mtu")
		got := strings.Fields(out)
		want := strconv.Itoa(p.o.mtu)
		if err != nil || len(got) != 2 || got[0] != want || got[1] != want {
			rep.add("probe-mtu", pfFail, fmt.Sprintf("eth0/eth1 MTU = %v, want %s (%v)", got, want, err), "Kube-OVN Subnet spec.mtu not applied: check the Kube-OVN version")
		} else {
			rep.add("probe-mtu", pfPass, fmt.Sprintf("eth0 and link eth1 MTU %s", want), "")
		}
	}
	size := p.o.mtu
	if size == 0 {
		size = network.DefaultLinkMTU
	}
	payload := strconv.Itoa(size - 28)
	linkB := plan.Links[0].Ends[1].Address.Addr().String()
	if _, err := p.exec(pctx, a, "ping -c 3 -W 2 -M do -s "+payload+" "+linkB); err != nil {
		rep.add("probe-link", pfFail, fmt.Sprintf("%d-byte frames with DF over the lab link (%s) fail: %v", size, where, err), "underlay MTU must be >= link MTU + 100 (geneve); open UDP 6081 between lab nodes")
	} else {
		rep.add("probe-link", pfPass, fmt.Sprintf("%d-byte frames with DF over a lab link (%s)", size, where), "")
	}
	eth0 := "management segment (Kube-OVN primary)"
	if p.mode == network.ModeSecondary {
		eth0 = "management segment as the Multus default network"
	}
	if _, err := p.exec(pctx, a, "ping -c 3 -W 2 -M do -s "+payload+" "+b.Status.PodIP); err != nil {
		rep.add("probe-eth0", pfFail, fmt.Sprintf("eth0 on the %s: %d-byte frames fail: %v", eth0, size, err), "check Multus default-network support and kube-ovn-cni logs")
	} else {
		rep.add("probe-eth0", pfPass, fmt.Sprintf("eth0 on the %s: %d-byte frames with DF (%s)", eth0, size, where), "")
	}
	// Isolation: a wired pod must not reach the API service.
	api := &corev1.Service{}
	if err := p.c.Get(pctx, client.ObjectKey{Namespace: "default", Name: "kubernetes"}, api); err == nil && api.Spec.ClusterIP != "" {
		if _, err := p.exec(pctx, a, "nc -z -w 3 "+api.Spec.ClusterIP+" 443"); err == nil {
			rep.add("probe-isolation", pfFail, "a wired pod reaches the API service "+api.Spec.ClusterIP+":443", "the session VPC must have no route out")
		} else {
			rep.add("probe-isolation", pfPass, "wired pod cannot reach the API service "+api.Spec.ClusterIP+":443", "")
		}
	}
	// Kernel modules on the probe nodes.
	mods := append([]string{}, platformModules...)
	if lab, err := readModules(p.o.modulesFile); err == nil {
		mods = append(mods, lab...)
	} else {
		rep.add("modules", pfWarn, "lab module list not read ("+err.Error()+"): platform modules only", "pass --repo-root")
	}
	seen := map[string]bool{}
	for _, pod := range []*corev1.Pod{a, b} {
		if seen[pod.Spec.NodeName] {
			continue
		}
		seen[pod.Spec.NodeName] = true
		out, err := p.exec(pctx, pod, moduleScript(mods))
		if err != nil {
			rep.add("modules", pfWarn, pod.Spec.NodeName+": module check failed: "+err.Error(), "")
			continue
		}
		rep.Checks = append(rep.Checks, moduleCheck(pod.Spec.NodeName, out))
	}
}

func (p *netProbe) probePod(ns string, sess network.Session, name, node string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: map[string]string{
			network.LabelSessionUID: string(sess.UID), network.LabelManagedBy: network.ManagedBy,
		}},
		Spec: corev1.PodSpec{
			NodeName:                     node,
			AutomountServiceAccountToken: ptr.To(false),
			RestartPolicy:                corev1.RestartPolicyNever,
			Containers: []corev1.Container{{
				Name: "node", Image: p.o.toolsImage, ImagePullPolicy: corev1.PullIfNotPresent,
				Command:      []string{"sleep", "infinity"},
				VolumeMounts: []corev1.VolumeMount{{Name: "modules", MountPath: "/host/lib/modules", ReadOnly: true}},
			}},
			Volumes: []corev1.Volume{{Name: "modules", VolumeSource: corev1.VolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/lib/modules"}}}},
		},
	}
}

func (p *netProbe) exec(ctx context.Context, pod *corev1.Pod, script string) (string, error) {
	var out, errOut bytes.Buffer
	err := p.ex.Exec(ctx, pod.Namespace, pod.Name, "node", []string{"sh", "-c", script}, nil, &out, &errOut)
	if err != nil {
		return out.String(), fmt.Errorf("%w: %s", err, strings.TrimSpace(tail(out.String()+errOut.String(), 200)))
	}
	return out.String(), nil
}

func (p *netProbe) cleanup(ns string, sess network.Session, mgr *network.Manager) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	_ = p.c.DeleteAllOf(ctx, &corev1.Pod{}, client.InNamespace(ns), client.GracePeriodSeconds(0))
	err := waitFor(ctx, 2*time.Second, func() (bool, error) { return mgr.Delete(ctx, sess) })
	if err != nil {
		p.logf("cleanup of the session network in %s: %v", ns, err)
	}
	if err := p.c.Delete(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns}}); err != nil && !apierrors.IsNotFound(err) {
		p.logf("delete namespace %s: %v", ns, err)
	}
}

func waitFor(ctx context.Context, every time.Duration, cond func() (bool, error)) error {
	var last error
	for {
		ok, err := cond()
		if ok && err == nil {
			return nil
		}
		if err != nil {
			last = err
		}
		select {
		case <-ctx.Done():
			if last != nil {
				return fmt.Errorf("%w (last error: %v)", ctx.Err(), last)
			}
			return ctx.Err()
		case <-time.After(every):
		}
	}
}

func podEvents(ctx context.Context, c client.Client, pod *corev1.Pod) string {
	evs := &corev1.EventList{}
	if err := c.List(ctx, evs, client.InNamespace(pod.Namespace)); err != nil {
		return ""
	}
	var msgs []string
	for _, e := range evs.Items {
		if e.InvolvedObject.Name == pod.Name && e.Type == corev1.EventTypeWarning {
			msgs = append(msgs, e.Reason+": "+firstLine(e.Message))
		}
	}
	return strings.Join(msgs, "; ")
}

func readModules(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if i := strings.Index(line, "#"); i >= 0 {
			line = strings.TrimSpace(line[:i])
		}
		out = append(out, strings.Fields(line)...)
	}
	return out, sc.Err()
}

// moduleScript prints "<module> loaded|builtin|loadable|missing" per module.
// /proc/modules and /sys/module are the node kernel's; /host/lib/modules is
// the node's module tree (hostPath, read-only).
func moduleScript(mods []string) string {
	return `k=$(uname -r); d=/host/lib/modules/$k
for m in ` + strings.Join(mods, " ") + `; do
  n=$(echo "$m" | tr - _)
  if grep -q "^$n " /proc/modules; then s=loaded
  elif grep -qE "/$m\.ko" "$d/modules.builtin" 2>/dev/null || [ -d "/sys/module/$n" ]; then s=builtin
  elif grep -qE "/$m\.ko(\.[a-z]+)?:" "$d/modules.dep" 2>/dev/null; then s=loadable
  else s=missing; fi
  echo "$m $s"
done`
}

// moduleCheck turns moduleScript output into a check: platform modules must
// be loaded or built in; lab modules not loaded are a warning (lab pods
// cannot load them; /etc/modules-load.d or a module DaemonSet must).
func moduleCheck(node, out string) pfCheck {
	platform := map[string]bool{}
	for _, m := range platformModules {
		platform[m] = true
	}
	var fail, notLoaded, missing []string
	total := 0
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Fields(line)
		if len(f) != 2 {
			continue
		}
		total++
		switch f[1] {
		case "loaded", "builtin":
		case "loadable":
			if platform[f[0]] {
				fail = append(fail, f[0]+" (not loaded)")
			} else {
				notLoaded = append(notLoaded, f[0])
			}
		default:
			if platform[f[0]] {
				fail = append(fail, f[0]+" (missing)")
			} else {
				missing = append(missing, f[0])
			}
		}
	}
	name := "network/modules " + node
	switch {
	case len(fail) > 0:
		return pfCheck{Name: name, Status: pfFail, Message: "platform modules: " + strings.Join(fail, ", "), Fix: "load them on the node (node image or a privileged module DaemonSet)"}
	case len(notLoaded)+len(missing) > 0:
		msg := ""
		if len(notLoaded) > 0 {
			msg = "lab modules not loaded: " + strings.Join(notLoaded, " ")
		}
		if len(missing) > 0 {
			msg = strings.TrimPrefix(msg+"; not in the node kernel: "+strings.Join(missing, " "), "; ")
		}
		return pfCheck{Name: name, Status: pfWarn, Message: msg, Fix: "list them in /etc/modules-load.d on lab nodes (tools/verify-vm/install.sh does), or use a node image that has them; labs using them fail otherwise"}
	}
	return pfCheck{Name: name, Status: pfPass, Message: fmt.Sprintf("%d platform and lab modules loaded or built in", total)}
}
