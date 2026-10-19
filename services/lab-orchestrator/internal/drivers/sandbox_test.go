package drivers

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func sandboxCatalog(t *testing.T) *ImageCatalog {
	t.Helper()
	c, err := ParseCatalog([]byte(`
images:
  deb-sys:24.04: { kind: container, image: cloudtrain/deb-sys:24.04, tier: B, systemd: true, vmFallback: ubuntu-vm:24.04 }
  el-sys:10: { kind: container, image: cloudtrain/el-sys:10, tier: B, systemd: true }
  dind:28: { kind: container, image: docker:28-dind, tier: B, privileged: true, vmFallback: docker-vm:28 }
  deb-tools:1: { kind: container, image: cloudtrain/deb-tools:1, tier: B }
  el-lab:10: { kind: container, image: cloudtrain/el-lab:10, tier: A, userNamespace: true }
  ubuntu-vm:24.04: { kind: containerDisk, image: cloudtrain/ubuntu-vm:24.04, tier: C }
  docker-vm:28: { kind: containerDisk, image: cloudtrain/docker-vm:28, tier: C }
  jumphost:1: { kind: container, image: cloudtrain/jumphost:1 }
`))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

const katalabel = "katacontainers.io/kata-runtime"

func kataRC(name, handler string) *nodev1.RuntimeClass {
	return &nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: name}, Handler: handler,
		Scheduling: &nodev1.Scheduling{NodeSelector: map[string]string{katalabel: "true"}}}
}

func kataNode() *corev1.Node {
	return &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "w1", Labels: map[string]string{katalabel: "true"}}}
}

func sandboxesB(fallback string) map[string]SandboxTier {
	return map[string]SandboxTier{"B": {RuntimeClass: "kata-clh-runtime-rs", Fallback: fallback}}
}

func TestParseSandboxFlag(t *testing.T) {
	m, err := ParseSandboxFlag(" B=kata-clh-runtime-rs , A=gvisor:fail")
	if err != nil || len(m) != 2 || m["B"].RuntimeClass != "kata-clh-runtime-rs" || m["B"].FallbackMode() != SandboxFallbackKubeVirt ||
		m["A"].RuntimeClass != "gvisor" || m["A"].FallbackMode() != SandboxFallbackFail {
		t.Fatalf("got %+v, %v", m, err)
	}
	if m, err := ParseSandboxFlag(""); err != nil || len(m) != 0 {
		t.Fatalf("empty: %v, %v", m, err)
	}
	for _, bad := range []string{"B", "B=", "=kata", "B=a,B=b", "Z=kata", "B=Kata_Bad", "B=kata:later", "B=kata:"} {
		if _, err := ParseSandboxFlag(bad); err == nil {
			t.Errorf("%q: want error", bad)
		}
	}
	legacy, err := ParseTierRuntimeClasses("B=kata-clh")
	if err != nil || legacy["B"].FallbackMode() != SandboxFallbackFail {
		t.Fatalf("legacy flag = %+v, %v; want fallback fail (the prototype's behaviour)", legacy, err)
	}
	if _, err := ParseTierRuntimeClasses("B=kata-clh:kubevirt"); err == nil {
		t.Fatal("legacy flag with a fallback: want error")
	}
}

func TestParseSandboxConfig(t *testing.T) {
	doc := `apiVersion: labs.cloudtrain.dev/v1alpha1
kind: SandboxConfig
tiers:
  B: {runtimeClass: kata-clh-runtime-rs, fallback: kubevirt, requiredFeatures: [gre, md]}
`
	c, err := ParseSandboxConfig([]byte(doc))
	if err != nil || c.Tiers["B"].RuntimeClass != "kata-clh-runtime-rs" || len(c.Tiers["B"].RequiredFeatures) != 2 {
		t.Fatalf("got %+v, %v", c, err)
	}
	// The same inside a ConfigMap (kubectl get cm -o yaml).
	cm := "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: x}\ndata:\n  sandboxes.yaml: |\n" + indent(doc, "    ")
	if c, err := ParseSandboxConfig([]byte(cm)); err != nil || c.Tiers["B"].RuntimeClass != "kata-clh-runtime-rs" {
		t.Fatalf("ConfigMap: %+v, %v", c, err)
	}
	for _, bad := range []string{
		"tiers: {B: {runtimeClass: kata, fallback: maybe}}",
		"tiers: {Q: {runtimeClass: kata}}",
		"tiers: {B: {runtimeClass: kata, requiredFeatures: [teleport]}}",
		"tiers: {B: {runtimeClass: kata, extra: 1}}",
		"kind: Other\ntiers: {}",
	} {
		if _, err := ParseSandboxConfig([]byte(bad)); err == nil {
			t.Errorf("%q: want error", bad)
		}
	}
	pf, err := ParseSandboxPreflight([]byte("kind: SandboxPreflight\ntiers:\n  B: {runtimeClass: microvm, handler: gvisor-vm, result: pass, vm: true, kernel: 6.6}\n"))
	if err != nil || !pf.Tiers["B"].VM {
		t.Fatalf("preflight: %+v, %v", pf, err)
	}
	if _, err := ParseSandboxPreflight([]byte("tiers: {B: {runtimeClass: x, result: maybe}}")); err == nil {
		t.Fatal("preflight with an unknown result: want error")
	}
}

func indent(s, p string) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	for i := range lines {
		lines[i] = p + lines[i]
	}
	return strings.Join(lines, "\n") + "\n"
}

// sandboxDriver is a container driver with tier B sandboxed.
func sandboxDriver(t *testing.T, tiers map[string]SandboxTier, pf *SandboxPreflight, objs ...client.Object) (*ContainerDriver, client.Client) {
	d, c := newContainerDriver(t, objs...)
	d.Catalog = sandboxCatalog(t)
	if tiers != nil {
		d.Sandboxes = &Sandboxes{Tiers: tiers, Preflight: pf, Reader: c}
	}
	return d, c
}

func TestApplySandbox(t *testing.T) {
	katart := kataRC("kata-clh-runtime-rs", "kata-clh-runtime-rs")
	// A RuntimeClass with a Kata name and the host runtime: never trusted.
	impostor := kataRC("kata-clh-runtime-rs", "runc")
	microvm := kataRC("kata-clh-runtime-rs", "microvm")
	proven := &SandboxPreflight{Tiers: map[string]SandboxPreflightTier{"B": {RuntimeClass: "kata-clh-runtime-rs", Handler: "microvm", Result: PreflightPass, VM: true}}}
	failed := &SandboxPreflight{Tiers: map[string]SandboxPreflightTier{"B": {RuntimeClass: "kata-clh-runtime-rs", Handler: "kata-clh-runtime-rs", Result: PreflightFail, Message: "guest kernel lacks gre"}}}
	cases := []struct {
		name, image string
		tiers       map[string]SandboxTier
		pf          *SandboxPreflight
		objs        []client.Object
		wantRC      string // "" = the driver default (kata, --runtime-class)
		wantPriv    bool
		wantProbe   bool
		wantErr     bool
	}{
		{"off: plain image unchanged", "deb-tools:1", nil, nil, nil, "kata", false, false, false},
		{"off: systemd image refused", "deb-sys:24.04", nil, nil, nil, "", false, false, true},
		{"off: privileged image refused", "dind:28", nil, nil, nil, "", false, false, true},
		{"tier B plain image", "deb-tools:1", sandboxesB(""), nil, []client.Object{katart, kataNode()}, "kata-clh-runtime-rs", false, false, false},
		{"tier B systemd image privileged in the sandbox", "deb-sys:24.04", sandboxesB(""), nil, []client.Object{katart, kataNode()}, "kata-clh-runtime-rs", true, true, false},
		{"tier B privileged image in the sandbox", "dind:28", sandboxesB(""), nil, []client.Object{katart, kataNode()}, "kata-clh-runtime-rs", true, false, false},
		{"tier A not sandboxed", "el-lab:10", sandboxesB(""), nil, []client.Object{katart, kataNode()}, "kata", false, false, false},
		{"RuntimeClass missing: systemd refused", "deb-sys:24.04", sandboxesB(""), nil, []client.Object{kataNode()}, "", false, false, true},
		{"RuntimeClass missing: plain image on the default runtime", "deb-tools:1", sandboxesB(""), nil, []client.Object{kataNode()}, "kata", false, false, false},
		{"no Kata node: systemd refused", "deb-sys:24.04", sandboxesB(""), nil, []client.Object{katart}, "", false, false, true},
		{"kata-named RuntimeClass with handler runc: refused", "deb-sys:24.04", sandboxesB(""), nil, []client.Object{impostor, kataNode()}, "", false, false, true},
		{"non-Kata handler, unproven: refused", "deb-sys:24.04", sandboxesB(""), nil, []client.Object{microvm, kataNode()}, "", false, false, true},
		{"non-Kata handler, unproven: unprivileged pods use it", "deb-tools:1", sandboxesB(""), nil, []client.Object{microvm, kataNode()}, "kata-clh-runtime-rs", false, false, false},
		{"handler runc proven by a forged preflight: still refused", "deb-sys:24.04", sandboxesB(""),
			&SandboxPreflight{Tiers: map[string]SandboxPreflightTier{"B": {RuntimeClass: "kata-clh-runtime-rs", Handler: "runc", Result: PreflightPass, VM: true}}},
			[]client.Object{impostor, kataNode()}, "", false, false, true},
		{"non-Kata handler proven by preflight", "deb-sys:24.04", sandboxesB(""), proven, []client.Object{microvm, kataNode()}, "kata-clh-runtime-rs", true, true, false},
		{"preflight failed the tier: refused", "deb-sys:24.04", sandboxesB(""), failed, []client.Object{katart, kataNode()}, "", false, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			d, c := sandboxDriver(t, tc.tiers, tc.pf, tc.objs...)
			ref := tierARef(tc.image)
			_, err := d.Provision(ctx, ref)
			pod := &corev1.Pod{}
			getErr := c.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, pod)
			if tc.wantErr {
				if !errors.Is(err, ErrUnsupported) {
					t.Fatalf("err = %v, want ErrUnsupported", err)
				}
				if getErr == nil {
					t.Fatalf("a refused node must not get a pod: %+v", pod.Spec)
				}
				return
			}
			if err != nil || getErr != nil {
				t.Fatal(err, getErr)
			}
			if got := ptr.Deref(pod.Spec.RuntimeClassName, ""); got != tc.wantRC {
				t.Fatalf("runtimeClassName = %q, want %q", got, tc.wantRC)
			}
			if podHasPrivileged(pod) != tc.wantPriv {
				t.Fatalf("privileged = %v, want %v", podHasPrivileged(pod), tc.wantPriv)
			}
			if hasProbe := pod.Spec.Containers[0].ReadinessProbe != nil; hasProbe != tc.wantProbe {
				t.Fatalf("systemd readiness probe = %v, want %v", hasProbe, tc.wantProbe)
			}
			if tc.tiers == nil && pod.Annotations[AnnotationSandbox] != "" {
				t.Fatalf("sandboxes off must not annotate: %v", pod.Annotations)
			}
		})
	}
}

// The availability is cached for the TTL, but a privileged container is only
// created after a fresh check: a RuntimeClass deleted (or replaced by a host
// runtime) in between refuses the node.
func TestPrivilegedReverifiedBeforeCreate(t *testing.T) {
	for _, swap := range []string{"deleted", "handler runc"} {
		t.Run(swap, func(t *testing.T) {
			ctx := context.Background()
			rc := kataRC("kata-clh-runtime-rs", "kata-clh-runtime-rs")
			d, c := sandboxDriver(t, sandboxesB(""), nil, rc, kataNode())
			d.Sandboxes.TTL = time.Hour
			if st := d.Sandboxes.States(ctx)["B"]; !st.Available {
				t.Fatalf("B unavailable: %s", st.Reason)
			}
			cur := &nodev1.RuntimeClass{}
			if err := c.Get(ctx, client.ObjectKey{Name: rc.Name}, cur); err != nil {
				t.Fatal(err)
			}
			if swap == "deleted" {
				if err := c.Delete(ctx, cur); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := c.Delete(ctx, cur); err != nil {
					t.Fatal(err)
				}
				if err := c.Create(ctx, kataRC("kata-clh-runtime-rs", "runc")); err != nil {
					t.Fatal(err)
				}
			}
			if !d.Sandboxes.States(ctx)["B"].Available {
				t.Fatal("the cached state should still say available (TTL)")
			}
			ref := tierARef("deb-sys:24.04")
			if _, err := d.Provision(ctx, ref); !errors.Is(err, ErrUnsupported) {
				t.Fatalf("err = %v, want ErrUnsupported", err)
			}
			if err := c.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, &corev1.Pod{}); err == nil {
				t.Fatal("no pod may be created")
			}
		})
	}
}

// A running sandboxed pod keeps going when the sandbox disappears: the
// decision is made once, at creation.
func TestExistingPodNotRefused(t *testing.T) {
	ctx := context.Background()
	rc := kataRC("kata-clh-runtime-rs", "kata-clh-runtime-rs")
	d, c := sandboxDriver(t, sandboxesB(""), nil, rc, kataNode())
	ref := tierARef("deb-sys:24.04")
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err := c.Delete(ctx, rc); err != nil {
		t.Fatal(err)
	}
	d.Sandboxes.TTL = time.Nanosecond
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatalf("existing pod: %v", err)
	}
}

func TestSandboxStatesRecheck(t *testing.T) {
	ctx := context.Background()
	now := time.Unix(1000, 0)
	d, c := sandboxDriver(t, sandboxesB(""), nil, kataNode())
	s := d.Sandboxes
	s.Now = func() time.Time { return now }
	if s.States(ctx)["B"].Available {
		t.Fatal("no RuntimeClass yet")
	}
	if err := c.Create(ctx, kataRC("kata-clh-runtime-rs", "kata-clh-runtime-rs")); err != nil {
		t.Fatal(err)
	}
	if s.States(ctx)["B"].Available {
		t.Fatal("within the TTL the cached state stays")
	}
	now = now.Add(DefaultSandboxTTL)
	if st := s.States(ctx)["B"]; !st.Available || !strings.Contains(st.Reason, "1 schedulable node") {
		t.Fatalf("after the TTL: %+v", st)
	}
	var off *Sandboxes
	if off.Enabled() || off.States(ctx) != nil {
		t.Fatal("nil Sandboxes must be off")
	}
}

func fallbackSpec(extra ...labsv1.Node) *labsv1.LabTemplateSpec {
	return &labsv1.LabTemplateSpec{Topology: labsv1.Topology{
		Entry: "workstation",
		Nodes: append([]labsv1.Node{
			{Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1", Access: []labsv1.AccessType{labsv1.AccessShell}},
			{Name: "tr-pis-01", Driver: labsv1.DriverContainer, Image: "deb-sys:24.04", Access: []labsv1.AccessType{labsv1.AccessSSH},
				Resources: &labsv1.NodeResources{CPU: ptr.To(resource.MustParse("1")), MemoryMiB: ptr.To[int64](768)}},
			{Name: "vm1", Driver: labsv1.DriverVM, Image: "ubuntu-vm:24.04"},
		}, extra...),
	}}
}

func nodeOf(spec *labsv1.LabTemplateSpec, name string) labsv1.Node {
	for _, n := range spec.Topology.Nodes {
		if n.Name == name {
			return n
		}
	}
	return labsv1.Node{}
}

func planOf(t *testing.T, s *Sandboxes, spec *labsv1.LabTemplateSpec, recorded *labsv1.Topology) map[string]SandboxNode {
	t.Helper()
	plan, err := s.PlanSandboxes(context.Background(), sandboxCatalog(t), spec, recorded)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]SandboxNode{}
	for _, p := range plan {
		out[p.Node] = p
	}
	return out
}

func TestPlanSandboxesFallback(t *testing.T) {
	// RuntimeClass missing, fallback kubevirt: the twin.
	d, _ := sandboxDriver(t, sandboxesB(""), nil, kataNode())
	spec := fallbackSpec()
	plan := planOf(t, d.Sandboxes, spec, nil)
	if plan["tr-pis-01"].Substrate != SubstrateVM || len(plan) != 1 {
		t.Fatalf("plan = %+v (only tier-B container nodes are planned)", plan)
	}
	tw := nodeOf(spec, "tr-pis-01")
	if tw.Driver != labsv1.DriverVM || tw.Image != "ubuntu-vm:24.04" || *tw.Resources.MemoryMiB != defaultVMMemMiB ||
		tw.Resources.CPU.String() != "1" || len(tw.Access) != 2 || tw.Access[0] != labsv1.AccessSSH || tw.Access[1] != labsv1.AccessConsole {
		t.Fatalf("VM twin = %+v", tw)
	}
	if nodeOf(spec, "workstation").Driver != labsv1.DriverContainer {
		t.Fatal("the entry node was rewritten")
	}

	// A handler that is not a trusted VM: unprivileged pods could use it, a
	// systemd image cannot, so it falls back too.
	d, _ = sandboxDriver(t, sandboxesB(""), nil, kataNode(), kataRC("kata-clh-runtime-rs", "microvm"))
	spec = fallbackSpec()
	if planOf(t, d.Sandboxes, spec, nil)["tr-pis-01"].Substrate != SubstrateVM {
		t.Fatal("an untrusted handler must not keep a systemd node")
	}

	// Fallback fail: nothing is rewritten.
	d, _ = sandboxDriver(t, sandboxesB(SandboxFallbackFail), nil, kataNode())
	spec = fallbackSpec()
	if p := planOf(t, d.Sandboxes, spec, nil); p["tr-pis-01"].Substrate != SubstrateNone || nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverContainer {
		t.Fatalf("fallback fail rewrote: %+v", p)
	}

	// Sandbox available: nothing is rewritten.
	d, _ = sandboxDriver(t, sandboxesB(""), nil, kataNode(), kataRC("kata-clh-runtime-rs", "kata-clh-runtime-rs"))
	spec = fallbackSpec()
	if p := planOf(t, d.Sandboxes, spec, nil); p["tr-pis-01"].Substrate != SubstrateSandbox || nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverContainer {
		t.Fatalf("available sandbox: %+v", p)
	}

	// Sandboxes off: nothing at all.
	var off *Sandboxes
	spec = fallbackSpec()
	if p := planOf(t, off, spec, nil); len(p) != 0 || nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverContainer {
		t.Fatal("off must not plan")
	}
}

// Nodes that cannot be twins block the rewrite of the whole session.
func TestPlanSandboxesNotRewritten(t *testing.T) {
	d, _ := sandboxDriver(t, sandboxesB(""), nil, kataNode())
	cases := map[string]labsv1.Node{
		"no vmFallback":          {Name: "x", Driver: labsv1.DriverContainer, Image: "el-sys:10"},
		"web access":             {Name: "x", Driver: labsv1.DriverContainer, Image: "deb-sys:24.04", Access: []labsv1.AccessType{labsv1.AccessWeb}},
		"a tier-A lab peer":      {Name: "x", Driver: labsv1.DriverContainer, Image: "el-lab:10"},
		"a plain tier-B lab pod": {Name: "x", Driver: labsv1.DriverContainer, Image: "deb-tools:1"},
	}
	for name, extra := range cases {
		t.Run(name, func(t *testing.T) {
			spec := fallbackSpec(extra)
			p := planOf(t, d.Sandboxes, spec, nil)
			if nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverContainer || nodeOf(spec, "x").Driver != labsv1.DriverContainer {
				t.Fatalf("rewritten: %+v", spec.Topology.Nodes)
			}
			if !strings.Contains(p["tr-pis-01"].Reason, "no VM fallback") {
				t.Fatalf("reason = %q", p["tr-pis-01"].Reason)
			}
		})
	}
	t.Run("on a link", func(t *testing.T) {
		spec := fallbackSpec(labsv1.Node{Name: "x", Driver: labsv1.DriverNetdev, Image: "frr:10"})
		spec.Topology.Links = []labsv1.Link{{A: "tr-pis-01:eth1", B: "x:eth1"}}
		p := planOf(t, d.Sandboxes, spec, nil)
		if nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverContainer || !strings.Contains(p["tr-pis-01"].Reason, "topology link") {
			t.Fatalf("linked node: %+v", p)
		}
	})
	t.Run("two twins", func(t *testing.T) {
		spec := fallbackSpec(labsv1.Node{Name: "x", Driver: labsv1.DriverContainer, Image: "deb-sys:24.04"})
		planOf(t, d.Sandboxes, spec, nil)
		if nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverVM || nodeOf(spec, "x").Driver != labsv1.DriverVM {
			t.Fatalf("two twins: %+v", spec.Topology.Nodes)
		}
	})
}

// A node keeps the substrate it was first provisioned on.
func TestPlanSandboxesSticky(t *testing.T) {
	rc := kataRC("kata-clh-runtime-rs", "kata-clh-runtime-rs")
	recVM := &labsv1.Topology{Nodes: []labsv1.Node{{Name: "tr-pis-01", Driver: labsv1.DriverVM, Image: "ubuntu-vm:24.04"}}}
	// Recorded as the VM fallback; the sandbox is back: stays a VM.
	d, _ := sandboxDriver(t, sandboxesB(""), nil, kataNode(), rc)
	spec := fallbackSpec()
	planOf(t, d.Sandboxes, spec, recVM)
	if nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverVM {
		t.Fatal("a VM fallback node must stay a VM")
	}
	// ... also when the manager restarted without sandboxes, or the catalog
	// changed the twin: never orphan the VM.
	var off *Sandboxes
	spec = fallbackSpec()
	if p := planOf(t, off, spec, recVM); nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverVM || p["tr-pis-01"].Substrate != SubstrateVM {
		t.Fatalf("sandboxes off: %+v", spec.Topology.Nodes)
	}
	spec = fallbackSpec()
	planOf(t, d.Sandboxes, spec, &labsv1.Topology{Nodes: []labsv1.Node{{Name: "tr-pis-01", Driver: labsv1.DriverVM, Image: "ubuntu-vm:22.04"}}})
	if n := nodeOf(spec, "tr-pis-01"); n.Driver != labsv1.DriverVM || n.Image != "ubuntu-vm:22.04" {
		t.Fatalf("changed twin: %+v", n)
	}
	// Recorded as a sandboxed pod; the sandbox is gone: stays a container
	// (its pod keeps running; a new pod would be refused, never a host pod).
	d, _ = sandboxDriver(t, sandboxesB(""), nil, kataNode())
	spec = fallbackSpec()
	planOf(t, d.Sandboxes, spec, &labsv1.Topology{Nodes: []labsv1.Node{{Name: "tr-pis-01", Driver: labsv1.DriverContainer, Image: "deb-sys:24.04"}}})
	if nodeOf(spec, "tr-pis-01").Driver != labsv1.DriverContainer {
		t.Fatal("a sandboxed node must not become a VM mid-session")
	}
}

func TestPlanSandboxesBrokenFallback(t *testing.T) {
	cat := sandboxCatalog(t)
	img := cat.Images["deb-sys:24.04"]
	img.VMFallback = "missing-vm:1"
	cat.Images["deb-sys:24.04"] = img
	if err := cat.CheckVMFallbacks(); err == nil || !strings.Contains(err.Error(), "missing-vm:1") {
		t.Fatalf("CheckVMFallbacks = %v", err)
	}
	d, _ := sandboxDriver(t, sandboxesB(""), nil, kataNode())
	if _, err := d.Sandboxes.PlanSandboxes(context.Background(), cat, fallbackSpec(), nil); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("err = %v, want ErrUnsupported", err)
	}
	if err := sandboxCatalog(t).CheckVMFallbacks(); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseCatalog([]byte("images:\n  x: {kind: containerDisk, image: x, vmFallback: y}\n")); err == nil {
		t.Fatal("vmFallback on a containerDisk: want error")
	}
}

func TestVMTwinResources(t *testing.T) {
	if vmTwinResources(nil) != nil {
		t.Fatal("nil resources keep the VM defaults")
	}
	r := vmTwinResources(&labsv1.NodeResources{MemoryMiB: ptr.To[int64](1536), Disks: []string{"1Gi"}})
	if *r.MemoryMiB != 1536 || r.Disks != nil {
		t.Fatalf("got %+v", r)
	}
}
