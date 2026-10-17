package drivers

import (
	"fmt"
	"strings"

	"sigs.k8s.io/yaml"
)

// EphemeralPolicyName is the ValidatingAdmissionPolicy (and binding) every
// virtual cluster gets at install time (vcluster experimental.deploy).
const EphemeralPolicyName = "cloudtrain-ephemeral-pod-security"

// Why the policy exists: Pods created inside a vcluster are synced into its
// host namespace, which enforces Pod Security (HostNamespacePodSecurity).
// A plain Pod that violates it stays Pending with a SyncError event and can
// be fixed or deleted. An ephemeral container cannot: the virtual API server
// accepts it (it has no Pod Security labels of its own), the host refuses
// the sync, and because ephemeral containers can never be removed, every
// later ephemeral container of that Pod fails to sync too. `kubectl debug`
// with its default "general" profile adds SYS_PTRACE, so the learner's first
// debug attempt silently and permanently broke the Pod. The policy refuses
// such ephemeral containers inside the virtual cluster, before they exist,
// with a message that names the fix.

// ephemeralRule is one Pod Security control checked on each newly added
// ephemeral container `c` (the Pod is `object`).
type ephemeralRule struct {
	cond string // CEL, true when c complies
	what string // learner-facing description of the violation
}

// Baseline controls that apply to a container's securityContext (the
// Pod-level ones, host namespaces and volumes, cannot change with an
// ephemeral container). Capability list as in the Pod Security Standards.
var baselineRules = []ephemeralRule{
	{"!c.?securityContext.?privileged.orValue(false)", "privileged must not be true"},
	{"c.?securityContext.?capabilities.?add.orValue([]).all(x, x in ['AUDIT_WRITE', 'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'KILL', 'MKNOD', 'NET_BIND_SERVICE', 'SETFCAP', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_CHROOT'])",
		"must not add capabilities such as SYS_PTRACE, NET_ADMIN or SYS_ADMIN"},
	{"!c.?securityContext.?windowsOptions.?hostProcess.orValue(false)", "hostProcess must not be true"},
	{"c.?securityContext.?procMount.orValue('Default') == 'Default'", "procMount must be Default"},
	{"c.?securityContext.?seccompProfile.?type.orValue('') != 'Unconfined'", "seccompProfile must not be Unconfined"},
	{"c.?securityContext.?appArmorProfile.?type.orValue('') != 'Unconfined'", "appArmorProfile must not be Unconfined"},
	{"c.?securityContext.?seLinuxOptions.?type.orValue('') in ['', 'container_t', 'container_init_t', 'container_kvm_t', 'container_engine_t'] && c.?securityContext.?seLinuxOptions.?user.orValue('') == '' && c.?securityContext.?seLinuxOptions.?role.orValue('') == ''",
		"seLinuxOptions must not set a custom user, role or type"},
}

// Restricted adds these (Pod-level settings count where the standard allows).
var restrictedRules = []ephemeralRule{
	{"c.?securityContext.?allowPrivilegeEscalation.orValue(true) == false", "allowPrivilegeEscalation must be false"},
	{"c.?securityContext.?runAsNonRoot.orValue(object.spec.?securityContext.?runAsNonRoot.orValue(false)) == true", "runAsNonRoot must be true"},
	{"c.?securityContext.?runAsUser.orValue(object.spec.?securityContext.?runAsUser.orValue(1)) != 0", "runAsUser must not be 0"},
	{"'ALL' in c.?securityContext.?capabilities.?drop.orValue([])", "capabilities must drop ALL"},
	{"c.?securityContext.?capabilities.?add.orValue([]).all(x, x == 'NET_BIND_SERVICE')", "may only add NET_BIND_SERVICE"},
	{"c.?securityContext.?seccompProfile.?type.orValue(object.spec.?securityContext.?seccompProfile.?type.orValue('')) in ['RuntimeDefault', 'Localhost']",
		"seccompProfile must be RuntimeDefault or Localhost"},
}

// ephemeralAdded is the CEL list of ephemeral containers this request adds
// (an existing one is never re-judged, so an old violation cannot block
// every later debug session).
const ephemeralAdded = "object.spec.?ephemeralContainers.orValue([]).filter(c, !oldObject.spec.?ephemeralContainers.orValue([]).exists(o, o.name == c.name))"

// EphemeralPolicyRules returns the CEL rules for a Pod Security level
// (baseline when empty).
func EphemeralPolicyRules(level string) []ephemeralRule {
	rules := append([]ephemeralRule(nil), baselineRules...)
	if level == PodSecurityRestricted {
		rules = append(rules, restrictedRules...)
	}
	return rules
}

// EphemeralPolicyManifests renders the ValidatingAdmissionPolicy and its
// binding that refuse ephemeral containers violating level inside a virtual
// cluster.
func EphemeralPolicyManifests(level string) (string, error) {
	if level == "" {
		level = PodSecurityBaseline
	}
	if !ValidPodSecurity(level) {
		return "", fmt.Errorf("pod security level %q", level)
	}
	profile := "--profile=baseline (or --profile=restricted)"
	if level == PodSecurityRestricted {
		profile = "--profile=restricted"
	}
	var validations []map[string]any
	for _, r := range EphemeralPolicyRules(level) {
		validations = append(validations, map[string]any{
			"expression": "variables.added.all(c, " + r.cond + ")",
			"messageExpression": fmt.Sprintf("'Pod Security %q (enforced where this cluster runs its Pods) refuses debug container ' + "+
				"variables.added.filter(c, !(%s)).map(c, c.name).join(', ') + ': %s. An ephemeral container that cannot start can never be removed, "+
				"so it was not added. With kubectl debug use %s.'", level, r.cond, r.what, profile),
			"reason": "Forbidden",
		})
	}
	policy := map[string]any{
		"apiVersion": "admissionregistration.k8s.io/v1",
		"kind":       "ValidatingAdmissionPolicy",
		"metadata": map[string]any{"name": EphemeralPolicyName, "labels": map[string]any{
			"app.kubernetes.io/managed-by": "cloudtrain", "labs.cloudtrain.dev/pod-security": level}},
		"spec": map[string]any{
			"failurePolicy": "Fail",
			"matchConstraints": map[string]any{"resourceRules": []any{map[string]any{
				"apiGroups": []string{""}, "apiVersions": []string{"v1"},
				"operations": []string{"UPDATE"}, "resources": []string{"pods/ephemeralcontainers"},
			}}},
			"variables":   []any{map[string]any{"name": "added", "expression": ephemeralAdded}},
			"validations": validations,
		},
	}
	binding := map[string]any{
		"apiVersion": "admissionregistration.k8s.io/v1",
		"kind":       "ValidatingAdmissionPolicyBinding",
		"metadata":   map[string]any{"name": EphemeralPolicyName, "labels": map[string]any{"app.kubernetes.io/managed-by": "cloudtrain"}},
		"spec":       map[string]any{"policyName": EphemeralPolicyName, "validationActions": []string{"Deny"}},
	}
	var docs []string
	for _, o := range []any{policy, binding} {
		b, err := yaml.Marshal(o)
		if err != nil {
			return "", err
		}
		docs = append(docs, string(b))
	}
	return strings.Join(docs, "---\n"), nil
}
