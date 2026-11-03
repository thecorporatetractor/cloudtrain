package drivers

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"

	admissionv1 "k8s.io/api/admissionregistration/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// The lab pod admission policy (config/rbac/pod_admission_policy.yaml) is the
// backstop behind the sandbox rules: in lab namespaces, a privileged container
// or a capability beyond the platform's own sets is rejected at admission
// unless the pod runs in a configured sandbox RuntimeClass, whatever created
// the pod. The deploy tools install it; the manager checks it at startup.

// PodPolicySandboxesVariable is the policy variable that lists the sandbox
// RuntimeClasses, rewritten per instance from the sandbox configuration.
const PodPolicySandboxesVariable = "sandboxes"

// SandboxRuntimeClasses returns the configured sandbox RuntimeClasses, sorted
// and without duplicates.
func (s *Sandboxes) SandboxRuntimeClasses() []string {
	if !s.Enabled() {
		return nil
	}
	var out []string
	for _, t := range s.Tiers {
		if t.RuntimeClass != "" && !slices.Contains(out, t.RuntimeClass) {
			out = append(out, t.RuntimeClass)
		}
	}
	sort.Strings(out)
	return out
}

// PodPolicyCheck is the outcome of CheckPodPolicy.
type PodPolicyCheck struct {
	// Warnings are logged; the manager keeps running.
	Warnings []string
	// Info describes what was found.
	Info string
}

// CheckPodPolicy verifies the lab pod admission policy at startup. served
// says whether the API server serves ValidatingAdmissionPolicy
// (admissionregistration.k8s.io/v1, Kubernetes 1.30+). It fails open only
// when that API is missing (a warning); with the API, a configured policy
// (name) must exist with a binding of the same name that denies, or the
// manager does not start. An empty name (no policy configured, e.g. a local
// run) is a warning. RuntimeClasses the manager sandboxes in but the policy
// does not list are a warning: their privileged pods would be rejected.
func CheckPodPolicy(ctx context.Context, r client.Reader, served bool, name string, sandboxClasses []string) (PodPolicyCheck, error) {
	var out PodPolicyCheck
	if !served {
		out.Warnings = append(out.Warnings, "the API server does not serve ValidatingAdmissionPolicy (Kubernetes < 1.30): "+
			"lab namespaces have no pod admission backstop; only the manager's own sandbox rules keep privileged containers off the host kernel")
		return out, nil
	}
	if name == "" {
		out.Warnings = append(out.Warnings, "no lab pod admission policy configured (--pod-admission-policy): "+
			"lab namespaces have no pod admission backstop (install config/rbac/pod_admission_policy.yaml)")
		return out, nil
	}
	pol := &admissionv1.ValidatingAdmissionPolicy{}
	if err := r.Get(ctx, client.ObjectKey{Name: name}, pol); err != nil {
		if apierrors.IsNotFound(err) {
			return out, fmt.Errorf("lab pod admission policy %s is not installed (config/rbac/pod_admission_policy.yaml; the deploy tools install it)", name)
		}
		return out, fmt.Errorf("reading lab pod admission policy %s: %w", name, err)
	}
	b := &admissionv1.ValidatingAdmissionPolicyBinding{}
	if err := r.Get(ctx, client.ObjectKey{Name: name}, b); err != nil {
		if apierrors.IsNotFound(err) {
			return out, fmt.Errorf("lab pod admission policy %s has no binding %s", name, name)
		}
		return out, fmt.Errorf("reading binding %s: %w", name, err)
	}
	if b.Spec.PolicyName != name || !slices.Contains(b.Spec.ValidationActions, admissionv1.Deny) {
		return out, fmt.Errorf("binding %s must bind policy %s with validationActions Deny (has %s, %v)", name, name, b.Spec.PolicyName, b.Spec.ValidationActions)
	}
	listed := ""
	for _, v := range pol.Spec.Variables {
		if v.Name == PodPolicySandboxesVariable {
			listed = v.Expression
		}
	}
	var missing []string
	for _, rc := range sandboxClasses {
		if !strings.Contains(listed, "'"+rc+"'") {
			missing = append(missing, rc)
		}
	}
	if len(missing) > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("lab pod admission policy %s does not list the sandbox RuntimeClasses %s (variables.%s = %s): "+
			"their privileged nodes will be rejected; redeploy so the policy follows the sandbox configuration",
			name, strings.Join(missing, ", "), PodPolicySandboxesVariable, listed))
	}
	out.Info = fmt.Sprintf("lab pod admission policy %s enforced (sandbox RuntimeClasses %s)", name, listed)
	return out, nil
}
