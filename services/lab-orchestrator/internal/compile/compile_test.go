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
				if s.Hints[0].Cost != 2 || s.Checks[0].TimeoutSec != DefaultCheckTimeoutSec {
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
        cluster: {mode: kubeadm, nodes: [{name: w1, role: worker}]}
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
				"kubeadm cluster needs at least one control-plane",
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
