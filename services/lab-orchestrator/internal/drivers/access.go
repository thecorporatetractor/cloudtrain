package drivers

import "context"

// LabelLabNamespace marks a namespace the lab-orchestrator may work in: the
// namespaces that hold LabSessions (labctl verify/exam namespaces, the
// gateway's cloudtrain-sessions) and the vcluster host namespaces the
// orchestrator creates. The orchestrator holds no namespaced permissions of
// its own; in a namespace with this label it binds its session ClusterRole
// to itself (internal/rbac.SessionAccess), and its ValidatingAdmissionPolicy
// refuses that binding anywhere else (docs/deploy.md, RBAC).
const LabelLabNamespace = "labs.cloudtrain.dev/lab-namespace"

// NamespaceAccess grants the orchestrator its session permissions in a lab
// namespace (a RoleBinding to the session ClusterRole).
type NamespaceAccess interface {
	Ensure(ctx context.Context, namespace string) error
}
