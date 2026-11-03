package drivers

import (
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/validation"
)

// LabPlacement steers every lab workload onto a dedicated node pool (security
// review escape-4, code review prod-3): container and netdev pods, KubeVirt
// VMs (kubeadm nodes included), and vcluster control planes and synced pods.
// With a tainted lab pool (e.g. AKS: --node-taints cloudtrain.dev/labs=true:NoSchedule
// --labels cloudtrain.dev/pool=labs), platform pods never land on lab nodes,
// lab pods never land on the system pool, and the pool can scale to zero
// (pending lab pods carry the selector and the toleration the autoscaler
// needs). Empty = no change (kind, single-pool clusters).
type LabPlacement struct {
	NodeSelector map[string]string
	Tolerations  []corev1.Toleration
}

// Empty reports whether nothing is configured.
func (p LabPlacement) Empty() bool { return len(p.NodeSelector) == 0 && len(p.Tolerations) == 0 }

// ParseLabPlacement parses --lab-node-selector (key=value, comma separated)
// and --lab-tolerations (key[=value][:Effect], comma separated; without a
// value the operator is Exists, without an effect it tolerates every effect).
func ParseLabPlacement(selector, tolerations string) (LabPlacement, error) {
	var p LabPlacement
	for _, kv := range SplitList(selector) {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || k == "" {
			return p, fmt.Errorf("lab node selector %q: want key=value", kv)
		}
		if errs := validation.IsQualifiedName(k); len(errs) > 0 {
			return p, fmt.Errorf("lab node selector key %q: %s", k, strings.Join(errs, "; "))
		}
		if errs := validation.IsValidLabelValue(v); len(errs) > 0 {
			return p, fmt.Errorf("lab node selector value %q: %s", v, strings.Join(errs, "; "))
		}
		if p.NodeSelector == nil {
			p.NodeSelector = map[string]string{}
		}
		p.NodeSelector[k] = v
	}
	for _, t := range SplitList(tolerations) {
		tol, err := parseToleration(t)
		if err != nil {
			return p, err
		}
		p.Tolerations = append(p.Tolerations, tol)
	}
	return p, nil
}

func parseToleration(s string) (corev1.Toleration, error) {
	kv, effect, _ := strings.Cut(s, ":")
	k, v, hasValue := strings.Cut(kv, "=")
	if k == "" {
		return corev1.Toleration{}, fmt.Errorf("lab toleration %q: want key[=value][:Effect]", s)
	}
	if errs := validation.IsQualifiedName(k); len(errs) > 0 {
		return corev1.Toleration{}, fmt.Errorf("lab toleration key %q: %s", k, strings.Join(errs, "; "))
	}
	t := corev1.Toleration{Key: k, Operator: corev1.TolerationOpExists}
	if hasValue {
		t.Operator, t.Value = corev1.TolerationOpEqual, v
	}
	switch corev1.TaintEffect(effect) {
	case "", corev1.TaintEffectNoSchedule, corev1.TaintEffectPreferNoSchedule, corev1.TaintEffectNoExecute:
		t.Effect = corev1.TaintEffect(effect)
	default:
		return corev1.Toleration{}, fmt.Errorf("lab toleration %q: effect must be NoSchedule, PreferNoSchedule or NoExecute", s)
	}
	return t, nil
}

// ApplyToPod merges the placement into a pod spec (the pod's own selector
// keys win; tolerations are appended once).
func (p LabPlacement) ApplyToPod(spec *corev1.PodSpec) {
	if len(p.NodeSelector) > 0 {
		if spec.NodeSelector == nil {
			spec.NodeSelector = map[string]string{}
		}
		for k, v := range p.NodeSelector {
			if _, set := spec.NodeSelector[k]; !set {
				spec.NodeSelector[k] = v
			}
		}
	}
	for _, t := range p.Tolerations {
		dup := false
		for _, h := range spec.Tolerations {
			dup = dup || h.MatchToleration(&t)
		}
		if !dup {
			spec.Tolerations = append(spec.Tolerations, t)
		}
	}
}

// vmTemplateFields are the nodeSelector and tolerations of a KubeVirt VM
// template (virt-launcher pod placement), in unstructured form.
func (p LabPlacement) vmTemplateFields(spec map[string]any) {
	if len(p.NodeSelector) > 0 {
		sel := map[string]any{}
		for k, v := range p.NodeSelector {
			sel[k] = v
		}
		spec["nodeSelector"] = sel
	}
	if len(p.Tolerations) > 0 {
		var tols []any
		for _, t := range p.Tolerations {
			m := map[string]any{"key": t.Key, "operator": string(t.Operator)}
			if t.Value != "" {
				m["value"] = t.Value
			}
			if t.Effect != "" {
				m["effect"] = string(t.Effect)
			}
			tols = append(tols, m)
		}
		spec["tolerations"] = tols
	}
}

// tolerationStrings renders the tolerations in the taint syntax vcluster's
// sync.toHost.pods.enforceTolerations takes (key[=value][:Effect]).
func (p LabPlacement) tolerationStrings() []string {
	var out []string
	for _, t := range p.Tolerations {
		s := t.Key
		if t.Operator == corev1.TolerationOpEqual {
			s += "=" + t.Value
		}
		if t.Effect != "" {
			s += ":" + string(t.Effect)
		}
		out = append(out, s)
	}
	return out
}

// vclusterValues is the placement part of a vcluster's values: the control
// plane gets the selector and tolerations; synced pods get the tolerations
// (enforceTolerations). Synced pods are kept off other pools by the platform
// pool's taint and, with a sandbox, by the RuntimeClass's scheduling; a node
// selector for them would need vcluster node sync (a ClusterRole).
func (p LabPlacement) vclusterValues() (controlPlane map[string]any, syncedTolerations []string) {
	if p.Empty() {
		return nil, nil
	}
	sched := map[string]any{}
	if len(p.NodeSelector) > 0 {
		sel := map[string]any{}
		keys := make([]string, 0, len(p.NodeSelector))
		for k := range p.NodeSelector {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			sel[k] = p.NodeSelector[k]
		}
		sched["nodeSelector"] = sel
	}
	if len(p.Tolerations) > 0 {
		var tols []any
		tmp := map[string]any{}
		p.vmTemplateFields(tmp)
		tols = tmp["tolerations"].([]any)
		sched["tolerations"] = tols
	}
	return sched, p.tolerationStrings()
}
