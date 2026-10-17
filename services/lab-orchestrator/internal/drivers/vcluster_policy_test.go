package drivers

import (
	"strings"
	"testing"

	"github.com/google/cel-go/cel"
	"github.com/google/cel-go/ext"
	"sigs.k8s.io/yaml"
)

// evalPolicy evaluates the rendered policy the way the API server does
// (optional types, string extensions) for one ephemeral-container update and
// returns the messages of the failed validations.
func evalPolicy(t *testing.T, level string, oldPod, newPod map[string]any) []string {
	t.Helper()
	docs, err := EphemeralPolicyManifests(level)
	if err != nil {
		t.Fatal(err)
	}
	var pol struct {
		Spec struct {
			Variables   []struct{ Name, Expression string }
			Validations []struct{ Expression, MessageExpression string }
		}
	}
	if err := yaml.Unmarshal([]byte(strings.Split(docs, "---\n")[0]), &pol); err != nil {
		t.Fatal(err)
	}
	env, err := cel.NewEnv(cel.OptionalTypes(), ext.Strings(),
		cel.Variable("object", cel.DynType), cel.Variable("oldObject", cel.DynType),
		cel.Variable("variables", cel.MapType(cel.StringType, cel.DynType)))
	if err != nil {
		t.Fatal(err)
	}
	eval := func(expr string, vars map[string]any) any {
		ast, iss := env.Compile(expr)
		if iss.Err() != nil {
			t.Fatalf("compile %q: %v", expr, iss.Err())
		}
		prg, err := env.Program(ast)
		if err != nil {
			t.Fatal(err)
		}
		out, _, err := prg.Eval(map[string]any{"object": newPod, "oldObject": oldPod, "variables": vars})
		if err != nil {
			t.Fatalf("eval %q: %v", expr, err)
		}
		return out.Value()
	}
	vars := map[string]any{}
	for _, v := range pol.Spec.Variables {
		vars[v.Name] = eval(v.Expression, vars)
	}
	var msgs []string
	for _, v := range pol.Spec.Validations {
		if eval(v.Expression, vars) != true {
			msgs = append(msgs, eval(v.MessageExpression, vars).(string))
		}
	}
	return msgs
}

func pod(ecs ...map[string]any) map[string]any {
	l := make([]any, 0, len(ecs))
	for _, e := range ecs {
		l = append(l, e)
	}
	return map[string]any{"spec": map[string]any{"containers": []any{map[string]any{"name": "app"}}, "ephemeralContainers": l}}
}

// kubectl debug profiles (kubectl 1.37): general adds SYS_PTRACE, sysadmin is
// privileged, netadmin adds NET_ADMIN and NET_RAW, baseline sets nothing,
// restricted drops ALL and runs non-root with RuntimeDefault seccomp.
var (
	ecGeneral  = map[string]any{"name": "debugger-a", "securityContext": map[string]any{"capabilities": map[string]any{"add": []any{"SYS_PTRACE"}}}}
	ecSysadmin = map[string]any{"name": "debugger-s", "securityContext": map[string]any{"privileged": true}}
	ecNetadmin = map[string]any{"name": "debugger-n", "securityContext": map[string]any{"capabilities": map[string]any{"add": []any{"NET_ADMIN", "NET_RAW"}}}}
	ecBaseline = map[string]any{"name": "debugger-b"}
	ecRestrict = map[string]any{"name": "debugger-r", "securityContext": map[string]any{"allowPrivilegeEscalation": false, "runAsNonRoot": true,
		"capabilities": map[string]any{"drop": []any{"ALL"}}, "seccompProfile": map[string]any{"type": "RuntimeDefault"}}}
)

func TestEphemeralPolicyBaseline(t *testing.T) {
	for _, tc := range []struct {
		name   string
		ec     map[string]any
		refuse string
	}{
		{"general", ecGeneral, "debug container debugger-a: must not add capabilities"},
		{"sysadmin", ecSysadmin, "debugger-s: privileged must not be true"},
		{"netadmin", ecNetadmin, "debugger-n: must not add capabilities"},
		{"unconfined", map[string]any{"name": "u", "securityContext": map[string]any{"seccompProfile": map[string]any{"type": "Unconfined"}}}, "seccompProfile"},
		{"baseline", ecBaseline, ""},
		{"restricted", ecRestrict, ""},
		{"allowed cap", map[string]any{"name": "k", "securityContext": map[string]any{"capabilities": map[string]any{"add": []any{"KILL"}}}}, ""},
	} {
		msgs := evalPolicy(t, "", pod(), pod(tc.ec))
		switch {
		case tc.refuse == "" && len(msgs) > 0:
			t.Errorf("%s: refused: %v", tc.name, msgs)
		case tc.refuse != "" && (len(msgs) != 1 || !strings.Contains(msgs[0], tc.refuse) || !strings.Contains(msgs[0], "--profile=baseline")):
			t.Errorf("%s: messages %q, want one containing %q", tc.name, msgs, tc.refuse)
		}
	}
}

func TestEphemeralPolicyOnlyJudgesNewContainers(t *testing.T) {
	// A violating container that already exists (added before the policy)
	// must not block a compliant new one.
	if msgs := evalPolicy(t, "", pod(ecGeneral), pod(ecGeneral, ecBaseline)); len(msgs) > 0 {
		t.Errorf("existing container judged: %v", msgs)
	}
	if msgs := evalPolicy(t, "", pod(ecBaseline), pod(ecBaseline, ecGeneral)); len(msgs) != 1 {
		t.Errorf("new violating container not refused: %v", msgs)
	}
	// A Pod without ephemeral containers before (field absent).
	old := map[string]any{"spec": map[string]any{"containers": []any{}}}
	if msgs := evalPolicy(t, "", old, pod(ecGeneral)); len(msgs) != 1 {
		t.Errorf("first container: %v", msgs)
	}
}

func TestEphemeralPolicyRestricted(t *testing.T) {
	if msgs := evalPolicy(t, PodSecurityRestricted, pod(), pod(ecRestrict)); len(msgs) > 0 {
		t.Errorf("restricted profile refused: %v", msgs)
	}
	msgs := evalPolicy(t, PodSecurityRestricted, pod(), pod(ecBaseline))
	if len(msgs) != 4 || !strings.Contains(msgs[0], "--profile=restricted") {
		t.Errorf("baseline profile under restricted: %q", msgs)
	}
	// Pod-level runAsNonRoot and seccomp count.
	p := pod(map[string]any{"name": "x", "securityContext": map[string]any{"allowPrivilegeEscalation": false, "capabilities": map[string]any{"drop": []any{"ALL"}}}})
	p["spec"].(map[string]any)["securityContext"] = map[string]any{"runAsNonRoot": true, "seccompProfile": map[string]any{"type": "RuntimeDefault"}}
	if msgs := evalPolicy(t, PodSecurityRestricted, pod(), p); len(msgs) > 0 {
		t.Errorf("pod-level settings ignored: %v", msgs)
	}
	if _, err := EphemeralPolicyManifests("privileged"); err == nil {
		t.Error("privileged accepted")
	}
}

func TestVClusterValuesDeployPolicy(t *testing.T) {
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
	v, err := (&VClusterDriver{}).values(ref, VClusterRelease(ref.Session, ref.Node.Name))
	if err != nil {
		t.Fatal(err)
	}
	var vals struct {
		Experimental struct {
			Deploy struct{ VCluster struct{ Manifests string } }
		}
	}
	if err := yaml.Unmarshal(v, &vals); err != nil {
		t.Fatal(err)
	}
	m := vals.Experimental.Deploy.VCluster.Manifests
	if !strings.Contains(m, "kind: ValidatingAdmissionPolicyBinding") || !strings.Contains(m, "pods/ephemeralcontainers") ||
		!strings.Contains(m, "pod-security: baseline") {
		t.Errorf("manifests:\n%s", m)
	}
}
