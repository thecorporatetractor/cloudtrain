package drivers

import (
	"fmt"

	"sigs.k8s.io/yaml"
)

// Kubelet limits of the lab nodes (security review escape-6): a PID limit
// per pod and seccompDefault. The manager cannot read kubelet configuration
// itself (that needs nodes/proxy, which also allows exec into every pod), so
// labctl preflight reads each lab node's /configz and writes its verdict into
// a ConfigMap the manager mounts (--node-preflight), like the sandbox
// preflight. Under the production profile the manager refuses to start
// unless the verdict passed, or the operator attests that the lab pool's
// kubelet configuration sets both (--kubelet-limits-attested: an autoscaled
// pool at zero has no node to read).

// NodePreflightKind and NodePreflightKey: the verdict document and its
// ConfigMap key.
const (
	NodePreflightKind = "NodePreflight"
	NodePreflightKey  = "kubelet.yaml"
)

// NodePreflight is labctl preflight's kubelet verdict.
type NodePreflight struct {
	APIVersion string `json:"apiVersion,omitempty"`
	Kind       string `json:"kind,omitempty"`
	// KubeletLimits: pass, fail or warn (nothing checked, e.g. no lab node).
	KubeletLimits string `json:"kubeletLimits"`
	Nodes         int    `json:"nodes"`
	Message       string `json:"message,omitempty"`
}

// ParseNodePreflight parses the verdict (a document or a ConfigMap).
func ParseNodePreflight(data []byte) (*NodePreflight, error) {
	data, err := configMapKey(data, NodePreflightKey)
	if err != nil {
		return nil, err
	}
	v := &NodePreflight{}
	if err := yaml.UnmarshalStrict(data, v); err != nil {
		return nil, fmt.Errorf("node preflight: %w", err)
	}
	if v.Kind != "" && v.Kind != NodePreflightKind {
		return nil, fmt.Errorf("node preflight: kind %q, want %s", v.Kind, NodePreflightKind)
	}
	return v, nil
}

// LoadNodePreflight reads the verdict file; a missing file is no verdict.
func LoadNodePreflight(path string) (*NodePreflight, error) {
	if path == "" {
		return nil, nil
	}
	b, err := LoadSandboxFile(path)
	if err != nil || b == nil {
		return nil, err
	}
	return ParseNodePreflight(b)
}

// CheckKubeletLimits is the production profile's startup decision.
func CheckKubeletLimits(v *NodePreflight, attested bool) error {
	switch {
	case v != nil && v.KubeletLimits == "pass":
		return nil
	case v != nil && v.KubeletLimits == "fail":
		return fmt.Errorf("lab node kubelets lack a PID limit or seccompDefault (labctl preflight: %s)", v.Message)
	case attested:
		return nil
	case v == nil:
		return fmt.Errorf("no kubelet verdict for the lab nodes: run labctl preflight --lab-node-selector ... --node-configmap and apply it, or attest the lab pool's kubelet config (--kubelet-limits-attested)")
	default:
		return fmt.Errorf("lab node kubelets unchecked (%s): run labctl preflight with lab nodes up, or attest the lab pool's kubelet config (--kubelet-limits-attested)", v.Message)
	}
}
