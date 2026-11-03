package drivers

import (
	"context"
	"errors"
	"sort"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func TestParseIsolationProfile(t *testing.T) {
	for in, want := range map[string]string{"": IsolationDev, "dev": IsolationDev, "production": IsolationProduction} {
		got, err := ParseIsolationProfile(in)
		if err != nil || got != want {
			t.Errorf("%q: got %q, %v", in, got, err)
		}
	}
	if _, err := ParseIsolationProfile("prod"); err == nil {
		t.Error("unknown profile must be rejected")
	}
}

func TestCheckProductionProfile(t *testing.T) {
	cat := sandboxCatalog(t)
	if _, err := CheckProductionProfile(nil, cat); err == nil {
		t.Fatal("production without sandboxes must refuse to start")
	}
	if _, err := CheckProductionProfile(&Sandboxes{}, cat); err == nil {
		t.Fatal("production with an empty sandbox config must refuse to start")
	}
	// Tier V (virtual clusters) is required.
	if _, err := CheckProductionProfile(&Sandboxes{Tiers: sandboxesB("")}, cat); err == nil || !strings.Contains(err.Error(), "tier V") {
		t.Fatalf("production without a tier V sandbox: %v", err)
	}
	tiers := sandboxesB("")
	tiers["V"] = SandboxTier{RuntimeClass: "kata-clh-runtime-rs"}
	warnings, err := CheckProductionProfile(&Sandboxes{Tiers: tiers}, cat)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(warnings, "\n")
	// Tier A (el-lab) and the untiered jumphost have no sandbox; tier B does.
	if !strings.Contains(joined, "tier A has no sandbox: nodes of [el-lab:10]") || !strings.Contains(joined, "no tier has no sandbox: nodes of [jumphost:1]") {
		t.Errorf("warnings = %q", joined)
	}
	if strings.Contains(joined, "tier B") {
		t.Errorf("tier B is configured: %q", joined)
	}
}

// Every lab pod: seccomp RuntimeDefault and the explicit capability allowlist.
func TestLabPodHardening(t *testing.T) {
	d, _ := newContainerDriver(t)
	for _, ref := range []NodeRef{jumphostRef(), tierARef("el-lab:10")} {
		pod := d.BuildPod(ref)
		if sc := pod.Spec.SecurityContext; sc == nil || sc.SeccompProfile == nil || sc.SeccompProfile.Type != corev1.SeccompProfileTypeRuntimeDefault {
			t.Errorf("%s: pod seccomp = %+v", ref.Node.Name, pod.Spec.SecurityContext)
		}
		main := pod.Spec.Containers[0]
		caps := main.SecurityContext.Capabilities
		if len(caps.Drop) != 1 || caps.Drop[0] != "ALL" {
			t.Errorf("%s: drop = %v", ref.Node.Name, caps.Drop)
		}
		if len(caps.Add) != len(RuntimeDefaultCapabilities) {
			t.Errorf("%s: add = %v, want the runtime default allowlist", ref.Node.Name, caps.Add)
		}
		for _, c := range caps.Add {
			if c == "SYS_ADMIN" || c == "NET_ADMIN" || c == "SYS_PTRACE" || c == "SYS_MODULE" {
				t.Errorf("%s: %s must not be in the default allowlist", ref.Node.Name, c)
			}
		}
	}
	// The entry node keeps its own security context (root, no escalation).
	er := jumphostRef()
	er.Template = &labsv1.LabTemplateSpec{Topology: labsv1.Topology{Entry: er.Node.Name, Nodes: []labsv1.Node{er.Node}}}
	entry := d.BuildPod(er).Spec.Containers[0].SecurityContext
	if len(entry.Capabilities.Drop) != 1 || entry.Capabilities.Drop[0] != "ALL" {
		t.Errorf("entry capabilities = %+v", entry.Capabilities)
	}
	if entry.RunAsUser == nil || *entry.RunAsUser != 0 || entry.AllowPrivilegeEscalation == nil || *entry.AllowPrivilegeEscalation {
		t.Errorf("entry security context = %+v", entry)
	}
	// Capabilities a driver adds survive the allowlist.
	pod := d.BuildPod(jumphostRef())
	pod.Spec.Containers[0].SecurityContext.Capabilities.Add = append(pod.Spec.Containers[0].SecurityContext.Capabilities.Add, "NET_ADMIN")
	hardenPod(pod)
	n := 0
	for _, c := range pod.Spec.Containers[0].SecurityContext.Capabilities.Add {
		if c == "NET_ADMIN" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("NET_ADMIN added %d times", n)
	}
}

func TestProductionProfileFailsClosed(t *testing.T) {
	katart := kataRC("kata-vm-isolation", "kata")
	cases := []struct {
		name   string
		image  string
		tiers  map[string]SandboxTier
		userns bool
		objs   []client.Object
		want   string // "" = refused
	}{
		{"no sandbox, host users: refused", "deb-tools:1", nil, false, nil, ""},
		{"global --runtime-class alone is not a sandbox: refused", "jumphost:1", sandboxesB(""), false, []client.Object{katart, kataNode()}, ""},
		{"sandbox configured but unavailable: refused", "deb-tools:1", map[string]SandboxTier{"B": {RuntimeClass: "kata-vm-isolation"}}, false, nil, ""},
		{"tier sandbox available", "deb-tools:1", map[string]SandboxTier{"B": {RuntimeClass: "kata-vm-isolation"}}, false, []client.Object{katart, kataNode()}, "sandbox"},
		{"user namespace", "el-lab:10", sandboxesB(""), true, nil, "userns"},
		{"userns image without cluster support: refused", "el-lab:10", sandboxesB(""), false, nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			d, c := sandboxDriver(t, tc.tiers, nil, tc.objs...)
			d.RequireIsolation, d.UserNamespaces = true, tc.userns
			ref := tierARef(tc.image)
			_, err := d.Provision(ctx, ref)
			pod := &corev1.Pod{}
			getErr := c.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, pod)
			if tc.want == "" {
				if !errors.Is(err, ErrUnsupported) || !strings.Contains(err.Error(), "production isolation profile") {
					t.Fatalf("err = %v, want a production profile refusal", err)
				}
				if getErr == nil {
					t.Fatal("refused pod was created")
				}
				return
			}
			if err != nil || getErr != nil {
				t.Fatalf("provision: %v, get: %v", err, getErr)
			}
			switch tc.want {
			case "sandbox":
				if pod.Spec.RuntimeClassName == nil || *pod.Spec.RuntimeClassName != "kata-vm-isolation" {
					t.Errorf("runtimeClassName = %v", pod.Spec.RuntimeClassName)
				}
			case "userns":
				if pod.Spec.HostUsers == nil || *pod.Spec.HostUsers {
					t.Errorf("hostUsers = %v", pod.Spec.HostUsers)
				}
			}
		})
	}
}

func TestDevProfileUnchanged(t *testing.T) {
	ctx := context.Background()
	d, c := sandboxDriver(t, nil, nil)
	ref := tierARef("deb-tools:1")
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, &corev1.Pod{}); err != nil {
		t.Fatal(err)
	}
}

func TestUnisolatedLabPods(t *testing.T) {
	owner := metav1.OwnerReference{APIVersion: labsv1.GroupVersion.String(), Kind: "LabSession", Name: "s1", UID: "uid-1", Controller: ptr.To(true)}
	mk := func(ns, name string, labels map[string]string, mutate func(*corev1.Pod)) *corev1.Pod {
		p := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name, Labels: labels, Annotations: map[string]string{},
			OwnerReferences: []metav1.OwnerReference{owner}}}
		if mutate != nil {
			mutate(p)
		}
		return p
	}
	node := func(extra ...string) map[string]string {
		l := map[string]string{LabelManagedBy: ManagedBy, LabelNode: "n"}
		for i := 0; i+1 < len(extra); i += 2 {
			l[extra[i]] = extra[i+1]
		}
		return l
	}
	noOwner := func(p *corev1.Pod) { p.OwnerReferences = nil }
	_, c := newContainerDriver(t,
		mk("labs", "host-users", node(), nil),
		mk("labs", "global-runtime-class", node(), func(p *corev1.Pod) { p.Spec.RuntimeClassName = ptr.To("kata") }),
		// A kubevirt.io label does not hide a node pod.
		mk("labs", "spoofed-vm-label", node("kubevirt.io", "virt-launcher"), nil),
		mk("labs", "userns", node(), func(p *corev1.Pod) { p.Spec.HostUsers = ptr.To(false) }),
		mk("labs", "sandboxed", node(), func(p *corev1.Pod) {
			p.Spec.RuntimeClassName = ptr.To("kata-vm-isolation")
			p.Annotations[AnnotationSandbox] = "kata-vm-isolation"
		}),
		// virt-launcher: controlled by its VMI.
		mk("labs", "virt-launcher-x", node("kubevirt.io", "virt-launcher"), func(p *corev1.Pod) {
			p.OwnerReferences = []metav1.OwnerReference{{APIVersion: "kubevirt.io/v1", Kind: "VirtualMachineInstance", Name: "vm", UID: "vmi", Controller: ptr.To(true)}}
		}),
		mk("labs", "not-ours", map[string]string{LabelNode: "n"}, nil),
		// The vcluster control plane carries the session and node labels
		// (statefulSet labels) and a StatefulSet owner: never a lab node pod.
		mk("ct-vc-abc", "vc-abc-0", node("app", "vcluster", LabelSession, "s1"), func(p *corev1.Pod) {
			p.OwnerReferences = []metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "StatefulSet", Name: "vc-abc", UID: "sts", Controller: ptr.To(true)}}
		}),
		// A synced learner pod copying every label and even the owner reference.
		mk("ct-vc-abc", "learner-x-vc-abc", node(), nil),
		mk("labs", "unowned-node-label", node(), noOwner),
	)
	keys, why, err := UnisolatedLabPods(context.Background(), c, "kata-vm-isolation")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, k := range keys {
		names = append(names, k.Name)
	}
	sort.Strings(names)
	// In ct-vc-* every pod counts, judged by its RuntimeClass: the control
	// plane and the synced pod above run with host users on runc.
	if strings.Join(names, ",") != "global-runtime-class,host-users,learner-x-vc-abc,spoofed-vm-label,vc-abc-0" {
		t.Errorf("unisolated = %v (%v)", names, why)
	}
	// In the tier V sandbox (what the syncer and the control plane values set),
	// vcluster pods pass whatever their labels say.
	sb := func(p *corev1.Pod) { p.Spec.RuntimeClassName = ptr.To("kata-vm-isolation") }
	_, c2 := newContainerDriver(t,
		mk("ct-vc-abc", "vc-abc-0", node("app", "vcluster"), sb),
		mk("ct-vc-abc", "synced", map[string]string{"kubevirt.io": "virt-launcher"}, sb),
		mk("ct-vc-abc", "userns", nil, func(p *corev1.Pod) { p.Spec.HostUsers = ptr.To(false) }),
		mk("ct-vc-abc", "spoofed-class", nil, func(p *corev1.Pod) { p.Spec.RuntimeClassName = ptr.To("runc") }),
	)
	keys, _, err = UnisolatedLabPods(context.Background(), c2, "kata-vm-isolation")
	if err != nil || len(keys) != 1 || keys[0].Name != "spoofed-class" {
		t.Errorf("sandboxed vcluster pods: %v %v", keys, err)
	}
}
