package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Labels and annotations of pooled sessions.
const (
	// LabelWarmPool marks a LabSession created by a WarmPool (value: pool name).
	LabelWarmPool = "labs.cloudtrain.dev/warm-pool"
	// LabelClaimedBy is set on a pooled session once a LabSession claimed it
	// (value: the claiming session's UID). Unclaimed pooled sessions have no
	// such label.
	LabelClaimedBy = "labs.cloudtrain.dev/claimed-by"
	// AnnotationClaimedByName is the claiming session's name.
	AnnotationClaimedByName = "labs.cloudtrain.dev/claimed-by-name"
)

// Condition types maintained on WarmPool.
const (
	// PoolConditionReady is True while at least spec.size sessions are ready.
	PoolConditionReady = "Ready"
	// PoolConditionDegraded is True when pooled sessions failed recently or
	// the template is missing.
	PoolConditionDegraded = "Degraded"
)

// WarmPoolSpec keeps a number of pre-provisioned, unclaimed sessions of a
// template ready for instant hand-out.
//
// Pooled sessions are LabSessions named <pool>-<random>, labelled
// labs.cloudtrain.dev/warm-pool=<pool> plus every label of the WarmPool
// itself (so a manager restricted by --session-selector reconciles them),
// owned by the pool, each with its own random seed (params are fixed per
// pooled session). Unclaimed pooled sessions never expire. A LabSession
// with spec.warmPoolRef claims one (see LabSessionSpec.WarmPoolRef).
type WarmPoolSpec struct {
	TemplateRef TemplateReference `json:"templateRef"`
	// Size is the desired number of ready, unclaimed sessions.
	// +kubebuilder:validation:Minimum=0
	Size int32 `json:"size"`
	// MaxSurge caps how many pooled sessions provision at the same time
	// (VM-heavy labs: keep it at 1). Default 1.
	// +optional
	// +kubebuilder:validation:Minimum=1
	MaxSurge *int32 `json:"maxSurge,omitempty"`
	// MaxIdle recycles (deletes and replaces) an unclaimed pooled session
	// once it has existed this long. Empty: pooled sessions are kept until
	// claimed or the pool shrinks.
	// +optional
	MaxIdle *metav1.Duration `json:"maxIdle,omitempty"`
}

// WarmPoolStatus is the observed state of a WarmPool.
type WarmPoolStatus struct {
	// Ready is the number of ready, unclaimed sessions.
	// +optional
	Ready int32 `json:"ready"`
	// Provisioning is the number of unclaimed sessions not ready yet.
	// +optional
	Provisioning int32 `json:"provisioning,omitempty"`
	// Claimed is the number of sessions of this pool that were claimed and
	// still exist.
	// +optional
	Claimed int32 `json:"claimed,omitempty"`
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=wp,categories=cloudtrain
// +kubebuilder:printcolumn:name="Template",type=string,JSONPath=`.spec.templateRef.name`
// +kubebuilder:printcolumn:name="Size",type=integer,JSONPath=`.spec.size`
// +kubebuilder:printcolumn:name="Ready",type=integer,JSONPath=`.status.ready`
// +kubebuilder:printcolumn:name="Provisioning",type=integer,JSONPath=`.status.provisioning`
// +kubebuilder:printcolumn:name="Claimed",type=integer,JSONPath=`.status.claimed`

// WarmPool pre-provisions LabSessions of a template.
type WarmPool struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   WarmPoolSpec   `json:"spec,omitempty"`
	Status WarmPoolStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// WarmPoolList contains a list of WarmPool.
type WarmPoolList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []WarmPool `json:"items"`
}

func init() {
	register(&WarmPool{}, &WarmPoolList{})
}
