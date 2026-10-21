package rbac

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

func celList(caps []corev1.Capability) string {
	q := make([]string, len(caps))
	for i, c := range caps {
		q[i] = "'" + string(c) + "'"
	}
	return "[" + strings.Join(q, ", ") + "]"
}

// TestPodPolicyMatchesBuilder: the capability sets the lab pod admission
// policy allows are exactly the ones the pod builders add (the envtest
// TestEnvtestPodPolicy creates the built pods against the policy).
func TestPodPolicyMatchesBuilder(t *testing.T) {
	pol, b := podPolicy(t, "[]")
	var caps string
	for _, v := range pol.Spec.Validations {
		if strings.Contains(v.Expression, "baselineCaps") {
			caps = v.Expression
		}
	}
	if caps == "" {
		t.Fatal("no capability rule")
	}
	if !slices.Equal(network.NodeCapabilities, network.SidecarCapabilities) {
		t.Fatalf("node %v and sidecar %v sets differ: the policy allows one set for both", network.NodeCapabilities, network.SidecarCapabilities)
	}
	for _, want := range []string{
		fmt.Sprintf("c.name in ['%s', '%s'] && x in %s", drivers.ContainerName, network.SidecarName, celList(network.NodeCapabilities)),
		fmt.Sprintf("c.name == '%s' && x == '%s'", network.InitContainerName, network.InitCapabilities[0]),
		fmt.Sprintf("variables.profile == '%s' && c.name == '%s' && x == 'SYS_ADMIN'", network.PodProfileNetdev, drivers.ContainerName),
		fmt.Sprintf("variables.profile in ['%s', '%s']", network.PodProfileWired, network.PodProfileNetdev),
	} {
		if !strings.Contains(strings.Join(strings.Fields(caps), " "), want) {
			t.Errorf("capability rule lacks %q:\n%s", want, caps)
		}
	}
	if len(network.InitCapabilities) != 1 {
		t.Errorf("net-init capabilities %v: the policy allows exactly one", network.InitCapabilities)
	}
	// FRR: the policy's netdev set is the wired set plus SYS_ADMIN (and
	// baseline NET_BIND_SERVICE).
	for _, c := range (drivers.FRR{}).Capabilities() {
		if !slices.Contains(network.NodeCapabilities, c) && c != "SYS_ADMIN" && c != "NET_BIND_SERVICE" {
			t.Errorf("FRR capability %s is not allowed by the policy", c)
		}
	}
	for _, v := range pol.Spec.Variables {
		if v.Name == "profile" && !strings.Contains(v.Expression, "'"+network.LabelPodProfile+"'") {
			t.Errorf("profile variable does not read %s: %s", network.LabelPodProfile, v.Expression)
		}
		if v.Name == "manager" && !strings.Contains(v.Expression, "system:serviceaccount:"+managerNS+":lab-orchestrator") {
			t.Errorf("manager variable: %s (the deploy tools rewrite this ServiceAccount)", v.Expression)
		}
	}
	if pol.Spec.FailurePolicy == nil || *pol.Spec.FailurePolicy != "Fail" || b.Spec.PolicyName != pol.Name ||
		b.Spec.MatchResources.NamespaceSelector.MatchLabels[drivers.LabelLabNamespace] != "true" ||
		pol.Spec.MatchConstraints.NamespaceSelector.MatchLabels[drivers.LabelLabNamespace] != "true" {
		t.Errorf("policy %s / binding %s: failurePolicy, binding or lab namespace selector", pol.Name, b.Name)
	}
	if pol.Name != "lab-orchestrator-pods" {
		t.Errorf("policy name %s: orchestrator-deploy.sh selects lab-orchestrator-pods", pol.Name)
	}
}
