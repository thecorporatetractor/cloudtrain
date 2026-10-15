// Package v1alpha1 contains the labs.cloudtrain.dev/v1alpha1 API: LabTemplate,
// LabSession and WarmPool.
//
// +kubebuilder:object:generate=true
// +groupName=labs.cloudtrain.dev
package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var (
	// GroupVersion is the group version used to register these objects.
	GroupVersion = schema.GroupVersion{Group: "labs.cloudtrain.dev", Version: "v1alpha1"}

	// SchemeBuilder adds the go types of this group-version to a scheme.
	SchemeBuilder = runtime.NewSchemeBuilder(addKnownTypes)

	// AddToScheme adds the types in this group-version to the given scheme.
	AddToScheme = SchemeBuilder.AddToScheme

	// knownTypes is filled by register() from each *_types.go init().
	knownTypes []runtime.Object
)

// register records API types to be added by AddToScheme.
func register(objs ...runtime.Object) { knownTypes = append(knownTypes, objs...) }

func addKnownTypes(s *runtime.Scheme) error {
	s.AddKnownTypes(GroupVersion, knownTypes...)
	metav1.AddToGroupVersion(s, GroupVersion)
	return nil
}
