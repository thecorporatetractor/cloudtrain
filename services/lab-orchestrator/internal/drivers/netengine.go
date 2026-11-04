package drivers

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// Lab isolation rests on NetworkPolicy (security review network-4). The
// manager checks at startup that something enforces it, and refuses to
// provision under the production profile when nothing does. It reads, in
// kube-system only (config/rbac/policy_engine_role.yaml): DaemonSets,
// Deployments and the cilium-config ConfigMap.

// PolicyEngine is the startup check's verdict.
type PolicyEngine struct {
	// Enforcing: a NetworkPolicy engine runs and is not switched off.
	Enforcing bool
	// Engines found, e.g. "Cilium (enable-policy default)".
	Engines []string
	// Reason explains a negative verdict.
	Reason string
}

// policyEngines are the DaemonSets of engines that enforce NetworkPolicy.
var policyEngines = map[string]string{
	"cilium":       "Cilium",
	"calico-node":  "Calico",
	"azure-npm":    "Azure NPM",
	"anetd":        "GKE Dataplane V2",
	"kube-ovn-cni": "Kube-OVN",
}

// CheckPolicyEngine finds the cluster's NetworkPolicy engine.
//   - Cilium counts only when cilium-config's enable-policy is not "never"
//     (default or always enforce; never ignores every policy).
//   - Kube-OVN counts unless kube-ovn-controller runs with --enable-np=false.
//
// Readiness: with a lab pool (labNodes, the lab node selector), every
// schedulable lab node must run a Ready agent of the engine; other pools do
// not matter (an agent restarting on a system node holds nothing back).
// Without one, every scheduled agent must be ready.
func CheckPolicyEngine(ctx context.Context, r client.Reader, labNodes labels.Selector) (PolicyEngine, error) {
	dss := &appsv1.DaemonSetList{}
	if err := r.List(ctx, dss, client.InNamespace("kube-system")); err != nil {
		return PolicyEngine{}, fmt.Errorf("list kube-system DaemonSets: %w", err)
	}
	var v PolicyEngine
	var off []string
	for _, ds := range dss.Items {
		name, ok := policyEngines[ds.Name]
		if !ok {
			continue
		}
		// Present is not enough: the agents on the nodes that matter must
		// be ready, or those nodes do not enforce.
		if labNodes != nil {
			missing, err := labNodesWithoutAgent(ctx, r, &ds, labNodes)
			if err != nil {
				return PolicyEngine{}, err
			}
			if len(missing) > 0 {
				off = append(off, fmt.Sprintf("%s (no ready agent on lab nodes %s)", name, strings.Join(missing, ", ")))
				continue
			}
		} else if d, r := ds.Status.DesiredNumberScheduled, ds.Status.NumberReady; d == 0 || r != d {
			off = append(off, fmt.Sprintf("%s (%d of %d agents ready)", name, r, d))
			continue
		}
		switch ds.Name {
		case "cilium":
			cm := &corev1.ConfigMap{}
			if err := r.Get(ctx, client.ObjectKey{Namespace: "kube-system", Name: "cilium-config"}, cm); err != nil {
				return PolicyEngine{}, fmt.Errorf("read kube-system/cilium-config: %w", err)
			}
			mode := cm.Data["enable-policy"]
			if mode == "" {
				mode = "default"
			}
			if mode == "never" {
				off = append(off, "Cilium (enable-policy never)")
				continue
			}
			name += " (enable-policy " + mode + ")"
		case "kube-ovn-cni":
			ctrl := &appsv1.Deployment{}
			if err := r.Get(ctx, client.ObjectKey{Namespace: "kube-system", Name: "kube-ovn-controller"}, ctrl); err == nil && kubeOVNPolicyOff(ctrl) {
				off = append(off, "Kube-OVN (--enable-np=false)")
				continue
			}
		}
		v.Engines = append(v.Engines, name)
	}
	v.Enforcing = len(v.Engines) > 0
	if !v.Enforcing {
		v.Reason = "no NetworkPolicy engine in kube-system (Cilium, Calico, Azure NPM, GKE Dataplane V2, Kube-OVN)"
		if len(off) > 0 {
			v.Reason = "NetworkPolicy enforcement is off or not ready: " + strings.Join(off, ", ")
		}
	}
	return v, nil
}

func kubeOVNPolicyOff(d *appsv1.Deployment) bool {
	for _, c := range d.Spec.Template.Spec.Containers {
		for _, a := range append(append([]string{}, c.Command...), c.Args...) {
			if a == "--enable-np=false" {
				return true
			}
		}
	}
	return false
}

// ProvisionGate holds the production profile's live preconditions, each
// under its own key ("network-policy": the NetworkPolicy engine verdict,
// "kubelet": labctl preflight's kubelet verdict), re-checked by the manager.
// Under the production profile no lab pod, VM or vcluster is created while
// any of them reports a problem (ContainerDriver.gateErr).
type ProvisionGate struct {
	mu      sync.Mutex
	reasons map[string]string
}

// Set records a key's verdict ("" = fine).
func (g *ProvisionGate) Set(key, reason string) {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.reasons == nil {
		g.reasons = map[string]string{}
	}
	if reason == "" {
		delete(g.reasons, key)
		return
	}
	g.reasons[key] = reason
}

// Err is non-nil while any precondition fails.
func (g *ProvisionGate) Err() error {
	if g == nil {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.reasons) == 0 {
		return nil
	}
	keys := make([]string, 0, len(g.reasons))
	for k := range g.reasons {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, k+": "+g.reasons[k])
	}
	return fmt.Errorf("lab isolation preconditions failing, nothing is provisioned: %s", strings.Join(parts, "; "))
}

// Gate keys.
const (
	GateNetworkPolicy = "network-policy"
	GateKubelet       = "kubelet"
)

// Verdict turns a check result into the gate's reason.
func (v PolicyEngine) Verdict(err error) string {
	switch {
	case err != nil:
		return "cannot tell: " + err.Error()
	case !v.Enforcing:
		return v.Reason
	}
	return ""
}

// labNodesWithoutAgent lists the schedulable lab nodes with no Ready pod of ds.
func labNodesWithoutAgent(ctx context.Context, r client.Reader, ds *appsv1.DaemonSet, labNodes labels.Selector) ([]string, error) {
	nodes := &corev1.NodeList{}
	if err := r.List(ctx, nodes, client.MatchingLabelsSelector{Selector: labNodes}); err != nil {
		return nil, fmt.Errorf("list lab nodes: %w", err)
	}
	sel, err := metav1.LabelSelectorAsSelector(ds.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("DaemonSet %s selector: %w", ds.Name, err)
	}
	pods := &corev1.PodList{}
	if err := r.List(ctx, pods, client.InNamespace(ds.Namespace), client.MatchingLabelsSelector{Selector: sel}); err != nil {
		return nil, fmt.Errorf("list %s pods: %w", ds.Name, err)
	}
	ready := map[string]bool{}
	for _, p := range pods.Items {
		for _, c := range p.Status.Conditions {
			if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue && p.DeletionTimestamp == nil {
				ready[p.Spec.NodeName] = true
			}
		}
	}
	var missing []string
	for _, n := range nodes.Items {
		if !n.Spec.Unschedulable && !ready[n.Name] {
			missing = append(missing, n.Name)
		}
	}
	sort.Strings(missing)
	return missing, nil
}
