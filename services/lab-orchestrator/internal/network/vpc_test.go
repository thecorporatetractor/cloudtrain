package network

import (
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"
)

// Every session VPC drops link-local and the wireserver (the policy routes
// survive a round trip through YAML/JSON as Kube-OVN reads them).
func TestSessionVPCDropsMetadata(t *testing.T) {
	b, err := yaml.Marshal(SessionVPCSpec())
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		PolicyRoutes []struct {
			Priority int    `json:"priority"`
			Match    string `json:"match"`
			Action   string `json:"action"`
		} `json:"policyRoutes"`
	}
	if err := yaml.Unmarshal(b, &spec); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, r := range spec.PolicyRoutes {
		if r.Action != "drop" || r.Priority < 31001 {
			t.Errorf("route %+v", r)
		}
		got[strings.TrimPrefix(r.Match, "ip4.dst == ")] = true
	}
	if !got["169.254.0.0/16"] || !got["168.63.129.16/32"] {
		t.Errorf("routes = %+v", spec.PolicyRoutes)
	}
	// Deep-copyable as an unstructured object (Kubernetes clients copy it).
	u := &unstructured.Unstructured{Object: map[string]any{"spec": SessionVPCSpec()}}
	_ = u.DeepCopy()
}
