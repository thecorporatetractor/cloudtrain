package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

const labsDir = "../../testdata/labs"

func TestCompile(t *testing.T) {
	cases := []struct {
		lab, name string
		args      []string
		contains  []string
		absent    []string
	}{
		{"net-ospf-two-routers", "net-ospf-two-routers-v1", nil,
			[]string{"kind: LabTemplate", "apiVersion: labs.cloudtrain.dev/v1alpha1", "{{octet}}", "driver: netdev"}, nil},
		{"net-ospf-two-routers", "net-ospf-two-routers-v1", []string{"--seed", "1234"},
			[]string{"labs.cloudtrain.dev/param.site: Tromso", "10.24.1.0/24"}, []string{"{{octet}}"}},
		{"k8s-kubeadm-worker-notready", "", nil, []string{"driver: k8s-cluster", "mode: kubeadm"}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.lab+strings.Join(tc.args, ""), func(t *testing.T) {
			var out, errb bytes.Buffer
			args := append([]string{"compile"}, tc.args...)
			args = append(args, filepath.Join(labsDir, tc.lab, "lab.yaml"))
			if code := run(args, &out, &errb); code != 0 {
				t.Fatalf("exit %d: %s", code, errb.String())
			}
			var lt labsv1.LabTemplate
			if err := yaml.UnmarshalStrict(out.Bytes(), &lt); err != nil {
				t.Fatalf("output is not a LabTemplate: %v", err)
			}
			if tc.name != "" && lt.Name != tc.name {
				t.Errorf("name = %s", lt.Name)
			}
			for _, s := range tc.contains {
				if !strings.Contains(out.String(), s) {
					t.Errorf("output lacks %q", s)
				}
			}
			for _, s := range tc.absent {
				if strings.Contains(out.String(), s) {
					t.Errorf("output contains %q", s)
				}
			}
		})
	}
}

func TestValidate(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run([]string{"validate", labsDir}, &out, &errb); code != 0 {
		t.Fatalf("exit %d: %s%s", code, out.String(), errb.String())
	}
	if !strings.Contains(out.String(), "0 failed") {
		t.Errorf("output = %s", out.String())
	}

	dir := t.TempDir()
	bad := filepath.Join(dir, "broken", "lab.yaml")
	_ = os.MkdirAll(filepath.Dir(bad), 0o755)
	_ = os.WriteFile(bad, []byte("apiVersion: cloudtrain.dev/v3\nkind: Lab\nmetadata: {id: x}\n"), 0o644)
	out.Reset()
	if code := run([]string{"validate", dir}, &out, &errb); code != 1 {
		t.Fatalf("exit %d for invalid lab", code)
	}
	if !strings.Contains(out.String(), "FAIL") {
		t.Errorf("output = %s", out.String())
	}
}

func TestUsage(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run(nil, &out, &errb); code != 2 {
		t.Errorf("exit %d", code)
	}
	if code := run([]string{"nope"}, &out, &errb); code != 2 {
		t.Errorf("exit %d", code)
	}
}
