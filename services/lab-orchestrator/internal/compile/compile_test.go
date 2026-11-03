package compile

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

const minimalLab = `
apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: tiny-lab, title: Tiny, domain: linux, difficulty: easy, estimatedMinutes: 5}
spec:
  description: Create /tmp/{{file}}
  params:
    file: {type: name, prefix: notes}
  topology:
    nodes:
      - {name: box, driver: container, image: "ubuntu:24.04", access: [shell]}
  checks:
    - {id: exists, description: file exists, type: shell, on: box, command: "test -f /tmp/{{file}}", skills: [linux.files]}
  solution:
    steps:
      - {on: box, run: "touch /tmp/{{file}}"}
`

func readLab(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "labs", name, "lab.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// mutate applies string replacements to a lab document.
func mutate(doc string, pairs ...string) []byte {
	return []byte(strings.NewReplacer(pairs...).Replace(doc))
}

func TestCompileValid(t *testing.T) {
	tests := []struct {
		name  string
		data  []byte
		check func(t *testing.T, lt *labsv1.LabTemplate)
	}{
		{
			name: "networking topology",
			data: readLab(t, "net-ospf-two-routers"),
			check: func(t *testing.T, lt *labsv1.LabTemplate) {
				s := lt.Spec
				if lt.Name != "net-ospf-two-routers-v1" {
					t.Errorf("name = %q", lt.Name)
				}
				if s.Source.Domain != "networking" || s.Topology.Entry != "workstation" {
					t.Errorf("source/entry = %+v / %q", s.Source, s.Topology.Entry)
				}
				if got := len(s.Topology.Nodes); got != 5 {
					t.Errorf("nodes = %d", got)
				}
				if got := len(s.Topology.Links); got != 3 {
					t.Errorf("links = %d", got)
				}
				if im := s.Topology.Links[1].Impair; im == nil || im.LossPct != "0.5" || *im.LatencyMs != 15 {
					t.Errorf("impair = %+v", im)
				}
				if cpu := s.Topology.Nodes[3].Resources.CPU.String(); cpu != "250m" {
					t.Errorf("cpu = %s", cpu)
				}
				if got := s.Params["area"].Values; !reflect.DeepEqual(got, []string{"0", "10"}) {
					t.Errorf("area values = %v", got)
				}
				if s.Checks[3].Weight != "0.5" || s.Checks[1].Weight != DefaultCheckWeight {
					t.Errorf("weights = %q %q", s.Checks[3].Weight, s.Checks[1].Weight)
				}
				if s.Setup[0].Config == nil || s.Setup[0].As != labsv1.ActionAsAdmin || s.Setup[0].TimeoutSec != DefaultActionTimeoutSec {
					t.Errorf("setup defaults = %+v", s.Setup[0])
				}
				if !strings.HasPrefix(s.Source.Digest, "sha256:") {
					t.Errorf("digest = %q", s.Source.Digest)
				}
				// Placeholders survive compilation; they resolve per session.
				if !strings.Contains(s.Description, "{{octet}}") {
					t.Errorf("description lost placeholders")
				}
			},
		},
		{
			name: "kubeadm cluster topology",
			data: readLab(t, "k8s-kubeadm-worker-notready"),
			check: func(t *testing.T, lt *labsv1.LabTemplate) {
				s := lt.Spec
				if s.Source.Version != DefaultLabVersion {
					t.Errorf("version = %d", s.Source.Version)
				}
				c := s.Topology.Nodes[1].Cluster
				if c == nil || c.Mode != labsv1.ClusterModeKubeadm || len(c.Nodes) != 3 {
					t.Fatalf("cluster = %+v", c)
				}
				if c.Nodes[0].State != "ready" || c.Nodes[2].State != "notready" {
					t.Errorf("states = %q %q", c.Nodes[0].State, c.Nodes[2].State)
				}
				if s.Setup[1].On != "orchard/orchard-w2" || s.Setup[1].TimeoutSec != 120 {
					t.Errorf("setup[1] = %+v", s.Setup[1])
				}
				if s.Hints[0].Cost != 2 || s.Checks[0].TimeoutSec != DefaultK8sCheckTimeoutSec {
					t.Errorf("hint cost %d, check timeout %d", s.Hints[0].Cost, s.Checks[0].TimeoutSec)
				}
				if lt.Labels["labs.cloudtrain.dev/domain"] != "kubernetes" {
					t.Errorf("labels = %v", lt.Labels)
				}
			},
		},
		{
			name: "defaults: entry falls back to first container node, virtual cluster context",
			data: []byte(`
apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: vc-lab, title: VC, domain: kubernetes, difficulty: easy, estimatedMinutes: 10}
spec:
  description: d
  topology:
    nodes:
      - {name: dev, driver: k8s-cluster, cluster: {}}
      - {name: ws, driver: container, image: "jumphost:1"}
  checks:
    - {id: c, description: c, type: k8s-query, query: {cluster: dev, resource: pods}, skills: [k8s.pods]}
  solution:
    steps: [{on: dev, apply: "kind: List"}]
`),
			check: func(t *testing.T, lt *labsv1.LabTemplate) {
				if lt.Spec.Topology.Entry != "ws" {
					t.Errorf("entry = %q", lt.Spec.Topology.Entry)
				}
				c := lt.Spec.Topology.Nodes[0].Cluster
				if c.Mode != labsv1.ClusterModeVirtual || c.Context != "dev" {
					t.Errorf("cluster = %+v", c)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lt, err := Compile(tt.data, Options{})
			if err != nil {
				t.Fatalf("Compile: %v", err)
			}
			tt.check(t, lt)
		})
	}
}

func TestCompileInvalid(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want []string // substrings expected in the error
	}{
		{"not yaml", []byte("a: [b"), []string{"parse yaml"}},
		{"empty", []byte(""), []string{"empty document"}},
		{"duplicate key", mutate(minimalLab, "kind: Lab\n", "kind: Lab\nkind: Lab\n"), []string{"parse yaml", "already defined"}},
		{"multiple documents", append([]byte(minimalLab), []byte("---\nkind: Lab\n")...), []string{"single YAML document"}},
		{"wrong apiVersion", mutate(minimalLab, "cloudtrain.dev/v3", "cloudtrain.dev/v2"), []string{"/apiVersion"}},
		{"unknown field", mutate(minimalLab, "estimatedMinutes: 5}", "estimatedMinutes: 5, owner: x}"), []string{"/metadata", "owner"}},
		{"bad driver", mutate(minimalLab, "driver: container", "driver: lxc"), []string{"/spec/topology/nodes/0/driver"}},
		{"action with two bodies", mutate(minimalLab, `run: "touch`, `config: x, run: "touch`), []string{"/spec/solution/steps/0"}},
		{"check without skills", mutate(minimalLab, ", skills: [linux.files]", ""), []string{"skills"}},
		{"undefined param", mutate(minimalLab, "/tmp/{{file}}\n", "/tmp/{{nope}}\n"), []string{"undefined param {{nope}}"}},
		{"unknown action node", mutate(minimalLab, "{on: box, run", "{on: crate, run"), []string{"/spec/solution/steps/0/on", `unknown node "crate"`}},
		{"unknown entry", mutate(minimalLab, "  topology:\n", "  topology:\n    entry: ghost\n"), []string{"/spec/topology/entry"}},
		{"duplicate nodes", mutate(minimalLab, "access: [shell]}", "access: [shell]}\n      - {name: box, driver: container, image: x}"), []string{"duplicate node name"}},
		{"apply on container", mutate(minimalLab, `run: "touch /tmp/{{file}}"`, `apply: "kind: List"`), []string{"apply requires a k8s-cluster node"}},
		{"shell check without command", mutate(minimalLab, `, command: "test -f /tmp/{{file}}"`, ""), []string{"shell check requires command"}},
		{"learnerSudo on a non-entry node", mutate(minimalLab, "access: [shell]}", "access: [shell]}\n      - {name: side, driver: container, image: x, learnerSudo: true}"), []string{"/spec/topology/nodes/1/learnerSudo", "only allowed on the entry node"}},
		{"cluster on non-cluster node", mutate(minimalLab, "access: [shell]}", "access: [shell], cluster: {mode: kubeadm}}"), []string{"cluster is only allowed"}},
		{"int param without bounds", mutate(minimalLab, "{type: name, prefix: notes}", "{type: int}"), []string{"int param needs min and max"}},
		{"int default out of range", mutate(minimalLab, "{type: name, prefix: notes}", "{type: int, min: 1, max: 5, default: 9}"), []string{"/spec/params/file/default", "outside [min, max]"}},
		{"choice default not a value", mutate(minimalLab, "{type: name, prefix: notes}", "{type: choice, values: [a, b], default: c}"), []string{"/spec/params/file/default", "not one of the values"}},
		{"integer overflow", mutate(minimalLab, "{type: name, prefix: notes}", "{type: name, default: 99999999999999999999}"), []string{"out of range"}},
		{
			"kubeadm member and link checks",
			[]byte(`
apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: bad-k, title: K, domain: kubernetes, difficulty: hard, estimatedMinutes: 30}
spec:
  description: d
  topology:
    nodes:
      - {name: ws, driver: container, image: "jumphost:1"}
      - name: k
        driver: k8s-cluster
        cluster: {mode: kubeadm, nodes: [{name: w1, role: worker}, {name: cp2, role: control-plane, state: unjoined, labels: {a: b}}]}
    links:
      - {a: "ws:eth1", b: "k8s"}
      - {a: "ws:eth1", b: "ghost:eth0"}
  checks:
    - {id: c, description: c, type: k8s-query, query: {cluster: nope, resource: nodes}, skills: [s]}
    - {id: c, description: c, type: shell, command: "true", skills: [s]}
  solution:
    steps: [{on: k/w9, run: "true"}]
`),
			[]string{
				"kubeadm cluster needs exactly one control-plane node that is not unjoined",
				`unjoined node "cp2" is not registered at boot`,
				`endpoint "k8s" must be node:interface`,
				`interface "ws:eth1" already used`,
				`unknown node "ghost"`,
				`unknown cluster or context "nope"`,
				`duplicate check id "c"`,
				`"w9" is not a member of kubeadm cluster "k"`,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Compile(tt.data, Options{})
			if err == nil {
				t.Fatal("expected error")
			}
			for _, w := range tt.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error missing %q:\n%v", w, err)
				}
			}
		})
	}
}

// content-10: a missing object reads as empty output, so a k8s-query on a
// named object must not pass on "".
func TestNamedK8sQueryMustNotPassOnEmpty(t *testing.T) {
	lab := func(checks string) []byte {
		return []byte(`
apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: q, title: Q, domain: kubernetes, difficulty: easy, estimatedMinutes: 10}
spec:
  description: d
  topology:
    nodes:
      - {name: ws, driver: container, image: "jumphost:1"}
      - {name: dev, driver: k8s-cluster, cluster: {mode: virtual, context: dev}}
  solution:
    steps: [{on: ws, run: "true"}]
  checks:
` + checks)
	}
	bad := map[string]string{
		"exact empty":    `{match: exact, value: ""}`,
		"not_exact":      `{match: not_exact, value: "true"}`,
		"not_contains":   `{match: not_contains, value: "gvisor"}`,
		"regex optional": `{match: regex, value: '^(false)?$'}`,
	}
	for name, expect := range bad {
		t.Run(name, func(t *testing.T) {
			_, err := Compile(lab(`    - {id: c, description: c, type: k8s-query, skills: [s], query: {cluster: dev, resource: deployment, name: web, namespace: x, jsonpath: "{.spec.x}"}, expect: `+expect+`}
`), Options{})
			if err == nil || !strings.Contains(err.Error(), "passes on empty output") {
				t.Fatalf("err %v", err)
			}
		})
	}
	good := `    - {id: a, description: a, type: k8s-query, skills: [s], query: {cluster: dev, resource: deployment, name: web, namespace: x, jsonpath: "{.metadata.name}:{.spec.x}"}, expect: {match: exact, value: "web:"}}
    - {id: b, description: b, type: k8s-query, skills: [s], query: {cluster: dev, resource: node, name: n1, jsonpath: "{.metadata.name}:{.spec.unschedulable}"}, expect: {match: regex, value: '^n1:(false)?$'}}
    - {id: c, description: c, type: k8s-query, skills: [s], query: {cluster: dev, resource: pods, namespace: x, jsonpath: "{.items[*].spec.x}"}, expect: {match: exact, value: ""}}
`
	if _, err := Compile(lab(good), Options{}); err != nil {
		t.Fatalf("named checks that carry the name (and unnamed lists) are fine: %v", err)
	}
}

func TestValidationErrorType(t *testing.T) {
	err := Validate(mutate(minimalLab, "/tmp/{{file}}\n", "/tmp/{{nope}}\n"), Options{})
	var ve *ValidationError
	if !errors.As(err, &ve) || len(ve.Issues) != 1 || ve.Issues[0].Path != "/spec/description" {
		t.Fatalf("got %#v", err)
	}
}

func TestMinimalLabCompiles(t *testing.T) {
	if _, err := Compile([]byte(minimalLab), Options{}); err != nil {
		t.Fatal(err)
	}
}

func TestParamDecoding(t *testing.T) {
	// Extra keys the schema allows on params are accepted, and int64 values
	// beyond float64 precision stay exact.
	lt, err := Compile(mutate(minimalLab, "{type: name, prefix: notes}",
		"{type: int, min: 9007199254740990, max: 9007199254740999, default: 9007199254740993, description: big}"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if d := lt.Spec.Params["file"].Default; d == nil || *d != "9007199254740993" {
		t.Errorf("default = %v", d)
	}
}

func TestLearnerSudoOptIn(t *testing.T) {
	lt, err := Compile([]byte(minimalLab), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if lt.Spec.Topology.Nodes[0].LearnerSudo {
		t.Fatal("learnerSudo must default to false")
	}
	lt, err = Compile(mutate(minimalLab, "access: [shell]}", "access: [shell], learnerSudo: true}"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !lt.Spec.Topology.Nodes[0].LearnerSudo {
		t.Fatal("learnerSudo not compiled")
	}
}

func TestShellCheckDefaultTimeout(t *testing.T) {
	lt, err := Compile([]byte(minimalLab), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := lt.Spec.Checks[0].TimeoutSec; got != DefaultShellCheckTimeoutSec {
		t.Errorf("shell check default timeout = %d, want %d", got, DefaultShellCheckTimeoutSec)
	}
	lt, err = Compile(mutate(minimalLab, `command: "test -f /tmp/{{file}}"`, `command: "test -f /tmp/{{file}}", timeoutSec: 8`), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := lt.Spec.Checks[0].TimeoutSec; got != 8 {
		t.Errorf("explicit timeout = %d", got)
	}
}

func TestK8sCheckDefaultTimeout(t *testing.T) {
	for _, typ := range []string{"k8s-query", "k8s-can-i", "k8s-context"} {
		c := convertCheck(sourceCheck{ID: "q", Type: typ})
		if c.TimeoutSec != DefaultK8sCheckTimeoutSec {
			t.Errorf("%s default timeout = %d, want %d", typ, c.TimeoutSec, DefaultK8sCheckTimeoutSec)
		}
		eight := int32(8)
		if c := convertCheck(sourceCheck{ID: "q", Type: typ, TimeoutSec: &eight}); c.TimeoutSec != 8 {
			t.Errorf("%s explicit timeout = %d", typ, c.TimeoutSec)
		}
	}
	if c := convertCheck(sourceCheck{ID: "f", Type: "file"}); c.TimeoutSec != DefaultCheckTimeoutSec {
		t.Errorf("file default timeout = %d", c.TimeoutSec)
	}
}

// content-9: a check timeout above what the grader waits (300 s) or below 1 s
// is rejected instead of silently cut.
func TestCheckTimeoutBounds(t *testing.T) {
	for _, v := range []string{"0", "301", "600"} {
		doc := mutate(minimalLab, `command: "test -f /tmp/{{file}}", skills`, `command: "test -f /tmp/{{file}}", timeoutSec: `+v+`, skills`)
		if _, err := Compile(doc, Options{}); err == nil || !strings.Contains(err.Error(), "timeoutSec") {
			t.Errorf("timeoutSec %s: error %v", v, err)
		}
	}
	doc := mutate(minimalLab, `command: "test -f /tmp/{{file}}", skills`, `command: "test -f /tmp/{{file}}", timeoutSec: 300, skills`)
	if _, err := Compile(doc, Options{}); err != nil {
		t.Errorf("timeoutSec 300: %v", err)
	}
}

const inputsLab = `
apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: in-lab, title: In, domain: kubernetes, difficulty: easy, estimatedMinutes: 5}
spec:
  description: d
  topology:
    entry: ws
    nodes:
      - {name: ws, driver: container, image: "jumphost:1"}
      - {name: k, driver: k8s-cluster, cluster: {mode: virtual, context: qm}}
  checks:
    - id: cmp
      description: c
      type: shell
      on: k
      skills: [s]
      inputs: [{name: ANSWER, file: /home/learner/a.txt}]
      command: '[ "$ANSWER" = "$(kubectl get ns -o name | wc -l)" ] && echo ok'
  solution:
    steps: [{on: ws, run: "true"}]
`

func TestCheckInputsCompile(t *testing.T) {
	lt, err := Compile([]byte(inputsLab), Options{})
	if err != nil {
		t.Fatal(err)
	}
	c := lt.Spec.Checks[0]
	if len(c.Inputs) != 1 || c.Inputs[0] != (labsv1.CheckInput{Name: "ANSWER", File: "/home/learner/a.txt"}) || c.As != "" {
		t.Fatalf("inputs %+v as %q", c.Inputs, c.As)
	}
	lt, err = Compile(mutate(inputsLab, "      on: k\n", "      on: ws\n      as: learner\n", "inputs: [{name: ANSWER, file: /home/learner/a.txt}]", "inputs: [{name: ANSWER, on: ws, file: /home/learner/a.txt}]"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if c := lt.Spec.Checks[0]; c.As != labsv1.ActionAsLearner || c.Inputs[0].On != "ws" {
		t.Fatalf("as %q inputs %+v", c.As, c.Inputs)
	}
}

func TestCheckInputNamesAllowed(t *testing.T) {
	for _, n := range []string{"ANSWER", "REPORT", "MANIFEST", "ANSWER_POD", "REPORT_2", "MANIFEST_CRONJOB", "IN_TOKEN"} {
		if _, err := Compile(mutate(inputsLab, "name: ANSWER", "name: "+n), Options{}); err != nil {
			t.Errorf("%s: %v", n, err)
		}
	}
}

func TestCheckInputsInvalid(t *testing.T) {
	in := "inputs: [{name: ANSWER, file: /home/learner/a.txt}]"
	tests := []struct {
		name string
		data []byte
		want string
	}{
		{"reserved name", mutate(inputsLab, "name: ANSWER", "name: PATH"), `input name "PATH" is reserved`},
		// An allowlist (ANSWER, REPORT, MANIFEST, or those or IN with an
		// _SUFFIX), so variables tools read are refused without being listed.
		{"proxy", mutate(inputsLab, "name: ANSWER", "name: HTTPS_PROXY"), `input name "HTTPS_PROXY" is reserved`},
		{"no proxy", mutate(inputsLab, "name: ANSWER", "name: NO_PROXY"), "is reserved"},
		{"kuberc", mutate(inputsLab, "name: ANSWER", "name: KUBERC"), "is reserved"},
		{"pythonpath", mutate(inputsLab, "name: ANSWER", "name: PYTHONPATH"), "is reserved"},
		{"perl5lib", mutate(inputsLab, "name: ANSWER", "name: PERL5LIB"), "is reserved"},
		{"node options", mutate(inputsLab, "name: ANSWER", "name: NODE_OPTIONS"), "is reserved"},
		{"shellopts", mutate(inputsLab, "name: ANSWER", "name: SHELLOPTS"), "is reserved"},
		{"other word", mutate(inputsLab, "name: ANSWER", "name: GOT"), "is reserved"},
		{"bare IN", mutate(inputsLab, "name: ANSWER", "name: IN"), "is reserved"},
		{"proxy suffix", mutate(inputsLab, "name: ANSWER", "name: ANSWER_HTTPS_PROXY"), "is reserved"},
		{"reserved prefix", mutate(inputsLab, "name: ANSWER", "name: LD_PRELOAD"), "is reserved"},
		{"present suffix", mutate(inputsLab, "name: ANSWER", "name: ANSWER_PRESENT"), "is reserved"},
		{"lower-case name", mutate(inputsLab, "name: ANSWER", "name: got"), "/spec/checks/0/inputs/0/name"},
		{"duplicate name", mutate(inputsLab, in, "inputs: [{name: ANSWER, file: /a}, {name: ANSWER, file: /b}]"), `duplicate input name "ANSWER"`},
		{"relative file", mutate(inputsLab, "file: /home/learner/a.txt", "file: a.txt"), "/spec/checks/0/inputs/0/file"},
		{"unknown node", mutate(inputsLab, in, "inputs: [{name: ANSWER, on: ghost, file: /a}]"), `unknown node "ghost"`},
		{"cluster API node", mutate(inputsLab, in, "inputs: [{name: ANSWER, on: k, file: /a}]"), "is a cluster API"},
		{"cluster member", mutate(inputsLab, in, "inputs: [{name: ANSWER, on: k/cp, file: /a}]"), "input files are read from a container node"},
		{"vm node", mutate(inputsLab, in, "inputs: [{name: ANSWER, on: vm1, file: /a}]", "      - {name: k, driver: k8s-cluster", "      - {name: vm1, driver: vm, image: \"ubuntu:1\"}\n      - {name: k, driver: k8s-cluster"), "is a vm node"},
		{"inputs on k8s-query", mutate(inputsLab, "      type: shell\n", "      type: k8s-query\n      query: {cluster: k, resource: ns}\n"), "inputs are only allowed on shell checks"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Compile(tt.data, Options{})
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error %v; want %q", err, tt.want)
			}
		})
	}
}

// grading-1: a root (admin) check must never run kubectl with the learner's
// kubeconfig: a credential plugin in it would run as root.
func TestAdminCheckRejectsLearnerKubeconfig(t *testing.T) {
	for _, cmd := range []string{
		`kubectl --kubeconfig /home/learner/.kube/config --context qm get ns`,
		`KUBECONFIG=/home/learner/.kube/config kubectl get ns`,
		`want=$(kubectl --kubeconfig=~learner/.kube/config get svc)`,
		`helm --kubeconfig /home/learner/.kube/config list`,
		// Other clients that load a kubeconfig.
		`stern --kubeconfig /home/learner/.kube/config web`,
		`flux --kubeconfig /home/learner/.kube/config get all`,
		`istioctl --kubeconfig /home/learner/.kube/config proxy-status`,
		`velero --kubeconfig /home/learner/.kube/config backup get`,
		`k=/home/learner/.kube/config; terraform -chdir=/opt/x plan -var kubeconfig=$k`,
		// Any client at all: the kubeconfig is handed over by environment or flag.
		`KUBECONFIG=/home/learner/.kube/config some-new-client status`,
		`export KUBECONFIG="/home/learner/.kube/config"; ./check.sh`,
		`mytool --kubeconfig=/home/learner/.kube/config`,
	} {
		doc := mutate(inputsLab, `command: '[ "$ANSWER" = "$(kubectl get ns -o name | wc -l)" ] && echo ok'`, "command: '"+cmd+"'")
		if _, err := Compile(doc, Options{}); err == nil || !strings.Contains(err.Error(), "learner's kubeconfig") {
			t.Errorf("%s: error %v; want the learner-kubeconfig lint", cmd, err)
		}
		// The same command as the learner is allowed (its output is only
		// what the learner can do anyway).
		if _, err := Compile(mutate(string(doc), "      on: k\n", "      on: ws\n      as: learner\n"), Options{}); err != nil {
			t.Errorf("%s as learner: %v", cmd, err)
		}
	}
	// A .kube path that is not the learner's (no learner home anywhere) is fine.
	if _, err := Compile(mutate(inputsLab, `command: '[ "$ANSWER" = "$(kubectl get ns -o name | wc -l)" ] && echo ok'`, `command: 'kubectl --kubeconfig /root/.kube/config get ns'`), Options{}); err != nil {
		t.Errorf("root kubeconfig: %v", err)
	}
	// Reading the learner's kubeconfig without a Kubernetes client is fine.
	ok := mutate(inputsLab, `command: '[ "$ANSWER" = "$(kubectl get ns -o name | wc -l)" ] && echo ok'`, `command: 'yq .users /home/learner/.kube/config'`)
	if _, err := Compile(ok, Options{}); err != nil {
		t.Errorf("yq on the learner kubeconfig: %v", err)
	}
}

// grading-1: the lint reads the whole command (the kubeconfig and the client
// on different lines) and covers admin actions that can run after the
// learner had access (setup on reset, teardown, exam rerun).
func TestLearnerKubeconfigLintWholeCommandAndActions(t *testing.T) {
	orig := `command: '[ "$ANSWER" = "$(kubectl get ns -o name | wc -l)" ] && echo ok'`
	for _, cmd := range []string{
		"export KUBECONFIG=/home/learner/.kube/config\n        kubectl get ns",
		"k=/home/learner/.kube/config\n        kubectl --kubeconfig $k get ns",
		// The path built in pieces: a relative .kube after cd, or the home looked up.
		"cd /home/learner && kubectl --kubeconfig .kube/config get ns",
		"h=$(getent passwd learner | cut -d: -f6)\n        kubectl --kubeconfig \"$h/.kube/config\" get ns",
	} {
		doc := mutate(inputsLab, orig, "command: |\n        "+cmd)
		if _, err := Compile(doc, Options{}); err == nil || !strings.Contains(err.Error(), "learner's kubeconfig") {
			t.Errorf("%q: error %v; want the learner-kubeconfig lint", cmd, err)
		}
	}
	bad := "run: |\n        export KUBECONFIG=/home/learner/.kube/config\n        kubectl get ns"
	for name, block := range map[string]string{
		"setup":    "  setup:\n    - on: ws\n      " + bad + "\n",
		"teardown": "  teardown:\n    - on: ws\n      " + bad + "\n",
		"rerun":    "  exam:\n    rerun:\n      - on: ws\n        " + strings.ReplaceAll(bad, "\n        ", "\n          ") + "\n",
	} {
		t.Run(name, func(t *testing.T) {
			doc := mutate(inputsLab, "  checks:\n", block+"  checks:\n")
			_, err := Compile(doc, Options{})
			if err == nil || !strings.Contains(err.Error(), "learner's kubeconfig") {
				t.Fatalf("error %v; want the learner-kubeconfig lint", err)
			}
			if name == "rerun" {
				return
			}
			// As the learner it is their own kubeconfig: allowed.
			if _, err := Compile(mutate(string(doc), "    - on: ws\n      run:", "    - on: ws\n      as: learner\n      run:"), Options{}); err != nil {
				t.Errorf("as learner: %v", err)
			}
		})
	}
}
