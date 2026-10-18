// Package rbac holds the lab-orchestrator's namespaced permissions: the
// session ClusterRole (generated from the markers below into
// config/rbac/session_role.yaml) and SessionAccess, which binds it in each
// lab namespace.
//
// The manager's own ClusterRole (config/rbac/role.yaml, markers in
// internal/controller) is cluster-wide but holds no Secrets, no pods/exec,
// no writes to namespaced core objects, no escalate and no bind except on
// the session ClusterRole. Everything a lab needs inside a namespace is in
// the session ClusterRole, which the manager binds to itself only in
// namespaces labelled labs.cloudtrain.dev/lab-namespace=true (enforced by
// config/rbac/admission_policy.yaml). docs/deploy.md (RBAC) has the
// inventory.
package rbac

// Session ClusterRole. Core objects of lab nodes and vcluster releases
// (Secrets: SSH keys, kubeconfigs, PKI, Helm release records; PVCs: homes,
// VM disks, vcluster databases), exec for setup actions and grading.
// +kubebuilder:rbac:groups="",resources=pods;services;secrets;configmaps;serviceaccounts;endpoints;persistentvolumeclaims,verbs=get;list;watch;create;update;patch;delete;deletecollection
// +kubebuilder:rbac:groups="",resources=pods/exec,verbs=create;get;list;watch;update;patch;delete
// The vcluster chart's Role (vc-<release>, created by Helm as the manager)
// grants these; without escalate the manager must hold every rule it grants.
// +kubebuilder:rbac:groups="",resources=pods/attach;pods/portforward,verbs=create;get;list;watch;update;patch;delete
// +kubebuilder:rbac:groups="",resources=pods/status;pods/ephemeralcontainers;pods/resize,verbs=update;patch
// +kubebuilder:rbac:groups="",resources=pods/log,verbs=get;list;watch
// +kubebuilder:rbac:groups="",resources=events,verbs=create;get;list;watch;patch
// +kubebuilder:rbac:groups=events.k8s.io,resources=events,verbs=create;get;list;watch;patch
// +kubebuilder:rbac:groups=discovery.k8s.io,resources=endpointslices,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=apps,resources=statefulsets;deployments;replicasets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=rbac.authorization.k8s.io,resources=roles;rolebindings,verbs=get;list;watch;create;update;patch;delete
// Lab isolation, VMs and the Multus attachments of the session network.
// +kubebuilder:rbac:groups=networking.k8s.io,resources=networkpolicies,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=kubevirt.io,resources=virtualmachines;virtualmachineinstances,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=cdi.kubevirt.io,resources=datavolumes,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=k8s.cni.cncf.io,resources=network-attachment-definitions,verbs=get;list;watch;create;update;patch;delete

// DefaultSessionClusterRole is the session ClusterRole's name in
// config/rbac (instances other than cloudtrain-system suffix it with their
// namespace, deploy/scripts/orchestrator-deploy.sh; the chart with its
// release).
const DefaultSessionClusterRole = "lab-orchestrator-session"
