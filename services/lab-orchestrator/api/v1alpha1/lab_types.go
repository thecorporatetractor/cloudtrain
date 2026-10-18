package v1alpha1

import (
	"k8s.io/apimachinery/pkg/api/resource"
)

// The types in this file mirror the cloudtrain.dev/v3 lab schema
// (packages/lab-schema/schema/lab.schema.json) in a CRD-friendly form:
// defaults are applied by the compiler, floating point numbers become
// quantities or decimal strings, and free-form param values become strings.

// Domain of a lab.
// +kubebuilder:validation:Enum=kubernetes;linux;containers;iac;automation;networking
type Domain string

// Difficulty of a lab.
// +kubebuilder:validation:Enum=easy;medium;hard
type Difficulty string

// DriverName selects the NodeDriver that runs a topology node.
// +kubebuilder:validation:Enum=container;vm;k8s-cluster;netdev
type DriverName string

const (
	DriverContainer  DriverName = "container"
	DriverVM         DriverName = "vm"
	DriverK8sCluster DriverName = "k8s-cluster"
	DriverNetdev     DriverName = "netdev"
)

// AccessType is a way a learner reaches a node.
// +kubebuilder:validation:Enum=shell;ssh;console;web;rdp
type AccessType string

const (
	AccessShell   AccessType = "shell"
	AccessSSH     AccessType = "ssh"
	AccessConsole AccessType = "console"
	AccessWeb     AccessType = "web"
	AccessRDP     AccessType = "rdp"
)

// ClusterMode of a k8s-cluster node.
// +kubebuilder:validation:Enum=virtual;kubeadm
type ClusterMode string

const (
	ClusterModeVirtual ClusterMode = "virtual"
	ClusterModeKubeadm ClusterMode = "kubeadm"
)

// LabSource identifies the lab.yaml a template was compiled from.
type LabSource struct {
	// ID is metadata.id of the lab.
	ID string `json:"id"`
	// Version is metadata.version of the lab (default 1).
	Version int32  `json:"version"`
	Title   string `json:"title"`
	Domain  Domain `json:"domain"`
	// +optional
	Frameworks []string   `json:"frameworks,omitempty"`
	Difficulty Difficulty `json:"difficulty"`
	// +kubebuilder:validation:Minimum=1
	// +kubebuilder:validation:Maximum=240
	EstimatedMinutes int32 `json:"estimatedMinutes"`
	// +optional
	Tags []string `json:"tags,omitempty"`
	// Digest is the sha256 of the canonical JSON form of the source lab.
	// +optional
	Digest string `json:"digest,omitempty"`
}

// ParamType is the kind of a randomised parameter.
// +kubebuilder:validation:Enum=choice;int;name
type ParamType string

const (
	ParamChoice ParamType = "choice"
	ParamInt    ParamType = "int"
	ParamName   ParamType = "name"
)

// ParamSpec defines a value randomised per learner attempt.
type ParamSpec struct {
	Type ParamType `json:"type"`
	// Values for type=choice, rendered as strings.
	// +optional
	Values []string `json:"values,omitempty"`
	// +optional
	Min *int64 `json:"min,omitempty"`
	// +optional
	Max *int64 `json:"max,omitempty"`
	// +optional
	Prefix string `json:"prefix,omitempty"`
	// Default value, rendered as a string.
	// +optional
	Default *string `json:"default,omitempty"`
	// Secret params are never sent to the learner's browser (answer checks
	// reference them for their expected values).
	// +optional
	Secret bool `json:"secret,omitempty"`
}

// Topology is the graph of nodes and links of a lab.
type Topology struct {
	// Entry is the node the learner's terminal opens on.
	// +optional
	Entry string `json:"entry,omitempty"`
	// +kubebuilder:validation:MinItems=1
	// +listType=map
	// +listMapKey=name
	Nodes []Node `json:"nodes"`
	// +optional
	Links []Link `json:"links,omitempty"`
}

// Node is a topology node run by a driver.
type Node struct {
	// +kubebuilder:validation:Pattern=`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`
	Name   string     `json:"name"`
	Driver DriverName `json:"driver"`
	// Image is a catalog image ref, e.g. 'jumphost:1', 'frr:10', 'kubeadm:1.35'.
	// +optional
	Image string `json:"image,omitempty"`
	// +optional
	Resources *NodeResources `json:"resources,omitempty"`
	// +optional
	Access []AccessType `json:"access,omitempty"`
	// LearnerSudo (entry container node only, opt-in security trade-off)
	// allows privilege escalation in the node container so setuid/setgid
	// programs (sudo, crontab, passwd) work for the learner. Default false:
	// allowPrivilegeEscalation is false and the learner cannot become root.
	// +optional
	LearnerSudo bool `json:"learnerSudo,omitempty"`
	// Cluster is only set for driver=k8s-cluster.
	// +optional
	Cluster *ClusterSpec `json:"cluster,omitempty"`
}

// NodeResources requested by a node.
type NodeResources struct {
	// +optional
	CPU *resource.Quantity `json:"cpu,omitempty"`
	// +optional
	MemoryMiB *int64 `json:"memoryMiB,omitempty"`
	// Disks (vm nodes): sizes of extra blank data disks, e.g. ["2Gi", "2Gi"],
	// attached as /dev/vdb, /dev/vdc, ... (serials ct-data1, ct-data2, ...).
	// +optional
	// +kubebuilder:validation:MaxItems=6
	Disks []string `json:"disks,omitempty"`
}

// ClusterSpec describes a Kubernetes cluster node.
type ClusterSpec struct {
	// +optional
	Mode ClusterMode `json:"mode,omitempty"`
	// +optional
	Version string `json:"version,omitempty"`
	// Context is the kubeconfig context name exposed on the entry node.
	// +optional
	Context string `json:"context,omitempty"`
	// +optional
	Nodes []ClusterNode `json:"nodes,omitempty"`
}

// ClusterNodeRole of a kubeadm cluster member.
// +kubebuilder:validation:Enum=control-plane;worker
type ClusterNodeRole string

// ClusterNodeState is the initial state of a kubeadm cluster member.
// +kubebuilder:validation:Enum=ready;notready;unjoined
type ClusterNodeState string

// ClusterNode is a member of a kubeadm cluster.
type ClusterNode struct {
	Name string          `json:"name"`
	Role ClusterNodeRole `json:"role"`
	// +optional
	Taints []string `json:"taints,omitempty"`
	// +optional
	Labels map[string]string `json:"labels,omitempty"`
	// +optional
	State ClusterNodeState `json:"state,omitempty"`
}

// Link is an L2 wire between two node interfaces.
type Link struct {
	// A is "node:interface".
	A string `json:"a"`
	B string `json:"b"`
	// +optional
	Subnet string `json:"subnet,omitempty"`
	// +optional
	Impair *LinkImpairment `json:"impair,omitempty"`
}

// LinkImpairment is applied with tc netem.
type LinkImpairment struct {
	// +optional
	LatencyMs *int32 `json:"latencyMs,omitempty"`
	// LossPct is a decimal percentage, e.g. "0.5".
	// +optional
	// +kubebuilder:validation:Pattern=`^[0-9]+(\.[0-9]+)?$`
	LossPct string `json:"lossPct,omitempty"`
	// +optional
	MTU *int32 `json:"mtu,omitempty"`
}

// ActionUser is the identity an action runs as.
// +kubebuilder:validation:Enum=learner;admin
type ActionUser string

const (
	ActionAsLearner ActionUser = "learner"
	ActionAsAdmin   ActionUser = "admin"
)

// Action runs on a node. Exactly one of run/apply/file/config is set.
// +kubebuilder:validation:XValidation:rule="(has(self.run) ? 1 : 0) + (has(self.apply) ? 1 : 0) + (has(self.file) ? 1 : 0) + (has(self.config) ? 1 : 0) == 1",message="exactly one of run, apply, file, config must be set"
type Action struct {
	// On is a node name, or node/cluster-node for kubeadm cluster members.
	On string `json:"on"`
	// +optional
	As ActionUser `json:"as,omitempty"`
	// +optional
	Run *string `json:"run,omitempty"`
	// +optional
	Apply *string `json:"apply,omitempty"`
	// +optional
	File *FileAction `json:"file,omitempty"`
	// +optional
	Config *string `json:"config,omitempty"`
	// +optional
	TimeoutSec int32 `json:"timeoutSec,omitempty"`
}

// FileAction writes a file on a node. A lab's file.source asset is inlined
// into Content at compile time.
type FileAction struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	// +optional
	Mode string `json:"mode,omitempty"`
}

// CheckType is the kind of a grading check.
// +kubebuilder:validation:Enum=shell;k8s-query;k8s-can-i;k8s-context;file;service-state;reachability;device-cmd;http;answer
type CheckType string

// CheckTypeAnswer is a question the learner answers in the lab view. The
// platform grades the submitted answer; the grader never runs it on a node.
const CheckTypeAnswer CheckType = "answer"

// Check is a typed, skill-tagged grading check.
type Check struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	// +kubebuilder:validation:MinItems=1
	Skills []string `json:"skills"`
	// Weight is a decimal, default "1".
	// +optional
	// +kubebuilder:validation:Pattern=`^[0-9]+(\.[0-9]+)?$`
	Weight string    `json:"weight,omitempty"`
	Type   CheckType `json:"type"`
	// +optional
	On string `json:"on,omitempty"`
	// +optional
	Command string `json:"command,omitempty"`
	// +optional
	Query *CheckQuery `json:"query,omitempty"`
	// +optional
	Target string `json:"target,omitempty"`
	// +optional
	Port *int32 `json:"port,omitempty"`
	// +optional
	Expect *Expectation `json:"expect,omitempty"`
	// +optional
	TimeoutSec int32 `json:"timeoutSec,omitempty"`
	// Answer is set on answer checks only.
	// +optional
	Answer *AnswerSpec `json:"answer,omitempty"`
}

// AnswerMatch is how a submitted answer is compared with the expected one.
// +kubebuilder:validation:Enum=exact;number;regex;any-of
type AnswerMatch string

const (
	AnswerExact  AnswerMatch = "exact"
	AnswerNumber AnswerMatch = "number"
	AnswerRegex  AnswerMatch = "regex"
	AnswerAnyOf  AnswerMatch = "any-of"
)

// AnswerWhitespace is the whitespace normalisation applied before matching.
// +kubebuilder:validation:Enum=trim;collapse;remove;none
type AnswerWhitespace string

const (
	WhitespaceTrim     AnswerWhitespace = "trim"
	WhitespaceCollapse AnswerWhitespace = "collapse"
	WhitespaceRemove   AnswerWhitespace = "remove"
	WhitespaceNone     AnswerWhitespace = "none"
)

// AnswerSpec is the grading side of an answer check. Exactly one of Value,
// Values and Compute is set. Expected values never leave the platform.
type AnswerSpec struct {
	Match AnswerMatch `json:"match"`
	// Value is the expected value (exact, number) or pattern (regex), with
	// {{params}} resolved per session.
	// +optional
	Value *string `json:"value,omitempty"`
	// Values are the accepted values of an any-of answer.
	// +optional
	Values []string `json:"values,omitempty"`
	// Compute derives the expected value from the session after setup; the
	// result is kept in the session's status.computedAnswers.
	// +optional
	Compute *AnswerCompute `json:"compute,omitempty"`
	// +optional
	CaseSensitive bool `json:"caseSensitive,omitempty"`
	// Whitespace normalisation (compiler default "collapse").
	// +optional
	Whitespace AnswerWhitespace `json:"whitespace,omitempty"`
	// Tolerance is the largest accepted absolute difference of a number
	// answer, as a decimal string.
	// +optional
	// +kubebuilder:validation:Pattern=`^[0-9]+(\.[0-9]+)?$`
	Tolerance string `json:"tolerance,omitempty"`
	// Points for a correct answer (compiler default 100).
	// +kubebuilder:validation:Minimum=0
	Points int32 `json:"points"`
	// MaxAttempts is the number of wrong answers allowed before the question
	// closes; 0 = unlimited.
	// +optional
	MaxAttempts int32 `json:"maxAttempts,omitempty"`
	// Penalty is taken off the award for every wrong answer.
	// +optional
	Penalty int32 `json:"penalty,omitempty"`
	// +optional
	Placeholder string `json:"placeholder,omitempty"`
	// +optional
	Hints []AnswerHint `json:"hints,omitempty"`
}

// AnswerCompute runs a command on a lab node to derive an expected answer.
type AnswerCompute struct {
	// On is the node (default: the entry node).
	// +optional
	On      string `json:"on,omitempty"`
	Command string `json:"command"`
	// +optional
	TimeoutSec int32 `json:"timeoutSec,omitempty"`
}

// AnswerHint is a question hint with a point cost.
type AnswerHint struct {
	Body string `json:"body"`
	// +optional
	Cost int32 `json:"cost,omitempty"`
}

// AnswerInput is an answer the verifier submits: a literal Value, or the
// trimmed stdout of Command run on a node.
type AnswerInput struct {
	// +optional
	Value *string `json:"value,omitempty"`
	// +optional
	On string `json:"on,omitempty"`
	// +optional
	As ActionUser `json:"as,omitempty"`
	// +optional
	Command string `json:"command,omitempty"`
	// +optional
	TimeoutSec int32 `json:"timeoutSec,omitempty"`
}

// CheckQuery parameterises k8s-* checks.
type CheckQuery struct {
	// +optional
	Cluster string `json:"cluster,omitempty"`
	// +optional
	Resource string `json:"resource,omitempty"`
	// +optional
	Name string `json:"name,omitempty"`
	// +optional
	Namespace string `json:"namespace,omitempty"`
	// +optional
	JSONPath string `json:"jsonpath,omitempty"`
	// +optional
	Verb string `json:"verb,omitempty"`
	// +optional
	As string `json:"as,omitempty"`
}

// MatchType compares check output with an expected value.
// +kubebuilder:validation:Enum=exact;not_exact;contains;not_contains;regex
type MatchType string

// Expectation of a check.
type Expectation struct {
	Match MatchType `json:"match"`
	Value string    `json:"value"`
}

// Hint shown to a learner on request.
type Hint struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	// +optional
	Command string `json:"command,omitempty"`
	// +optional
	Cost int32 `json:"cost,omitempty"`
}

// Misconception is a plausible wrong approach, also used as a mutation test.
type Misconception struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	// +optional
	Mutation *Action `json:"mutation,omitempty"`
	// Answers are wrong answers for answer checks (by check id), used
	// instead of Mutation.
	// +optional
	Answers map[string]AnswerInput `json:"answers,omitempty"`
	// ExpectFail lists the check ids that must fail after Mutation, or
	// reject the answer given in Answers.
	// +optional
	ExpectFail []string `json:"expectFail,omitempty"`
	// +optional
	Feedback string `json:"feedback,omitempty"`
}

// Solution is the reference solution of a lab.
type Solution struct {
	// +optional
	Explanation string `json:"explanation,omitempty"`
	// Steps solve the end-state checks (at least one of Steps and Answers).
	// +optional
	Steps []Action `json:"steps,omitempty"`
	// Answers are the correct answers of the answer checks (by check id).
	// +optional
	Answers map[string]AnswerInput `json:"answers,omitempty"`
	// Alternatives are other valid solutions; each must pass every check.
	// +optional
	Alternatives []SolutionAlternative `json:"alternatives,omitempty"`
}

// SolutionAlternative is another valid way to solve a lab.
type SolutionAlternative struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	// +kubebuilder:validation:MinItems=1
	Steps []Action `json:"steps"`
}
