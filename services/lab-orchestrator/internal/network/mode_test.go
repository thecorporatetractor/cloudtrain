package network

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestParseMode(t *testing.T) {
	for in, want := range map[string]Mode{"": ModePrimary, "primary": ModePrimary, "secondary": ModeSecondary} {
		if got, err := ParseMode(in); err != nil || got != want {
			t.Errorf("ParseMode(%q) = %q, %v", in, got, err)
		}
	}
	if _, err := ParseMode("other"); err == nil {
		t.Error("ParseMode accepts other")
	}
}

func objectsByKind(objs []*unstructured.Unstructured) map[string][]*unstructured.Unstructured {
	out := map[string][]*unstructured.Unstructured{}
	for _, o := range objs {
		out[o.GetKind()] = append(out[o.GetKind()], o)
	}
	return out
}

// Primary mode renders what it rendered before network modes existed: the
// management subnet has no provider and no NAD, no MTU unless asked.
func TestPrimaryObjectsUnchanged(t *testing.T) {
	p, err := Build(sess, ospfTopology())
	if err != nil {
		t.Fatal(err)
	}
	if p.Mgmt.NAD != "" || p.Mgmt.Provider != "" {
		t.Fatalf("primary mgmt segment = %+v", p.Mgmt)
	}
	byKind := objectsByKind((&Manager{}).Objects(p))
	if len(byKind["NetworkAttachmentDefinition"]) != len(p.Links) {
		t.Errorf("NADs = %d, want one per link (%d)", len(byKind["NetworkAttachmentDefinition"]), len(p.Links))
	}
	for _, sub := range byKind["Subnet"] {
		if _, ok, _ := unstructured.NestedFieldNoCopy(sub.Object, "spec", "mtu"); ok {
			t.Errorf("subnet %s has an mtu without Options.MTU", sub.GetName())
		}
		if sub.GetName() == p.Mgmt.Subnet {
			if _, ok, _ := unstructured.NestedString(sub.Object, "spec", "provider"); ok {
				t.Error("primary mgmt subnet has a provider (would not be selectable with logical_switch)")
			}
		}
	}
	pod := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "node"}}}}
	if err := p.DecoratePod("core-host", pod, "node", PodOptions{ToolsImage: "t"}); err != nil {
		t.Fatal(err)
	}
	if pod.Annotations[AnnotationLogicalSwitch] != p.Mgmt.Subnet {
		t.Errorf("logical_switch = %q", pod.Annotations[AnnotationLogicalSwitch])
	}
	if _, ok := pod.Annotations[AnnotationDefaultNetwork]; ok {
		t.Error("primary mode sets the Multus default network")
	}
}

func TestSecondaryPlan(t *testing.T) {
	p, err := BuildWith(sess, ospfTopology(), Options{Mode: ModeSecondary, MTU: DefaultLinkMTU})
	if err != nil {
		t.Fatal(err)
	}
	if p.Mgmt.NAD == "" || p.Mgmt.Provider != p.Mgmt.NAD+".labs.ovn" {
		t.Fatalf("secondary mgmt segment = %+v", p.Mgmt)
	}
	if p.Mgmt.Subnet != ClusterName(sess, "mgmt") || p.Mgmt.CIDR != MgmtCIDR {
		t.Errorf("mgmt subnet name/CIDR changed: %+v", p.Mgmt)
	}
	byKind := objectsByKind((&Manager{}).Objects(p))
	nads := byKind["NetworkAttachmentDefinition"]
	if len(nads) != len(p.Links)+1 || nads[0].GetName() != p.Mgmt.NAD || nads[0].GetNamespace() != "labs" {
		t.Fatalf("NADs = %d, first %s", len(nads), nads[0].GetName())
	}
	if cfg, _, _ := unstructured.NestedString(nads[0].Object, "spec", "config"); !strings.Contains(cfg, `"type":"kube-ovn"`) || !strings.Contains(cfg, `"provider":"`+p.Mgmt.Provider+`"`) {
		t.Errorf("mgmt NAD config = %s", cfg)
	}
	for _, sub := range byKind["Subnet"] {
		if mtu, _, _ := unstructured.NestedInt64(sub.Object, "spec", "mtu"); mtu != DefaultLinkMTU {
			t.Errorf("subnet %s mtu = %d", sub.GetName(), mtu)
		}
		if prov, _, _ := unstructured.NestedString(sub.Object, "spec", "provider"); prov == "" {
			t.Errorf("subnet %s has no provider in secondary mode", sub.GetName())
		}
	}

	pod := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "node"}}}}
	if err := p.DecoratePod("core-host", pod, "node", PodOptions{ToolsImage: "t"}); err != nil {
		t.Fatal(err)
	}
	if got := pod.Annotations[AnnotationDefaultNetwork]; got != "labs/"+p.Mgmt.NAD {
		t.Errorf("default network = %q", got)
	}
	if got := pod.Annotations[p.Mgmt.Provider+".kubernetes.io/logical_switch"]; got != p.Mgmt.Subnet {
		t.Errorf("mgmt provider logical_switch = %q", got)
	}
	if _, ok := pod.Annotations[AnnotationLogicalSwitch]; ok {
		t.Error("secondary mode sets ovn.kubernetes.io/logical_switch (needs Kube-OVN as primary)")
	}
	// Link ends are attachments exactly as in primary mode.
	if !strings.Contains(pod.Annotations[AnnotationNetworks], `"interface":"eth1"`) {
		t.Errorf("networks = %s", pod.Annotations[AnnotationNetworks])
	}
	// net-init still removes the default route of the management gateway.
	if !strings.Contains(pod.Spec.InitContainers[0].Command[2], "ip -4 route del default via 198.19.255.1 dev eth0") {
		t.Error("init script keeps the mgmt default route")
	}
}

// No net-init is privileged: hosts without user namespaces set the safe
// sysctl ping_group_range on the pod and need only NET_ADMIN for ip/tc;
// routers without user namespaces get their sysctls from the CNI tuning
// plugin (and also set ping_group_range on the pod).
func TestNetInitPrivileges(t *testing.T) {
	p, err := BuildWith(sess, ospfTopology(), Options{Mode: ModePrimary, RouterTuning: true})
	if err != nil {
		t.Fatal(err)
	}
	host := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "node"}}}}
	if err := p.DecoratePod("core-host", host, "node", PodOptions{ToolsImage: "t"}); err != nil {
		t.Fatal(err)
	}
	checkPlatformContainers(t, host, false)
	if sc := host.Spec.SecurityContext; sc == nil || len(sc.Sysctls) != 1 || sc.Sysctls[0].Name != "net.ipv4.ping_group_range" || sc.Sysctls[0].Value != "0 65535" {
		t.Errorf("pod sysctls = %+v", host.Spec.SecurityContext)
	}
	router := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "node"}}}}
	if err := p.DecoratePod("edge-1", router, "node", PodOptions{ToolsImage: "t", Router: true}); err != nil {
		t.Fatal(err)
	}
	checkPlatformContainers(t, router, false)
	if sc := router.Spec.SecurityContext; sc == nil || len(sc.Sysctls) != 1 {
		t.Errorf("router pod sysctls = %+v", router.Spec.SecurityContext)
	}
	un := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "node"}}}}
	if err := p.DecoratePod("core-host", un, "node", PodOptions{ToolsImage: "t", UserNamespace: true}); err != nil {
		t.Fatal(err)
	}
	checkPlatformContainers(t, un, true)
	if un.Spec.SecurityContext != nil {
		t.Errorf("user-namespaced pod gets pod sysctls: %+v", un.Spec.SecurityContext)
	}
}

// Delete waits for wired pods of either mode before removing segments.
func TestDeleteWaitsForSecondaryWiredPods(t *testing.T) {
	p, err := BuildWith(sess, ospfTopology(), Options{Mode: ModeSecondary})
	if err != nil {
		t.Fatal(err)
	}
	pod := &corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "node"}}}}
	if err := p.DecoratePod("core-host", pod, "node", PodOptions{ToolsImage: "t"}); err != nil {
		t.Fatal(err)
	}
	pod.Name, pod.Namespace = "core-host", sess.Namespace
	pod.Labels = map[string]string{LabelSessionUID: string(sess.UID), LabelManagedBy: ManagedBy}
	done, err := (&Manager{Client: newFake(pod)}).Delete(context.Background(), sess)
	if err != nil || done {
		t.Fatalf("Delete with a wired secondary-mode pod left: done=%v err=%v", done, err)
	}
}
