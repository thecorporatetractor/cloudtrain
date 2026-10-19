package drivers

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// Tier sandboxes (prototype, docs/kata-spike.md; off unless the manager runs
// with --tier-runtime-classes). A catalog image's tier (A, B, ...) can map to
// a RuntimeClass, e.g. B=kata-clh: container nodes of tier-B images then run
// in a Kata sandbox (a lightweight VM per pod) instead of the default runtime.
//
// Catalog images marked systemd (systemd is PID 1) need a privileged
// container. Inside a Kata sandbox "privileged" covers the guest VM only
// (kata-deploy sets privileged_without_host_devices), so the driver allows it
// there and nowhere else: without a sandbox RuntimeClass such a node fails
// with ErrUnsupported instead of running privileged on the host kernel.

// AnnotationSandbox records the sandbox decision on the pod ("<runtimeClass>"
// or "none: <reason>"), for debugging and lab verification.
const AnnotationSandbox = "labs.cloudtrain.dev/sandbox"

// ParseTierRuntimeClasses parses "B=kata-clh,A=gvisor" into a tier map.
func ParseTierRuntimeClasses(s string) (map[string]string, error) {
	out := map[string]string{}
	for _, part := range SplitList(s) {
		tier, rc, ok := strings.Cut(part, "=")
		tier, rc = strings.TrimSpace(tier), strings.TrimSpace(rc)
		if !ok || tier == "" || rc == "" {
			return nil, fmt.Errorf("tier runtime class %q: want <tier>=<RuntimeClass>", part)
		}
		if _, dup := out[tier]; dup {
			return nil, fmt.Errorf("tier %s mapped twice", tier)
		}
		out[tier] = rc
	}
	return out, nil
}

// DetectTierRuntimeClasses keeps the tier mappings whose RuntimeClass exists
// and whose scheduling node selector (kata-deploy sets
// katacontainers.io/kata-runtime=true) matches at least one schedulable node.
// The dropped tiers are returned with the reason, for the startup log.
func DetectTierRuntimeClasses(ctx context.Context, r client.Reader, want map[string]string) (map[string]string, map[string]string) {
	ok, dropped := map[string]string{}, map[string]string{}
	if len(want) == 0 {
		return ok, dropped
	}
	nodes := &corev1.NodeList{}
	if err := r.List(ctx, nodes); err != nil {
		for t := range want {
			dropped[t] = fmt.Sprintf("cannot list nodes: %v", err)
		}
		return ok, dropped
	}
	for tier, name := range want {
		rc := &nodev1.RuntimeClass{}
		if err := r.Get(ctx, client.ObjectKey{Name: name}, rc); err != nil {
			dropped[tier] = fmt.Sprintf("RuntimeClass %s: %v", name, err)
			continue
		}
		var sel labels.Selector = labels.Everything()
		if rc.Scheduling != nil && len(rc.Scheduling.NodeSelector) > 0 {
			sel = labels.SelectorFromSet(rc.Scheduling.NodeSelector)
		}
		n := 0
		for _, node := range nodes.Items {
			if !node.Spec.Unschedulable && sel.Matches(labels.Set(node.Labels)) {
				n++
			}
		}
		if n == 0 {
			dropped[tier] = fmt.Sprintf("RuntimeClass %s (handler %s) matches no schedulable node", name, rc.Handler)
			continue
		}
		ok[tier] = name
	}
	return ok, dropped
}

// FormatTiers renders a tier map for logs ("B=kata-clh").
func FormatTiers(m map[string]string) string {
	var out []string
	for k, v := range m {
		out = append(out, k+"="+v)
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

// applySandbox sets the tier's RuntimeClass on a container node's pod and,
// for systemd images inside a sandbox, makes the node container privileged.
// It fails a systemd image that would otherwise run on the host kernel.
func (d *ContainerDriver) applySandbox(ref NodeRef, pod *corev1.Pod) error {
	if d.Catalog == nil {
		return nil
	}
	img, err := d.Catalog.Resolve(ref.Node.Image, ImageKindContainer)
	if err != nil {
		return nil
	}
	rc := d.TierRuntimeClasses[img.Tier]
	if pod.Annotations == nil {
		pod.Annotations = map[string]string{}
	}
	if rc == "" {
		if img.Systemd {
			return fmt.Errorf("node %s: image %s runs systemd and needs a sandbox runtime for tier %q (manager --tier-runtime-classes, e.g. %s=kata-clh); without Kata run it as a KubeVirt VM: %w",
				ref.Node.Name, ref.Node.Image, img.Tier, img.Tier, ErrUnsupported)
		}
		if len(d.TierRuntimeClasses) > 0 {
			pod.Annotations[AnnotationSandbox] = "none: no RuntimeClass for tier " + img.Tier
		}
		return nil
	}
	pod.Spec.RuntimeClassName = ptr.To(rc)
	pod.Annotations[AnnotationSandbox] = rc
	if img.Systemd {
		for i := range pod.Spec.Containers {
			c := &pod.Spec.Containers[i]
			if c.Name != ContainerName {
				continue
			}
			if c.SecurityContext == nil {
				c.SecurityContext = &corev1.SecurityContext{}
			}
			c.SecurityContext.Privileged = ptr.To(true)
			// Ready = systemd finished booting, so setup never races it
			// ("System has not been booted with systemd as init system").
			c.ReadinessProbe = systemdReadiness()
		}
	}
	return nil
}

// systemdReadiness is the readiness probe of systemd nodes: the system
// reached running (or degraded: some unit failed, which labs may cause).
func systemdReadiness() *corev1.Probe {
	return &corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{Exec: &corev1.ExecAction{Command: []string{
			"sh", "-c", `s=$(systemctl is-system-running 2>/dev/null); [ "$s" = running ] || [ "$s" = degraded ]`,
		}}},
		PeriodSeconds:    1,
		TimeoutSeconds:   5,
		FailureThreshold: 3,
	}
}
