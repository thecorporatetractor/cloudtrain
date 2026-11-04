package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// kubeletLimits are the kubelet settings lab nodes need (security review
// escape-6, and seccomp for pods inside vclusters): a PID limit per pod
// (fork bombs) and seccompDefault (RuntimeDefault for pods that set none).
type kubeletLimits struct {
	PodPidsLimit   *int64 `json:"podPidsLimit"`
	SeccompDefault *bool  `json:"seccompDefault"`
}

// parseConfigz reads a kubelet's /configz answer.
func parseConfigz(b []byte) (kubeletLimits, error) {
	var z struct {
		KubeletConfig kubeletLimits `json:"kubeletconfig"`
	}
	if err := json.Unmarshal(b, &z); err != nil {
		return kubeletLimits{}, err
	}
	return z.KubeletConfig, nil
}

// kubeletProblems lists what a node's kubelet lacks.
func kubeletProblems(k kubeletLimits) []string {
	var out []string
	if k.PodPidsLimit == nil || *k.PodPidsLimit <= 0 {
		out = append(out, "no podPidsLimit")
	}
	if k.SeccompDefault == nil || !*k.SeccompDefault {
		out = append(out, "seccompDefault off")
	}
	return out
}

// kubeletChecks checks the lab nodes' kubelets (the lab pool when one is
// configured: a failure; otherwise every node: a warning, e.g. kind before a
// recreate). configz returns a node's /configz.
func kubeletChecks(nodes []corev1.Node, pool drivers.LabPlacement, configz func(node string) ([]byte, error)) pfCheck {
	c, _ := kubeletChecksN(nodes, pool, configz)
	return c
}

// kubeletChecksN is kubeletChecks plus the number of nodes checked.
func kubeletChecksN(nodes []corev1.Node, pool drivers.LabPlacement, configz func(node string) ([]byte, error)) (pfCheck, int) {
	status := pfWarn
	var sel labels.Selector
	if len(pool.NodeSelector) > 0 {
		status, sel = pfFail, labels.SelectorFromSet(pool.NodeSelector)
	}
	var bad []string
	n := 0
	for _, node := range nodes {
		if sel != nil && !sel.Matches(labels.Set(node.Labels)) {
			continue
		}
		n++
		b, err := configz(node.Name)
		if err != nil {
			bad = append(bad, node.Name+": cannot read /configz ("+err.Error()+")")
			continue
		}
		k, err := parseConfigz(b)
		if err != nil {
			bad = append(bad, node.Name+": "+err.Error())
			continue
		}
		if p := kubeletProblems(k); len(p) > 0 {
			bad = append(bad, node.Name+": "+strings.Join(p, ", "))
		}
	}
	sort.Strings(bad)
	if len(bad) > 0 {
		return pfCheck{Name: "kubelet-limits", Status: status, Message: "lab node kubelets without PID limit or seccompDefault: " + strings.Join(bad, "; "),
			Fix: "kubelet podPidsLimit (e.g. 4096) and seccompDefault: true (AKS: --kubelet-config {\"podMaxPids\": 4096, \"seccompDefault\": \"RuntimeDefault\"} on the lab pool; kind: deploy/kind/cluster.yaml, recreate)"}, n
	}
	if n == 0 {
		return pfCheck{Name: "kubelet-limits", Status: pfWarn, Message: "no lab node to check (fine while an autoscaled pool is at zero)"}, 0
	}
	return pfCheck{Name: "kubelet-limits", Status: pfPass, Message: fmt.Sprintf("%d lab node kubelets cap PIDs per pod and default seccomp", n)}, n
}

// nodeConfigz reads /api/v1/nodes/<node>/proxy/configz.
func nodeConfigz(ctx context.Context, cs kubernetes.Interface) func(string) ([]byte, error) {
	return func(node string) ([]byte, error) {
		return cs.CoreV1().RESTClient().Get().AbsPath("/api/v1/nodes", node, "proxy", "configz").DoRaw(ctx)
	}
}

// nodePreflightConfigMap renders the kubelet verdict as the ConfigMap the
// manager mounts (--node-preflight).
func nodePreflightConfigMap(c pfCheck, nodes int, ref string) ([]byte, error) {
	ns, name, ok := strings.Cut(ref, "/")
	if !ok || ns == "" || name == "" {
		return nil, fmt.Errorf("--node-configmap-name %q: want <namespace>/<name>", ref)
	}
	v := drivers.NodePreflight{APIVersion: drivers.SandboxAPIVersion, Kind: drivers.NodePreflightKind, KubeletLimits: c.Status, Nodes: nodes, Message: c.Message}
	doc, err := yaml.Marshal(v)
	if err != nil {
		return nil, err
	}
	return yaml.Marshal(map[string]any{
		"apiVersion": "v1", "kind": "ConfigMap",
		"metadata": map[string]any{"namespace": ns, "name": name},
		"data":     map[string]string{drivers.NodePreflightKey: string(doc)},
	})
}
