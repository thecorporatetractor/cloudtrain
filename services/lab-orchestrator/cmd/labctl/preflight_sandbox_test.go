package main

import (
	"strings"
	"testing"

	nodev1 "k8s.io/api/node/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func rclass(name, handler string) nodev1.RuntimeClass {
	return nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: name}, Handler: handler}
}

func checkStatus(rep *pfReport, name string) string {
	for _, c := range rep.Checks {
		if c.Name == name {
			return c.Status
		}
	}
	return ""
}

func TestSandboxStaticNoKata(t *testing.T) {
	rep := &pfReport{}
	got := sandboxStatic([]nodev1.RuntimeClass{rclass("gvisor", "runsc")}, nil, nil, nil, rep)
	if len(got) != 0 {
		t.Fatalf("probe targets = %v, want none", got)
	}
	if s := checkStatus(rep, "sandbox/runtimeclasses"); s != pfWarn {
		t.Fatalf("runtimeclasses = %q, want WARN (tier B falls back to KubeVirt)", s)
	}
	if rep.failed() {
		t.Fatal("a cluster without Kata must not fail preflight")
	}
}

func TestSandboxStaticDetected(t *testing.T) {
	rcs := []nodev1.RuntimeClass{rclass("kata-clh-runtime-rs", "kata-clh-runtime-rs"), rclass("kata-vm-isolation", "kata"), rclass("runc", "runc")}
	rep := &pfReport{}
	got := sandboxStatic(rcs, nil, nil, nil, rep)
	if strings.Join(got, ",") != "kata-clh-runtime-rs,kata-vm-isolation" {
		t.Fatalf("probe targets = %v", got)
	}
	if s := checkStatus(rep, "sandbox/runtimeclasses"); s != pfPass {
		t.Fatalf("runtimeclasses = %q, want PASS", s)
	}
	if !strings.Contains(rep.Checks[0].Message, "AKS Pod Sandboxing") {
		t.Errorf("managed class not named: %s", rep.Checks[0].Message)
	}
	if s := checkStatus(rep, "sandbox/tiers"); s != pfWarn {
		t.Fatalf("tiers = %q, want WARN when nothing is mapped", s)
	}
}

func TestSandboxStaticTiers(t *testing.T) {
	rcs := []nodev1.RuntimeClass{rclass("kata-clh-runtime-rs", "kata-clh-runtime-rs")}
	tiers := map[string]string{"B": "kata-clh-runtime-rs", "A": "gvisor"}
	detected := map[string]string{"B": "kata-clh-runtime-rs"}
	dropped := map[string]string{"A": "RuntimeClass gvisor: not found"}
	rep := &pfReport{}
	got := sandboxStatic(rcs, tiers, detected, dropped, rep)
	if strings.Join(got, ",") != "kata-clh-runtime-rs" {
		t.Fatalf("probe targets = %v", got)
	}
	if s := checkStatus(rep, "sandbox/tier-A"); s != pfFail {
		t.Errorf("tier-A = %q, want FAIL for a mapped tier the cluster cannot run", s)
	}
	if s := checkStatus(rep, "sandbox/tier-B"); s != pfPass {
		t.Errorf("tier-B = %q, want PASS", s)
	}
}

func TestSandboxProbeResult(t *testing.T) {
	lab := "kernel 6.18.35-ct1\nmemkb 500000\nfeature dummy ok\nfeature gre ok\nfeature bond ok\nfeature vlan ok\nfeature wireguard ok\nfeature netem ok\nfeature md ok\n"
	stock := "kernel 6.18.35\nmemkb 2600000\nfeature dummy missing\nfeature gre missing\nfeature bond missing\nfeature vlan ok\nfeature wireguard missing\nfeature netem missing\nfeature md missing\n"
	cases := []struct {
		name, out, node string
		strict, vm      bool
		want            map[string]string
	}{
		{"lab kernel", lab, "7.0.0-1014-aws", true, true, map[string]string{
			"sandbox/probe rc": pfPass, "sandbox/probe rc features": pfPass, "sandbox/probe rc memory": pfPass}},
		{"stock kernel, mapped tier", stock, "7.0.0-1014-aws", true, true, map[string]string{
			"sandbox/probe rc features": pfFail, "sandbox/probe rc memory": pfWarn}},
		{"stock kernel, unmapped", stock, "7.0.0-1014-aws", false, true, map[string]string{"sandbox/probe rc features": pfWarn}},
		{"not a VM", strings.Replace(lab, "6.18.35-ct1", "7.0.0-1014-aws", 1), "7.0.0-1014-aws", true, false, map[string]string{"sandbox/probe rc": pfFail}},
		{"no output", "", "x", true, false, map[string]string{"sandbox/probe rc": pfFail}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rep := &pfReport{}
			if vm := sandboxProbeResult("rc", tc.node, tc.out, sandboxProbeLimit, tc.strict, rep); vm != tc.vm {
				t.Fatalf("isVM = %v, want %v", vm, tc.vm)
			}
			for name, want := range tc.want {
				if got := checkStatus(rep, name); got != want {
					t.Errorf("%s = %q, want %q (%+v)", name, got, want, rep.Checks)
				}
			}
		})
	}
}

func TestSandboxProbeScript(t *testing.T) {
	s := sandboxProbeScript()
	for _, f := range sandboxFeatures {
		if !strings.Contains(s, "feature "+f.name+" ok") {
			t.Errorf("script does not report %s", f.name)
		}
	}
}
