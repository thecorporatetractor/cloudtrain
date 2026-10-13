package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// WarmPoolSpec keeps a number of pre-provisioned, unclaimed sessions of a
// template ready for instant hand-out.
type WarmPoolSpec struct {
	TemplateRef TemplateReference `json:"templateRef"`
	// Size is the desired number of ready, unclaimed sessions.
	// +kubebuilder:validation:Minimum=0
	Size int32 `json:"size"`
}

// WarmPoolStatus is the observed state of a WarmPool.
type WarmPoolStatus struct {
	// Ready is the number of ready, unclaimed sessions.
	// +optional
	Ready int32 `json:"ready"`
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
	SchemeBuilder.Register(&WarmPool{}, &WarmPoolList{})
}
