package controller

// RBAC for session networks (internal/network): Kube-OVN VPCs and subnets,
// Multus NetworkAttachmentDefinitions.

// +kubebuilder:rbac:groups=kubeovn.io,resources=vpcs;subnets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=k8s.cni.cncf.io,resources=network-attachment-definitions,verbs=get;list;watch;create;update;patch;delete
