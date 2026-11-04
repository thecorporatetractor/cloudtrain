package drivers

import (
	"strings"
	"testing"
)

func TestNodePreflightVerdict(t *testing.T) {
	cm := []byte("kind: ConfigMap\ndata:\n  kubelet.yaml: |\n    kind: NodePreflight\n    kubeletLimits: pass\n    nodes: 3\n")
	v, err := ParseNodePreflight(cm)
	if err != nil || v.KubeletLimits != "pass" || v.Nodes != 3 {
		t.Fatalf("parse = %+v %v", v, err)
	}
	if err := CheckKubeletLimits(v, false); err != nil {
		t.Error(err)
	}
	fail := &NodePreflight{KubeletLimits: "fail", Message: "lab2: no podPidsLimit"}
	if err := CheckKubeletLimits(fail, true); err == nil || !strings.Contains(err.Error(), "no podPidsLimit") {
		t.Errorf("a failed verdict wins over attestation: %v", err)
	}
	if err := CheckKubeletLimits(nil, false); err == nil {
		t.Error("no verdict and no attestation must refuse")
	}
	if err := CheckKubeletLimits(nil, true); err != nil {
		t.Errorf("attested: %v", err)
	}
	if err := CheckKubeletLimits(&NodePreflight{KubeletLimits: "warn", Message: "no lab node"}, false); err == nil {
		t.Error("an unchecked verdict without attestation must refuse")
	}
	if _, err := ParseNodePreflight([]byte("kind: SandboxPreflight\n")); err == nil {
		t.Error("wrong kind")
	}
}
