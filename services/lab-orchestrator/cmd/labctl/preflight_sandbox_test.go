package main

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
	"sigs.k8s.io/yaml"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
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
	got, _ := sandboxStatic([]nodev1.RuntimeClass{rclass("gvisor", "runsc")}, nil, nil, rep)
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
	got, _ := sandboxStatic(rcs, nil, nil, rep)
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
	rcs := []nodev1.RuntimeClass{rclass("kata-clh-runtime-rs", "kata-clh-runtime-rs"), rclass("microvm", "gke-microvm")}
	tiers := map[string]drivers.SandboxTier{"B": {RuntimeClass: "kata-clh-runtime-rs"}, "A": {RuntimeClass: "gvisor"}, "C": {RuntimeClass: "microvm"}}
	states := map[string]drivers.SandboxState{
		"B": {Tier: "B", Available: true, Reason: "handler kata-clh-runtime-rs, 1 schedulable node(s)"},
		"A": {Tier: "A", Reason: "RuntimeClass gvisor not found"},
		"C": {Tier: "C", Reason: "RuntimeClass microvm has handler \"gke-microvm\", not a known VM sandbox"},
	}
	rep := &pfReport{}
	got, static := sandboxStatic(rcs, tiers, states, rep)
	if strings.Join(got, ",") != "kata-clh-runtime-rs,microvm" {
		t.Fatalf("probe targets = %v (a non-Kata handler is probed to prove it)", got)
	}
	if s := checkStatus(rep, "sandbox/tier-A"); s != pfFail || static["A"].failed == "" {
		t.Errorf("tier-A = %q, want FAIL for a tier the cluster cannot run", s)
	}
	if s := checkStatus(rep, "sandbox/tier-B"); s != pfPass {
		t.Errorf("tier-B = %q, want PASS", s)
	}
	if s := checkStatus(rep, "sandbox/tier-C"); s != pfWarn || static["C"].failed != "" {
		t.Errorf("tier-C = %q, want WARN until probed", s)
	}
}

func TestTierVerdict(t *testing.T) {
	cfg := drivers.SandboxTier{RuntimeClass: "rc", RequiredFeatures: []string{"gre"}}
	pass := &rcVerdict{probed: true, vm: true, kernel: "6.18.35-ct1", missing: []string{"md"}}
	if v := tierVerdict(cfg, tierStatic{rc: "rc", probe: true}, pass, "kata"); v.Result != drivers.PreflightPass || !v.VM || v.Handler != "kata" {
		t.Errorf("md missing but not required: %+v", v)
	}
	if v := tierVerdict(drivers.SandboxTier{RuntimeClass: "rc"}, tierStatic{rc: "rc", probe: true}, pass, "kata"); v.Result != drivers.PreflightFail {
		t.Errorf("md missing and every feature required: %+v", v)
	}
	link := &rcVerdict{probed: true, vm: true, failed: []string{"probe rc link: 1400-byte frames fail"}}
	if v := tierVerdict(cfg, tierStatic{rc: "rc", probe: true}, link, "kata"); v.Result != drivers.PreflightFail || !strings.Contains(v.Message, "1400") {
		t.Errorf("link failure: %+v", v)
	}
	if v := tierVerdict(cfg, tierStatic{rc: "rc", probe: true}, nil, "kata"); v.Result != drivers.PreflightUnprobed {
		t.Errorf("no probe: %+v", v)
	}
	if v := tierVerdict(cfg, tierStatic{rc: "rc", failed: "RuntimeClass rc not found"}, nil, ""); v.Result != drivers.PreflightFail {
		t.Errorf("static failure: %+v", v)
	}
	if v := tierVerdict(cfg, tierStatic{rc: "rc", probe: true}, &rcVerdict{probed: true}, "runc"); v.Result != drivers.PreflightFail || v.VM {
		t.Errorf("not a VM: %+v", v)
	}
}

// Host devices in a privileged guest (or a refused privileged probe pod) make
// the tier unsafe for privileged pods only: it still passes, for unprivileged
// labs, and the manager maps PrivilegedUnsafe to "not VM-trusted".
func TestTierVerdictPrivilegedUnsafe(t *testing.T) {
	cfg := drivers.SandboxTier{RuntimeClass: "rc", RequiredFeatures: []string{"gre"}}
	for _, why := range []string{
		"a privileged pod sees 2 more block devices than an unprivileged one (vda sda nvme0n1 vs vda): host devices are passed into the VM",
		"privileged pods unsupported: pod privileged not running in RuntimeClass rc",
	} {
		v := tierVerdict(cfg, tierStatic{rc: "rc", probe: true}, &rcVerdict{probed: true, vm: true, kernel: "6.18.35-ct1", privilegedUnsafe: why}, "kata")
		if v.Result != drivers.PreflightPass || v.PrivilegedUnsafe != why || !strings.Contains(v.Message, "unprivileged pods only") {
			t.Errorf("%s: %+v", why, v)
		}
	}
	v := tierVerdict(cfg, tierStatic{rc: "rc", probe: true}, &rcVerdict{probed: true, vm: true, privilegedUnsafe: "x", failed: []string{"probe rc link: no frames"}}, "kata")
	if v.Result != drivers.PreflightFail || v.PrivilegedUnsafe != "x" {
		t.Errorf("a real failure still fails the tier: %+v", v)
	}
	if v := tierVerdict(cfg, tierStatic{rc: "rc", probe: true}, &rcVerdict{probed: true, vm: true}, "kata"); v.PrivilegedUnsafe != "" {
		t.Errorf("clean probe: %+v", v)
	}
}

// fakeExec answers the block-device script per pod name.
type fakeExec struct {
	out map[string]string
	err map[string]error
}

func (f *fakeExec) Exec(_ context.Context, _, pod, _ string, _ []string, _ io.Reader, stdout, _ io.Writer) error {
	if err := f.err[pod]; err != nil {
		return err
	}
	_, err := io.WriteString(stdout, f.out[pod])
	return err
}

// hostDevicesProbe returns a probe whose fake API server runs every pod at
// once, unless createErr refuses it.
func hostDevicesProbe(t *testing.T, ex *fakeExec, createErr error) (*sandboxProbe, client.Client) {
	t.Helper()
	c := fake.NewClientBuilder().WithInterceptorFuncs(interceptor.Funcs{
		Create: func(ctx context.Context, c client.WithWatch, obj client.Object, opts ...client.CreateOption) error {
			if pod, ok := obj.(*corev1.Pod); ok {
				if createErr != nil {
					return createErr
				}
				pod.Status.Phase, pod.Status.PodIP = corev1.PodRunning, "10.0.0.9"
			}
			return c.Create(ctx, obj, opts...)
		},
	}).Build()
	return &sandboxProbe{c: c, ex: ex, toolsImage: "tools", timeout: time.Minute, logf: t.Logf}, c
}

func TestHostDevices(t *testing.T) {
	forbidden := apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "privileged", errors.New("privileged containers are not allowed"))
	cases := []struct {
		name      string
		unpriv    []string
		out       string
		execErr   error
		createErr error
		unsafe    string // substring of privilegedUnsafe; "" = trusted
		status    string
	}{
		{"same devices", []string{"vda"}, "blockdevs vda\n", nil, nil, "", pfPass},
		{"host disks", []string{"vda"}, "blockdevs vda sda nvme0n1\n", nil, nil, "2 more block devices", pfWarn},
		{"privileged pod refused", []string{"vda"}, "", nil, forbidden, "privileged pods unsupported", pfWarn},
		{"exec fails", []string{"vda"}, "", errors.New("container not found"), nil, "privileged probe exec", pfWarn},
		{"no blockdevs line", []string{"vda"}, "kernel 6.18\n", nil, nil, "privileged probe printed no block devices", pfWarn},
		{"unprivileged output unreadable", nil, "blockdevs vda\n", nil, nil, "unprivileged probe printed no block devices", pfWarn},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ex := &fakeExec{out: map[string]string{"privileged": tc.out}, err: map[string]error{"privileged": tc.execErr}}
			p, c := hostDevicesProbe(t, ex, tc.createErr)
			v, rep := &rcVerdict{probed: true, vm: true}, &pfReport{}
			p.hostDevices(context.Background(), "ns", "kata", tc.unpriv, v, rep)
			if len(v.failed) != 0 {
				t.Errorf("host devices must never fail the tier: %v", v.failed)
			}
			if tc.unsafe == "" && v.privilegedUnsafe != "" || tc.unsafe != "" && !strings.Contains(v.privilegedUnsafe, tc.unsafe) {
				t.Errorf("privilegedUnsafe = %q, want %q", v.privilegedUnsafe, tc.unsafe)
			}
			if got := checkStatus(rep, "sandbox/probe kata host devices"); got != tc.status {
				t.Errorf("status = %q, want %q (%+v)", got, tc.status, rep.Checks)
			}
			pods := &corev1.PodList{}
			if err := c.List(context.Background(), pods); err != nil || len(pods.Items) != 0 {
				t.Errorf("the privileged probe pod must be deleted after the comparison: %v %v", pods.Items, err)
			}
		})
	}
}

// The ConfigMap labctl writes is what the manager parses.
func TestSandboxConfigMapRoundTrip(t *testing.T) {
	pf := &drivers.SandboxPreflight{APIVersion: drivers.SandboxAPIVersion, Kind: drivers.SandboxPreflightKind,
		Tiers: map[string]drivers.SandboxPreflightTier{"B": {RuntimeClass: "kata-clh-runtime-rs", Handler: "kata-clh-runtime-rs", Result: drivers.PreflightPass, VM: true, Kernel: "6.18.35-ct1"}}}
	b, err := sandboxConfigMap(pf, "cloudtrain-system/lab-sandbox-preflight")
	if err != nil {
		t.Fatal(err)
	}
	var cm struct {
		Kind     string            `json:"kind"`
		Metadata map[string]any    `json:"metadata"`
		Data     map[string]string `json:"data"`
	}
	if err := yaml.Unmarshal(b, &cm); err != nil || cm.Kind != "ConfigMap" || cm.Metadata["namespace"] != "cloudtrain-system" {
		t.Fatalf("%s: %v", b, err)
	}
	got, err := drivers.ParseSandboxPreflight(b)
	if err != nil || got.Tiers["B"].Kernel != "6.18.35-ct1" || !got.Tiers["B"].VM {
		t.Fatalf("manager parse: %+v, %v", got, err)
	}
	if _, err := sandboxConfigMap(pf, "nonamespace"); err == nil {
		t.Fatal("want error for a name without namespace")
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
		{"node kernel unknown", lab, "", true, false, map[string]string{"sandbox/probe rc": pfFail}},
		{"node boot id", "bootid node-boot\n" + lab, "7.0.0-1014-aws", true, false, map[string]string{"sandbox/probe rc": pfFail}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rep := &pfReport{}
			var required []string
			if tc.strict {
				required = requiredFeatures(drivers.SandboxTier{})
			}
			if res := sandboxProbeResult("rc", corev1.NodeSystemInfo{KernelVersion: tc.node, BootID: "node-boot"}, tc.out, sandboxProbeLimit, required, rep); res.vm != tc.vm {
				t.Fatalf("isVM = %v, want %v", res.vm, tc.vm)
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
	for _, f := range drivers.SandboxFeatures {
		if !strings.Contains(s, "feature "+f.Name+" ok") {
			t.Errorf("script does not report %s", f.Name)
		}
	}
}

func TestSandboxProbeScriptListsBlockDevices(t *testing.T) {
	if !strings.Contains(sandboxProbeScript(), "echo blockdevs $(ls /sys/block") {
		t.Fatal("the unprivileged probe must list the guest's block devices")
	}
	out := "kernel 6.18.35-ct1\nblockdevs vda pmem0\nmemkb 500000\n"
	if got := parseBlockDevs(out); strings.Join(got, ",") != "vda,pmem0" {
		t.Fatalf("parseBlockDevs = %v", got)
	}
	if got := parseBlockDevs("blockdevs\n"); got == nil || len(got) != 0 {
		t.Fatalf("an empty list is not a missing one: %#v", got)
	}
	if parseBlockDevs("kernel x\n") != nil {
		t.Fatal("no blockdevs line must be nil")
	}
}

func TestHostDeviceVerdict(t *testing.T) {
	cases := []struct {
		name         string
		unpriv, priv []string
		extra        int
	}{
		{"same guest devices", []string{"vda", "pmem0"}, []string{"vda", "pmem0"}, 0},
		{"names differ, same count", []string{"vda"}, []string{"vdb"}, 0},
		{"host disks hot-plugged", []string{"vda"}, []string{"vda", "sda", "nvme0n1"}, 2},
		{"no devices at all", []string{}, []string{}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			extra, msg := hostDeviceVerdict(tc.unpriv, tc.priv)
			if extra != tc.extra {
				t.Fatalf("extra = %d, want %d (%s)", extra, tc.extra, msg)
			}
			if extra > 0 && !strings.Contains(msg, "host devices are passed into the VM") {
				t.Errorf("message does not say why: %s", msg)
			}
		})
	}
}
