package controller

// RBAC for session networks (internal/network): Kube-OVN VPCs and subnets
// are cluster-scoped, so they stay in the cluster-wide ClusterRole; the
// admission policy (config/rbac/admission_policy.yaml) limits writes to the
// ones carrying the orchestrator's managed-by label, so kube-ovn's own VPC
// and subnets (ovn-cluster, ovn-default, join) cannot be changed. Multus
// NetworkAttachmentDefinitions are namespaced: session ClusterRole
// (internal/rbac).

// +kubebuilder:rbac:groups=kubeovn.io,resources=vpcs;subnets,verbs=get;list;create;update;patch;delete
