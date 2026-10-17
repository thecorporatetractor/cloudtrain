package compile

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const assetLab = `
apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: asset-lab, title: Asset, domain: linux, difficulty: easy, estimatedMinutes: 5}
spec:
  description: Run the script
  topology: {nodes: [{name: box, driver: container, image: "jumphost:1"}]}
  setup:
    - on: box
      file: {path: /opt/run.sh, source: assets/run.sh, mode: "0755"}
  checks:
    - {id: ran, description: Ran, skills: [linux.shell], type: shell, on: box, command: "test -f /tmp/ran"}
  misconceptions:
    - id: wrong-file
      description: Touches the wrong file
      mutation: {on: box, run: touch /tmp/other}
      expectFail: [ran]
  solution:
    steps: [{on: box, run: /opt/run.sh}]
    alternatives:
      - id: by-hand
        description: Touch the file directly
        steps: [{on: box, run: touch /tmp/ran}]
`

func writeLab(t *testing.T, lab string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "run.sh"), []byte("#!/bin/sh\ntouch /tmp/ran\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "lab.yaml")
	if err := os.WriteFile(path, []byte(lab), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestFileSourceInlined(t *testing.T) {
	lt, err := CompileFile(writeLab(t, assetLab), Options{})
	if err != nil {
		t.Fatal(err)
	}
	f := lt.Spec.Setup[0].File
	if f == nil || f.Content != "#!/bin/sh\ntouch /tmp/ran\n" {
		t.Fatalf("asset not inlined: %+v", f)
	}
	if got := lt.Spec.Misconceptions[0].ExpectFail; len(got) != 1 || got[0] != "ran" {
		t.Fatalf("expectFail = %v", got)
	}
	if alts := lt.Spec.Solution.Alternatives; len(alts) != 1 || alts[0].ID != "by-hand" || len(alts[0].Steps) != 1 {
		t.Fatalf("alternatives = %+v", alts)
	}
}

func TestFileSourceNeedsBaseDir(t *testing.T) {
	_, err := Compile([]byte(assetLab), Options{})
	var ve *ValidationError
	if !errors.As(err, &ve) || !strings.Contains(err.Error(), "file.source needs the lab directory") {
		t.Fatalf("want base dir issue, got %v", err)
	}
}

func TestFileSourceMissingAsset(t *testing.T) {
	lab := strings.Replace(assetLab, "assets/run.sh", "assets/missing.sh", 1)
	_, err := CompileFile(writeLab(t, lab), Options{})
	if err == nil || !strings.Contains(err.Error(), "read asset") {
		t.Fatalf("want read asset issue, got %v", err)
	}
}

func TestExpectFailUnknownCheck(t *testing.T) {
	lab := strings.Replace(assetLab, "expectFail: [ran]", "expectFail: [nope]", 1)
	_, err := CompileFile(writeLab(t, lab), Options{})
	if err == nil || !strings.Contains(err.Error(), `unknown check id "nope"`) {
		t.Fatalf("want unknown check id issue, got %v", err)
	}
}

// The content packs must always compile with the orchestrator, not only
// pass lab-verify.
func TestContentPacksCompile(t *testing.T) {
	paths, err := filepath.Glob("../../../../content/packs/*/labs/*/lab.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Skip("no content packs found")
	}
	for _, p := range paths {
		if _, err := CompileFile(p, Options{}); err != nil {
			t.Errorf("%v", err)
		}
	}
}

func TestCompileExamRerun(t *testing.T) {
	lt, err := CompileFile("../../testdata/exams/tasks/xt-configmap-key/lab.yaml", Options{})
	if err != nil {
		t.Fatal(err)
	}
	if lt.Spec.Exam == nil || len(lt.Spec.Exam.Rerun) != 1 || lt.Spec.Exam.Rerun[0].On != "workstation" || lt.Spec.Exam.Rerun[0].As != "learner" {
		t.Fatalf("exam = %+v", lt.Spec.Exam)
	}
	bad := []byte(`apiVersion: cloudtrain.dev/v3
kind: Lab
metadata: {id: x, title: x, domain: kubernetes, difficulty: easy, estimatedMinutes: 1}
spec:
  description: x
  topology: {nodes: [{name: ws, driver: container}]}
  checks: [{id: c, description: c, type: shell, skills: [s]}]
  solution: {steps: [{on: ws, run: "true"}]}
  exam: {rerun: [{on: nowhere, run: "true"}]}
`)
	if _, err := Compile(bad, Options{}); err == nil || !strings.Contains(err.Error(), "/spec/exam/rerun/0") {
		t.Fatalf("rerun on unknown node: %v", err)
	}
}

// file.source assets are inlined at compile time and then templated like
// every other string of the lab: {{param}} is substituted per seed and an
// unknown placeholder is a validation error (lab.schema.json documents it).
func TestFileSourceIsTemplated(t *testing.T) {
	lab := strings.Replace(assetLab, "  description: Run the script\n",
		"  description: Run the script\n  params:\n    who: {type: choice, values: [ada]}\n", 1)
	path := writeLab(t, lab)
	asset := filepath.Join(filepath.Dir(path), "assets", "run.sh")
	if err := os.WriteFile(asset, []byte("#!/bin/sh\necho {{ who }} > /tmp/ran\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	lt, err := CompileFile(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	spec, _, err := Resolve(&lt.Spec, 1, ResolveOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if got := spec.Setup[0].File.Content; got != "#!/bin/sh\necho ada > /tmp/ran\n" {
		t.Errorf("asset not templated: %q", got)
	}
	if err := os.WriteFile(asset, []byte("echo {{nope}}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := CompileFile(path, Options{}); err == nil || !strings.Contains(err.Error(), "undefined param {{nope}}") {
		t.Errorf("unknown placeholder in an asset: %v", err)
	}
}

// "{{ name }}" with inner whitespace and an undeclared name is literal text (Jinja in
// Ansible playbooks and templates); a declared name is substituted in either spelling,
// and "{{name}}" without whitespace must still name a declared param.
func TestSpacedUndeclaredPlaceholderIsLiteral(t *testing.T) {
	lab := strings.Replace(assetLab, "  description: Run the script\n",
		"  description: Run the script\n  params:\n    who: {type: choice, values: [ada]}\n", 1)
	path := writeLab(t, lab)
	asset := filepath.Join(filepath.Dir(path), "assets", "run.sh")
	body := "- debug: msg=\"{{ inventory_hostname }} {{ item.name }} {{ who }} {{who}} {{ x | upper }}\"\n"
	if err := os.WriteFile(asset, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	lt, err := CompileFile(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	spec, _, err := Resolve(&lt.Spec, 1, ResolveOptions{})
	if err != nil {
		t.Fatal(err)
	}
	want := "- debug: msg=\"{{ inventory_hostname }} {{ item.name }} ada ada {{ x | upper }}\"\n"
	if got := spec.Setup[0].File.Content; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if err := os.WriteFile(asset, []byte("echo {{inventory_hostname}}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := CompileFile(path, Options{}); err == nil || !strings.Contains(err.Error(), "undefined param {{inventory_hostname}}") {
		t.Errorf("unspaced unknown placeholder: %v", err)
	}
}
