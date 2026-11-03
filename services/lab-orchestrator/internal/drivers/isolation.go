package drivers

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Isolation profiles (manager --isolation-profile, Helm
// orchestrator.isolation.profile).
//
//   - dev (the default): lab pods run as configured; a pod without a sandbox
//     or a user namespace runs with host users on the host kernel (kind,
//     local clusters).
//   - production: fail closed. The manager refuses to start without tier
//     sandboxes, and every lab pod must run either in a sandbox RuntimeClass
//     the sandbox check proved (a VM per pod, e.g. AKS kata-vm-isolation) or
//     with hostUsers: false. A pod that would fall back to host users on the
//     host kernel is refused, never created. This also covers learnerSudo:
//     sudo only ever runs inside a VM sandbox or a user namespace.
//
// Both profiles set seccomp RuntimeDefault on every lab node pod (container
// and netdev drivers) and give the node container an explicit capability
// allowlist (see BuildPod). Pods a learner creates inside a vcluster are not
// built here: they run in the tier V sandbox (required in production), and
// the lab pool's kubelet seccompDefault covers their seccomp.
//
// At startup the production profile also finds lab node pods created before
// it applied (UnisolatedLabPods): the manager refuses to start while any
// exist, or deletes them with --isolation-evict.
const (
	IsolationDev        = "dev"
	IsolationProduction = "production"
)

// ParseIsolationProfile validates --isolation-profile ("" = dev).
func ParseIsolationProfile(s string) (string, error) {
	switch s {
	case "", IsolationDev:
		return IsolationDev, nil
	case IsolationProduction:
		return IsolationProduction, nil
	}
	return "", fmt.Errorf("isolation profile %q: want %s or %s", s, IsolationDev, IsolationProduction)
}

// CheckProductionProfile is the manager's startup check for the production
// profile: tier sandboxes must be configured (error otherwise). The warnings
// name catalog container tiers without a sandbox: their pods are refused
// unless they run in a user namespace.
func CheckProductionProfile(s *Sandboxes, cat *ImageCatalog) ([]string, error) {
	if !s.Enabled() {
		return nil, fmt.Errorf("isolation profile production needs tier sandboxes (--sandboxes or --sandboxes-config, Helm orchestrator.sandboxes; AKS: kata-vm-isolation): lab pods would otherwise run with host users on the host kernel")
	}
	// Virtual clusters: the learner is cluster-admin there and runs any image
	// as root, so their pods need the tier V sandbox too.
	if _, ok := s.Tiers[SandboxTierVCluster]; !ok {
		return nil, fmt.Errorf("isolation profile production needs a tier %s sandbox: pods learners create inside virtual clusters would otherwise run as root with host users on the host kernel", SandboxTierVCluster)
	}
	if cat == nil {
		return nil, nil
	}
	missing := map[string][]string{}
	for ref, img := range cat.Images {
		if img.Kind != ImageKindContainer {
			continue
		}
		if _, ok := s.Tiers[img.Tier]; !ok {
			missing[img.Tier] = append(missing[img.Tier], ref)
		}
	}
	var out []string
	for _, t := range sortedTiers(missing) {
		refs := missing[t]
		sort.Strings(refs)
		name := "tier " + t
		if t == "" {
			name = "no tier"
		}
		out = append(out, fmt.Sprintf("%s has no sandbox: nodes of %v run only in a user namespace, otherwise they are refused", name, refs))
	}
	return out, nil
}

func sortedTiers(m map[string][]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// RuntimeDefaultCapabilities is the explicit capability allowlist of a lab
// node container: the container runtime's default set (containerd/CRI-O),
// written out so a runtime with a wider default adds nothing. Every other
// capability is dropped first. Drivers add what a node needs on top (wired
// nodes NET_ADMIN, netdev devices their family's set); privileged sandbox
// containers (Kata guest) are unaffected.
var RuntimeDefaultCapabilities = []corev1.Capability{
	"AUDIT_WRITE", "CHOWN", "DAC_OVERRIDE", "FOWNER", "FSETID", "KILL", "MKNOD",
	"NET_BIND_SERVICE", "NET_RAW", "SETFCAP", "SETGID", "SETPCAP", "SETUID", "SYS_CHROOT",
}

// hardenPod sets seccomp RuntimeDefault for the pod (unless a profile is
// already chosen) and the capability allowlist on the node container.
func hardenPod(pod *corev1.Pod) {
	if pod.Spec.SecurityContext == nil {
		pod.Spec.SecurityContext = &corev1.PodSecurityContext{}
	}
	if pod.Spec.SecurityContext.SeccompProfile == nil {
		pod.Spec.SecurityContext.SeccompProfile = &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}
	}
	for i := range pod.Spec.Containers {
		c := &pod.Spec.Containers[i]
		if c.Name != ContainerName {
			continue
		}
		if c.SecurityContext == nil {
			c.SecurityContext = &corev1.SecurityContext{}
		}
		var add []corev1.Capability
		if c.SecurityContext.Capabilities != nil {
			add = c.SecurityContext.Capabilities.Add
		}
		all := append([]corev1.Capability{}, RuntimeDefaultCapabilities...)
		for _, a := range add {
			dup := false
			for _, h := range all {
				dup = dup || h == a
			}
			if !dup {
				all = append(all, a)
			}
		}
		c.SecurityContext.Capabilities = &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}, Add: all}
	}
}

// checkIsolation is the production profile's last check before a lab pod is
// created: it runs in a sandbox RuntimeClass the sandbox check chose for it
// (AnnotationSandbox names the class) or with hostUsers: false. Anything
// else is refused (ErrUnsupported): the pod would share the host kernel as
// host root.
func (d *ContainerDriver) checkIsolation(ref NodeRef, pod *corev1.Pod) error {
	if !d.RequireIsolation {
		return nil
	}
	if ok, why := podIsolated(pod); !ok {
		return fmt.Errorf("node %s: the production isolation profile runs lab pods only in a sandbox RuntimeClass or a user namespace, and this pod has %s: %w",
			ref.Node.Name, why, ErrUnsupported)
	}
	return nil
}

// SandboxTierVCluster is the curriculum tier of virtual clusters.
const SandboxTierVCluster = "V"

// UnisolatedLabPods lists the lab node pods (container and netdev drivers)
// that run neither in a user namespace nor in their sandbox RuntimeClass, as
// "namespace/name: reason". The production profile checks them at startup:
// pods are immutable, so pods created before the profile applied keep host
// users until recreated.
//
// A lab node pod is recognised by what only the orchestrator sets, never by
// labels alone (a learner sets any label on the pods a vcluster syncs): its
// controller is a LabSession, outside the vcluster host namespaces.
// virt-launcher pods are controlled by their VirtualMachineInstance, so they
// never match.
//
// Every pod in a vcluster host namespace (ct-vc-*: the control plane, CoreDNS
// and the pods learners create) is checked too, by what the vcluster syncer
// and the API server set, not by labels: it must run in the tier V sandbox
// RuntimeClass (vclusterRuntimeClass) or with hostUsers: false.
func UnisolatedLabPods(ctx context.Context, r client.Reader, vclusterRuntimeClass string) ([]types.NamespacedName, []string, error) {
	pods := &corev1.PodList{}
	if err := r.List(ctx, pods, client.MatchingLabels{LabelManagedBy: ManagedBy}, client.HasLabels{LabelNode}); err != nil {
		return nil, nil, err
	}
	all := &corev1.PodList{}
	if err := r.List(ctx, all); err != nil {
		return nil, nil, err
	}
	var keys []types.NamespacedName
	var out []string
	add := func(p *corev1.Pod, why string) {
		keys = append(keys, types.NamespacedName{Namespace: p.Namespace, Name: p.Name})
		out = append(out, p.Namespace+"/"+p.Name+": "+why)
	}
	for i := range pods.Items {
		p := &pods.Items[i]
		if p.DeletionTimestamp != nil || strings.HasPrefix(p.Namespace, VClusterNamespacePrefix) || !controlledByLabSession(p) {
			continue
		}
		if ok, why := podIsolated(p); !ok {
			add(p, why)
		}
	}
	for i := range all.Items {
		p := &all.Items[i]
		if p.DeletionTimestamp != nil || !strings.HasPrefix(p.Namespace, VClusterNamespacePrefix) {
			continue
		}
		if p.Spec.HostUsers != nil && !*p.Spec.HostUsers {
			continue
		}
		if rc := p.Spec.RuntimeClassName; vclusterRuntimeClass != "" && rc != nil && *rc == vclusterRuntimeClass {
			continue
		}
		add(p, "vcluster pod with host users outside the tier V sandbox")
	}
	return keys, out, nil
}

// VClusterNamespacePrefix starts every vcluster host namespace.
const VClusterNamespacePrefix = "ct-vc-"

// controlledByLabSession: the pod's controller is a LabSession (the owner
// reference the container driver sets on the pods it creates).
func controlledByLabSession(p *corev1.Pod) bool {
	c := metav1.GetControllerOf(p)
	return c != nil && c.Kind == "LabSession" && strings.HasPrefix(c.APIVersion, labsv1.GroupVersion.Group+"/")
}
