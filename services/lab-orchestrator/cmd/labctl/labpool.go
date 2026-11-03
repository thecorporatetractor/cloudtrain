package main

import (
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/klog/v2"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// labPoolChecks checks the lab node pool (the manager's --lab-node-selector
// and --lab-tolerations): every lab node carries a NoSchedule/NoExecute
// taint the lab tolerations tolerate (or platform pods can land there), and
// every other node a taint they do not tolerate (or lab pods that escape
// their selector, e.g. vcluster workloads, can land on the system pool).
func labPoolChecks(nodes []corev1.Node, p drivers.LabPlacement) []pfCheck {
	if p.Empty() {
		return nil
	}
	sel := labels.SelectorFromSet(p.NodeSelector)
	tolerated := func(t corev1.Taint) bool {
		for i := range p.Tolerations {
			if p.Tolerations[i].ToleratesTaint(klog.Background(), &t, false) {
				return true
			}
		}
		return false
	}
	var lab, untaintedLab, openOther []string
	for _, n := range nodes {
		hard := []corev1.Taint{}
		for _, t := range n.Spec.Taints {
			if t.Effect == corev1.TaintEffectNoSchedule || t.Effect == corev1.TaintEffectNoExecute {
				hard = append(hard, t)
			}
		}
		if len(p.NodeSelector) > 0 && sel.Matches(labels.Set(n.Labels)) {
			lab = append(lab, n.Name)
			ok := false
			for _, t := range hard {
				ok = ok || tolerated(t)
			}
			if !ok {
				untaintedLab = append(untaintedLab, n.Name)
			}
			continue
		}
		closed := false
		for _, t := range hard {
			closed = closed || !tolerated(t)
		}
		if !closed {
			openOther = append(openOther, n.Name)
		}
	}
	sort.Strings(untaintedLab)
	sort.Strings(openOther)
	var out []pfCheck
	switch {
	case len(lab) == 0:
		out = append(out, pfCheck{Name: "lab-pool", Status: pfWarn, Message: "no node matches the lab node selector (fine while an autoscaled pool is at zero)", Fix: "check --lab-node-selector against the pool's node labels"})
	case len(untaintedLab) > 0:
		out = append(out, pfCheck{Name: "lab-pool", Status: pfFail, Message: "lab nodes without a taint the lab tolerations match, so platform pods can run there: " + strings.Join(untaintedLab, ", "),
			Fix: "taint the lab pool, e.g. az aks nodepool update ... --node-taints cloudtrain.dev/labs=true:NoSchedule"})
	default:
		out = append(out, pfCheck{Name: "lab-pool", Status: pfPass, Message: fmt.Sprintf("%d lab nodes, all tainted for lab pods only", len(lab))})
	}
	if len(openOther) > 0 {
		out = append(out, pfCheck{Name: "system-pool", Status: pfFail, Message: "nodes outside the lab pool that lab pods could tolerate (no taint of their own): " + strings.Join(openOther, ", "),
			Fix: "taint the system pool with a key only platform pods tolerate (AKS: CriticalAddonsOnly=true:NoSchedule) and give the platform that toleration"})
	} else {
		out = append(out, pfCheck{Name: "system-pool", Status: pfPass, Message: "every node outside the lab pool has a taint lab pods do not tolerate"})
	}
	return out
}
