package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// LabSessionPhase is the coarse lifecycle phase of a LabSession.
// +kubebuilder:validation:Enum=Pending;Provisioning;Ready;Grading;Hibernated;Expired;Failed
type LabSessionPhase string

const (
	SessionPending      LabSessionPhase = "Pending"
	SessionProvisioning LabSessionPhase = "Provisioning"
	SessionReady        LabSessionPhase = "Ready"
	SessionGrading      LabSessionPhase = "Grading"
	SessionHibernated   LabSessionPhase = "Hibernated"
	SessionExpired      LabSessionPhase = "Expired"
	SessionFailed       LabSessionPhase = "Failed"
)

// Condition types maintained on LabSession.
const (
	// ConditionTemplateResolved is True once the template was found and its params resolved.
	ConditionTemplateResolved = "TemplateResolved"
	// ConditionNodesReady is True once every topology node reports Ready.
	ConditionNodesReady = "NodesReady"
	// ConditionSetupComplete is True once all setup actions ran successfully.
	ConditionSetupComplete = "SetupComplete"
	// ConditionReady is True when the learner can use the lab.
	ConditionReady = "Ready"
	// ConditionHibernated is True while the session is hibernated.
	ConditionHibernated = "Hibernated"
	// ConditionExpired is True once the session passed its expiry.
	ConditionExpired = "Expired"
)

// LearnerRef identifies the learner owning a session.
type LearnerRef struct {
	// ID is the stable learner id from the identity service.
	// +kubebuilder:validation:MinLength=1
	ID string `json:"id"`
	// +optional
	Org string `json:"org,omitempty"`
}

// TemplateReference points at a LabTemplate in the session's namespace.
type TemplateReference struct {
	// +kubebuilder:validation:MinLength=1
	Name string `json:"name"`
}

// LabSessionSpec is one learner attempt at a lab.
type LabSessionSpec struct {
	// +kubebuilder:validation:XValidation:rule="self == oldSelf",message="templateRef is immutable"
	TemplateRef TemplateReference `json:"templateRef"`
	Learner     LearnerRef        `json:"learner"`
	// Seed deterministically resolves the template's {{params}}.
	// +kubebuilder:validation:XValidation:rule="self == oldSelf",message="seed is immutable"
	Seed int64 `json:"seed"`
	// TTL from creation after which the session expires. Defaults to twice
	// the lab's estimatedMinutes (minimum 30m).
	// +optional
	TTL *metav1.Duration `json:"ttl,omitempty"`
	// ExpiresAt overrides TTL with an absolute expiry.
	// +optional
	ExpiresAt *metav1.Time `json:"expiresAt,omitempty"`
	// Hibernate releases compute while keeping the session (drivers that
	// support it stop their workloads; endpoints are withdrawn).
	// +optional
	Hibernate bool `json:"hibernate,omitempty"`
	// ResetGeneration requests a lab reset: whenever it is raised above
	// status.observedResetGeneration, every node is reset through its driver
	// and the setup actions run again.
	// +optional
	// +kubebuilder:validation:Minimum=0
	ResetGeneration int64 `json:"resetGeneration,omitempty"`
	// WarmPoolRef names the WarmPool that pre-provisioned this session, if any.
	// +optional
	WarmPoolRef string `json:"warmPoolRef,omitempty"`
	// ValidateRequest asks the controller to grade the session: every time
	// it changes, the grader runs all checks once and publishes the result
	// in status.validation with the same observedRequest.
	// +optional
	ValidateRequest int64 `json:"validateRequest,omitempty"`
}

// NodePhase is the lifecycle phase of a single topology node.
type NodePhase string

const (
	NodePending      NodePhase = "Pending"
	NodeProvisioning NodePhase = "Provisioning"
	NodeReady        NodePhase = "Ready"
	NodeHibernated   NodePhase = "Hibernated"
	NodeFailed       NodePhase = "Failed"
	NodeDestroyed    NodePhase = "Destroyed"
)

// NodeStatus is the observed state of one topology node.
type NodeStatus struct {
	Name   string     `json:"name"`
	Driver DriverName `json:"driver"`
	Phase  NodePhase  `json:"phase"`
	// +optional
	Message string `json:"message,omitempty"`
	// InstanceID identifies the node's current backing instance (e.g. pod UID
	// plus restart count). A change means the node was recreated from its
	// image and setup must run again.
	// +optional
	InstanceID string `json:"instanceID,omitempty"`
	// Details are driver-reported facts about the node (addresses, cluster
	// member states, ...) for the grader and other nodes.
	// +optional
	Details map[string]string `json:"details,omitempty"`
}

// SecretKeyRef selects a key of a Secret in the session's namespace.
type SecretKeyRef struct {
	Name string `json:"name"`
	// +optional
	Key string `json:"key,omitempty"`
}

// Endpoint is how the access gateway reaches one access point of a node.
type Endpoint struct {
	Node   string     `json:"node"`
	Access AccessType `json:"access"`
	// Protocol is e.g. "k8s-exec", "ssh", "http".
	Protocol string `json:"protocol"`
	// Host is a DNS name or IP reachable from the access gateway.
	// +optional
	Host string `json:"host,omitempty"`
	// +optional
	Port int32 `json:"port,omitempty"`
	// Target is protocol-specific, e.g. "namespace/pod/container" for k8s-exec.
	// +optional
	Target string `json:"target,omitempty"`
	// +optional
	URL string `json:"url,omitempty"`
	// SecretRef points at the credential for this endpoint (kubeconfig,
	// password, private key) in the session's namespace.
	// +optional
	SecretRef *SecretKeyRef `json:"secretRef,omitempty"`
}

// LabSessionStatus is the observed state of a LabSession.
type LabSessionStatus struct {
	// +optional
	Phase LabSessionPhase `json:"phase,omitempty"`
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
	// +optional
	// +listType=map
	// +listMapKey=type
	Conditions []metav1.Condition `json:"conditions,omitempty"`
	// ResolvedParams are the param values derived from spec.seed.
	// +optional
	ResolvedParams map[string]string `json:"resolvedParams,omitempty"`
	// +optional
	Nodes []NodeStatus `json:"nodes,omitempty"`
	// Endpoints for access points of the session's nodes.
	// +optional
	Endpoints []Endpoint `json:"endpoints,omitempty"`
	// EntryNode is the node the learner's terminal opens on.
	// +optional
	EntryNode string `json:"entryNode,omitempty"`
	// +optional
	ExpiresAt *metav1.Time `json:"expiresAt,omitempty"`
	// +optional
	ReadyAt *metav1.Time `json:"readyAt,omitempty"`
	// +optional
	Hibernated bool `json:"hibernated,omitempty"`
	// Topology is the resolved topology the session's resources were
	// provisioned from. It is recorded before anything is provisioned and
	// drives teardown, so cleanup never depends on the live LabTemplate.
	// +optional
	Topology *Topology `json:"topology,omitempty"`
	// SetupProgress is the number of setup actions completed so far; it is
	// persisted after every action so retries resume instead of re-running.
	// +optional
	SetupProgress int32 `json:"setupProgress,omitempty"`
	// ObservedResetGeneration is the last spec.resetGeneration acted upon.
	// +optional
	ObservedResetGeneration int64 `json:"observedResetGeneration,omitempty"`
	// Validation is the latest grading result.
	// +optional
	Validation *ValidationStatus `json:"validation,omitempty"`
}

// ValidationPhase is the state of one grading run.
// +kubebuilder:validation:Enum=Running;Complete;Failed
type ValidationPhase string

const (
	ValidationRunning  ValidationPhase = "Running"
	ValidationComplete ValidationPhase = "Complete"
	// ValidationFailed means grading itself failed (not that checks failed).
	ValidationFailed ValidationPhase = "Failed"
)

// ValidationStatus is the result of grading a session.
type ValidationStatus struct {
	// ObservedRequest is the spec.validateRequest this result answers.
	ObservedRequest int64           `json:"observedRequest"`
	Phase           ValidationPhase `json:"phase"`
	// +optional
	Message string `json:"message,omitempty"`
	// +optional
	StartedAt *metav1.Time `json:"startedAt,omitempty"`
	// +optional
	CompletedAt *metav1.Time `json:"completedAt,omitempty"`
	// Score is the weighted percentage of passed checks, 0-100.
	Score int32 `json:"score"`
	// +optional
	Checks []CheckResult `json:"checks,omitempty"`
}

// CheckResult is the outcome of one check.
type CheckResult struct {
	ID     string `json:"id"`
	Passed bool   `json:"passed"`
	// Weight is a decimal, as in the template.
	// +optional
	Weight string `json:"weight,omitempty"`
	// +optional
	Skills []string `json:"skills,omitempty"`
	// Message is a short learner-safe explanation (never the expected value).
	// +optional
	Message string `json:"message,omitempty"`
	// Output is the check's raw output, truncated to 2 KiB, for authors.
	// +optional
	Output string `json:"output,omitempty"`
	// +optional
	DurationMs int64 `json:"durationMs,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=ls,categories=cloudtrain
// +kubebuilder:printcolumn:name="Template",type=string,JSONPath=`.spec.templateRef.name`
// +kubebuilder:printcolumn:name="Learner",type=string,JSONPath=`.spec.learner.id`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Expires",type=date,JSONPath=`.status.expiresAt`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// LabSession is one learner attempt: a running instance of a LabTemplate.
type LabSession struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   LabSessionSpec   `json:"spec,omitempty"`
	Status LabSessionStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// LabSessionList contains a list of LabSession.
type LabSessionList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []LabSession `json:"items"`
}

func init() {
	SchemeBuilder.Register(&LabSession{}, &LabSessionList{})
}
