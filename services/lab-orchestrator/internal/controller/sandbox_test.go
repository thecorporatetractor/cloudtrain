package controller

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func sandboxTemplate() *labsv1.LabTemplate {
	return &labsv1.LabTemplate{
		ObjectMeta: metav1.ObjectMeta{Name: "net-lab-v1", Namespace: ns},
		Spec: labsv1.LabTemplateSpec{
			Source: labsv1.LabSource{ID: "systemd-lab", Version: 1, Title: "t", Domain: "linux", Difficulty: "easy", EstimatedMinutes: 25},
			Topology: labsv1.Topology{
				Entry: "workstation",
				Nodes: []labsv1.Node{
					{Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1", Access: []labsv1.AccessType{labsv1.AccessShell}},
					{Name: "tr-pis-01", Driver: labsv1.DriverContainer, Image: "deb-sys:24.04", Access: []labsv1.AccessType{labsv1.AccessSSH},
						Resources: &labsv1.NodeResources{MemoryMiB: ptr.To[int64](1536)}},
				},
			},
			Setup:    []labsv1.Action{{On: "tr-pis-01", Run: ptr.To("systemctl start chrony")}},
			Checks:   []labsv1.Check{{ID: "c", Description: "d", Skills: []string{"s"}, Type: "shell"}},
			Solution: labsv1.Solution{Steps: []labsv1.Action{{On: "tr-pis-01", Run: ptr.To("true")}}},
		},
	}
}

func sandboxCatalog(t *testing.T) *drivers.ImageCatalog {
	t.Helper()
	c, err := drivers.ParseCatalog([]byte(`
images:
  jumphost:1: { kind: container, image: cloudtrain/jumphost:1 }
  deb-sys:24.04: { kind: container, image: cloudtrain/deb-sys:24.04, tier: B, systemd: true, vmFallback: ubuntu-vm:24.04 }
  ubuntu-vm:24.04: { kind: containerDisk, image: cloudtrain/ubuntu-vm:24.04, tier: C }
`))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

type sandboxHarness struct {
	*harness
	vm *fakeDriver
}

// newSandboxHarness: tier B sandboxed with kata-clh-runtime-rs (fallback
// kubevirt) when tiers is true; one Kata node; extra objects (e.g. the
// RuntimeClass).
func newSandboxHarness(t *testing.T, tiers bool, objs ...client.Object) *sandboxHarness {
	t.Helper()
	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "w1", Labels: map[string]string{"katacontainers.io/kata-runtime": "true"}}}
	h := newHarness(t, sandboxTemplate(), session(), node)
	for _, o := range objs {
		if err := h.c.Create(context.Background(), o); err != nil {
			t.Fatal(err)
		}
	}
	vm := newFakeDriver(labsv1.DriverVM)
	reg, err := drivers.NewRegistry(h.cont, hibernatingDriver{h.netdev}, vm)
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.r.Catalog = sandboxCatalog(t)
	if tiers {
		h.r.Sandboxes = &drivers.Sandboxes{Reader: h.c, Now: func() time.Time { return h.now },
			Tiers: map[string]drivers.SandboxTier{"B": {RuntimeClass: "kata-clh-runtime-rs"}}}
	}
	return &sandboxHarness{harness: h, vm: vm}
}

func kataRuntimeClass() *nodev1.RuntimeClass {
	return &nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: "kata-clh-runtime-rs"}, Handler: "kata-clh-runtime-rs",
		Scheduling: &nodev1.Scheduling{NodeSelector: map[string]string{"katacontainers.io/kata-runtime": "true"}}}
}

func recordedNode(s *labsv1.LabSession, name string) labsv1.Node {
	if s.Status.Topology != nil {
		for _, n := range s.Status.Topology.Nodes {
			if n.Name == name {
				return n
			}
		}
	}
	return labsv1.Node{}
}

func TestSandboxVMFallback(t *testing.T) {
	h := newSandboxHarness(t, true) // no RuntimeClass: the sandbox is unavailable
	h.reconcile()
	s := h.get()
	if s.Status.Phase != labsv1.SessionReady {
		t.Fatalf("phase = %s, %+v", s.Status.Phase, s.Status.Conditions)
	}
	if !slices.Contains(h.vm.provisioned, "tr-pis-01") || slices.Contains(h.cont.provisioned, "tr-pis-01") {
		t.Fatalf("tr-pis-01 provisioned by vm %v / container %v, want the VM driver", h.vm.provisioned, h.cont.provisioned)
	}
	rec := recordedNode(s, "tr-pis-01")
	if rec.Driver != labsv1.DriverVM || rec.Image != "ubuntu-vm:24.04" || *rec.Resources.MemoryMiB != 1536 {
		t.Fatalf("recorded node = %+v", rec)
	}
	c := cond(s, labsv1.ConditionSandboxed)
	if c == nil || c.Status != metav1.ConditionFalse || c.Reason != ReasonVMFallback || !strings.Contains(c.Message, "RuntimeClass kata-clh-runtime-rs not found") {
		t.Fatalf("Sandboxed = %+v", c)
	}
	if len(h.vm.execs) != 1 {
		t.Fatalf("setup ran %d action(s) on the VM driver, want 1", len(h.vm.execs))
	}
	// labctl verify / exam grading resolve the template themselves: the
	// executor follows the recorded node.
	eff := EffectiveTemplate(&sandboxTemplate().Spec, s)
	if n, _ := findNode(eff.Topology.Nodes, "tr-pis-01"); n.Driver != labsv1.DriverVM {
		t.Fatalf("effective template node = %+v", n)
	}
	if _, err := (&NodeExecutor{Drivers: h.r.Drivers, Session: s, Template: &sandboxTemplate().Spec}).RunAction(context.Background(), labsv1.Action{On: "tr-pis-01", Run: ptr.To("true")}); err != nil {
		t.Fatal(err)
	}
	if len(h.vm.execs) != 2 {
		t.Fatal("the executor did not use the VM driver")
	}

	// The sandbox comes back: the running session keeps its VM.
	if err := h.c.Create(context.Background(), kataRuntimeClass()); err != nil {
		t.Fatal(err)
	}
	h.now = h.now.Add(time.Hour)
	h.reconcile()
	if rec := recordedNode(h.get(), "tr-pis-01"); rec.Driver != labsv1.DriverVM {
		t.Fatalf("after the sandbox came back: %+v", rec)
	}
	if slices.Contains(h.cont.provisioned, "tr-pis-01") {
		t.Fatal("the node was moved to a container mid-session")
	}
}

func TestSandboxAvailable(t *testing.T) {
	h := newSandboxHarness(t, true, kataRuntimeClass())
	h.reconcile()
	s := h.get()
	if !slices.Contains(h.cont.provisioned, "tr-pis-01") || len(h.vm.provisioned) != 0 {
		t.Fatalf("provisioned container %v vm %v", h.cont.provisioned, h.vm.provisioned)
	}
	if c := cond(s, labsv1.ConditionSandboxed); c == nil || c.Status != metav1.ConditionTrue || c.Reason != ReasonSandboxed {
		t.Fatalf("Sandboxed = %+v", c)
	}
	if rec := recordedNode(s, "tr-pis-01"); rec.Driver != labsv1.DriverContainer {
		t.Fatalf("recorded = %+v", rec)
	}
}

func TestSandboxFallbackFail(t *testing.T) {
	h := newSandboxHarness(t, true)
	h.r.Sandboxes.Tiers["B"] = drivers.SandboxTier{RuntimeClass: "kata-clh-runtime-rs", Fallback: drivers.SandboxFallbackFail}
	h.reconcile()
	s := h.get()
	if len(h.vm.provisioned) != 0 || !slices.Contains(h.cont.provisioned, "tr-pis-01") {
		t.Fatalf("fallback fail: container %v vm %v", h.cont.provisioned, h.vm.provisioned)
	}
	if c := cond(s, labsv1.ConditionSandboxed); c == nil || c.Reason != ReasonSandboxUnavailable {
		t.Fatalf("Sandboxed = %+v", c)
	}
}

// Sandboxes unset: the default is unchanged (no rewrite, no condition).
func TestSandboxesOffUnchanged(t *testing.T) {
	h := newSandboxHarness(t, false, kataRuntimeClass())
	h.reconcile()
	s := h.get()
	if len(h.vm.provisioned) != 0 || !slices.Contains(h.cont.provisioned, "tr-pis-01") {
		t.Fatalf("off: container %v vm %v", h.cont.provisioned, h.vm.provisioned)
	}
	if c := cond(s, labsv1.ConditionSandboxed); c != nil {
		t.Fatalf("off: Sandboxed condition set: %+v", c)
	}
	if rec := recordedNode(s, "tr-pis-01"); rec.Driver != labsv1.DriverContainer || rec.Image != "deb-sys:24.04" {
		t.Fatalf("off: recorded %+v", rec)
	}
}
