package drivers

import corev1 "k8s.io/api/core/v1"

// podIsolated reports whether a pod about to be created is contained apart
// from its capabilities: it runs in a user namespace (hostUsers: false) or in
// the sandbox RuntimeClass the sandbox check chose for it (AnnotationSandbox
// names that class; a RuntimeClass alone, e.g. --runtime-class, does not
// count). The string says why not.
func podIsolated(pod *corev1.Pod) (bool, string) {
	if pod.Spec.HostUsers != nil && !*pod.Spec.HostUsers {
		return true, ""
	}
	if rc := pod.Spec.RuntimeClassName; rc != nil && *rc != "" && pod.Annotations[AnnotationSandbox] == *rc {
		return true, ""
	}
	why := pod.Annotations[AnnotationSandbox]
	if why == "" {
		why = "no sandbox decision"
	}
	if ns := pod.Annotations[AnnotationUserNamespace]; ns != "" {
		why += "; user namespace: " + ns
	}
	return false, "host users and no sandbox (" + why + ")"
}
