package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// LabTemplateSpec is a compiled, immutable lab definition produced from a
// cloudtrain.dev/v3 lab.yaml. Text fields may still contain {{param}}
// placeholders; they are resolved per LabSession from its seed.
// +kubebuilder:validation:XValidation:rule="self == oldSelf",message="LabTemplate spec is immutable; publish a new version instead"
type LabTemplateSpec struct {
	Source LabSource `json:"source"`
	// Description is the Markdown task statement shown to the learner.
	Description string `json:"description"`
	// +optional
	Objectives []string `json:"objectives,omitempty"`
	// +optional
	Params   map[string]ParamSpec `json:"params,omitempty"`
	Topology Topology             `json:"topology"`
	// +optional
	Setup []Action `json:"setup,omitempty"`
	// +optional
	Teardown []Action `json:"teardown,omitempty"`
	// +kubebuilder:validation:MinItems=1
	Checks []Check `json:"checks"`
	// +optional
	Hints []Hint `json:"hints,omitempty"`
	// +optional
	Misconceptions []Misconception `json:"misconceptions,omitempty"`
	Solution       Solution        `json:"solution"`
}

// LabTemplateStatus is the observed state of a LabTemplate.
type LabTemplateStatus struct {
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=lt,categories=cloudtrain
// +kubebuilder:printcolumn:name="Lab",type=string,JSONPath=`.spec.source.id`
// +kubebuilder:printcolumn:name="Version",type=integer,JSONPath=`.spec.source.version`
// +kubebuilder:printcolumn:name="Domain",type=string,JSONPath=`.spec.source.domain`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// LabTemplate is a compiled, immutable lab definition.
type LabTemplate struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   LabTemplateSpec   `json:"spec,omitempty"`
	Status LabTemplateStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// LabTemplateList contains a list of LabTemplate.
type LabTemplateList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []LabTemplate `json:"items"`
}

func init() {
	SchemeBuilder.Register(&LabTemplate{}, &LabTemplateList{})
}
