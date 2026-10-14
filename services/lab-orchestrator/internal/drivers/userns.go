package drivers

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// User namespaces for tier-A container nodes.
//
// A catalog image with `userNamespace: true` is built to run unprivileged in a
// Kubernetes user namespace (pod `hostUsers: false`): root in the container is
// an unprivileged uid range on the node, and volumes are id-mapped. The driver
// sets it only when
//   - ContainerDriver.UserNamespaces is on (the cluster's runtime supports it,
//     see DetectUserNamespaces), and
//   - no container of the pod is privileged (the lab-link init container writes
//     netns sysctls as privileged; such nodes keep host users).
// Otherwise the pod runs with host users, exactly as before.

// AnnotationUserNamespace records the decision on the pod
// ("true", or "false: <reason>"), for debugging and lab verification.
const AnnotationUserNamespace = "labs.cloudtrain.dev/user-namespace"

// applyUserNamespace sets hostUsers: false on the pod of a node whose catalog
// image asks for it, when that is possible.
func (d *ContainerDriver) applyUserNamespace(ref NodeRef, pod *corev1.Pod) {
	if d.Catalog == nil {
		return
	}
	img, err := d.Catalog.Resolve(ref.Node.Image, ImageKindContainer)
	if err != nil || !img.UserNamespace {
		return
	}
	reason := ""
	switch {
	case !d.UserNamespaces:
		reason = "cluster runtime does not support user namespaces (or disabled)"
	case podHasPrivileged(pod):
		reason = "pod has a privileged container (topology links)"
	}
	if pod.Annotations == nil {
		pod.Annotations = map[string]string{}
	}
	if reason != "" {
		pod.Annotations[AnnotationUserNamespace] = "false: " + reason
		return
	}
	pod.Spec.HostUsers = ptr.To(false)
	pod.Annotations[AnnotationUserNamespace] = "true"
}

func podHasPrivileged(pod *corev1.Pod) bool {
	cs := append(append([]corev1.Container{}, pod.Spec.InitContainers...), pod.Spec.Containers...)
	for _, c := range cs {
		if c.SecurityContext != nil && c.SecurityContext.Privileged != nil && *c.SecurityContext.Privileged {
			return true
		}
	}
	return false
}

// DetectUserNamespaces reports whether pods with hostUsers: false can run on
// this cluster with the given RuntimeClass (empty: the default handler): every
// schedulable node must report runtimeHandlers[handler].features.userNamespaces
// (kubelet >= 1.30 publishes it; the UserNamespacesSupport gate is GA in 1.36).
// The string explains the result.
func DetectUserNamespaces(ctx context.Context, r client.Reader, runtimeClass string) (bool, string) {
	handler := ""
	if runtimeClass != "" {
		rc := &nodev1.RuntimeClass{}
		if err := r.Get(ctx, client.ObjectKey{Name: runtimeClass}, rc); err != nil {
			return false, fmt.Sprintf("cannot read RuntimeClass %s: %v", runtimeClass, err)
		}
		handler = rc.Handler
	}
	nodes := &corev1.NodeList{}
	if err := r.List(ctx, nodes); err != nil {
		return false, fmt.Sprintf("cannot list nodes: %v", err)
	}
	n := 0
	for _, node := range nodes.Items {
		if node.Spec.Unschedulable {
			continue
		}
		n++
		ok := false
		for _, h := range node.Status.RuntimeHandlers {
			if h.Name == handler && h.Features != nil && h.Features.UserNamespaces != nil && *h.Features.UserNamespaces {
				ok = true
			}
		}
		if !ok {
			return false, fmt.Sprintf("node %s does not report user namespace support for runtime handler %q", node.Name, handler)
		}
	}
	if n == 0 {
		return false, "no schedulable nodes"
	}
	return true, fmt.Sprintf("%d nodes support user namespaces for runtime handler %q", n, handler)
}
