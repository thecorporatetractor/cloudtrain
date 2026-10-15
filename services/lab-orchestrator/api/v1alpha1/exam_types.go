package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Exam simulation API.
//
// An ExamTemplate is compiled from one entry of `exams` in
// content/curriculum.yaml: the blueprint (objectives, weights, task counts,
// pools), the rules, the retake policy and the score report settings. Pool
// tasks are exam-task labs compiled into ordinary LabTemplates and referenced
// by name, so the exam engine reuses the lab compiler, drivers and grader.
//
// An ExamSession is one candidate attempt. It is built on LabSessions rather
// than replacing them: the controller draws the tasks, writes one resolved
// LabTemplate for the attempt's environment (the union of the drawn tasks'
// topologies and setup when the exam's environment is shared, one per task
// otherwise) and runs it as a LabSession it owns. Provisioning, setup, access
// endpoints, grading and teardown therefore behave exactly as for labs; the
// ExamSession adds the draw, the single timer, the freeze, the post-exam
// grading passes (idempotency re-run, reboot) and the score report.

// ExamEnvironment is how the drawn tasks share infrastructure.
// +kubebuilder:validation:Enum=shared;per-task
type ExamEnvironment string

const (
	ExamEnvironmentShared  ExamEnvironment = "shared"
	ExamEnvironmentPerTask ExamEnvironment = "per-task"
)

// PartialCredit is how a task's checks turn into its score.
// +kubebuilder:validation:Enum=per-check;per-task;none
type PartialCredit string

const (
	// PartialCreditPerCheck scores a task by the weighted share of its passed checks.
	PartialCreditPerCheck PartialCredit = "per-check"
	// PartialCreditPerTask scores a task 100 when every check passes, else 0.
	PartialCreditPerTask PartialCredit = "per-task"
	// PartialCreditNone is the same as per-task.
	PartialCreditNone PartialCredit = "none"
)

// ExamSource identifies the curriculum exam an ExamTemplate was compiled from.
type ExamSource struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Domain is the curriculum domain (or "cross-domain").
	Domain string `json:"domain"`
	// +optional
	AlignsTo []string `json:"alignsTo,omitempty"`
	// Disclaimer is shown before the exam and on the report.
	Disclaimer string `json:"disclaimer"`
	// +optional
	Format string `json:"format,omitempty"`
	// +optional
	Description string `json:"description,omitempty"`
	// Digest is the sha256 of the canonical JSON of the exam definition plus
	// the digests of every pool task's template.
	// +optional
	Digest string `json:"digest,omitempty"`
}

// ExamRules are the exam's rules (curriculum `exams[].rules`).
type ExamRules struct {
	// Timer is "single" (one timer for the whole exam). "per-task" is
	// accepted and treated as single (the curriculum uses single only).
	// +optional
	Timer string `json:"timer,omitempty"`
	// +optional
	AnyOrder bool `json:"anyOrder,omitempty"`
	// +optional
	FlagForReview bool `json:"flagForReview,omitempty"`
	// RebootBeforeGrade reboots every VM (and kubeadm cluster member) after
	// the first grading pass, waits until they are back, and grades again;
	// only state that survives the reboot scores.
	// +optional
	RebootBeforeGrade bool `json:"rebootBeforeGrade,omitempty"`
	// IdempotencyRerun re-runs each task's `exam.rerun` actions after the
	// first grading pass and grades again; checks must still pass.
	// +optional
	IdempotencyRerun bool `json:"idempotencyRerun,omitempty"`
	// +optional
	PartialCredit PartialCredit `json:"partialCredit,omitempty"`
	// +optional
	DocsAllowed string `json:"docsAllowed,omitempty"`
	// +optional
	Notes string `json:"notes,omitempty"`
}

// ExamRetakePolicy is enforced by the gateway (it owns attempt history);
// the orchestrator only honours FreshDraw through ExamSession.spec.avoidTasks.
type ExamRetakePolicy struct {
	// +optional
	FreeRetakes *int32 `json:"freeRetakes,omitempty"`
	// +optional
	CooldownHours *int32 `json:"cooldownHours,omitempty"`
	// +optional
	MaxAttemptsPer30Days *int32 `json:"maxAttemptsPer30Days,omitempty"`
	FreshDraw            bool   `json:"freshDraw"`
	// +optional
	Notes string `json:"notes,omitempty"`
}

// ExamPoolTask is one task an objective can draw.
type ExamPoolTask struct {
	// ID is the exam-task lab id.
	ID string `json:"id"`
	// TemplateRef is the task's LabTemplate in the same namespace.
	TemplateRef TemplateReference `json:"templateRef"`
}

// ExamObjective is one blueprint line.
type ExamObjective struct {
	// ID is the framework objective ref, e.g. "cka:storage".
	ID string `json:"id"`
	// Weight is the objective's share of the exam (decimal; objectives are
	// normalised over those that draw at least one task).
	// +kubebuilder:validation:Pattern=`^[0-9]+(\.[0-9]+)?$`
	Weight string `json:"weight"`
	// Tasks drawn per attempt.
	// +kubebuilder:validation:Minimum=0
	Tasks int32          `json:"tasks"`
	Pool  []ExamPoolTask `json:"pool"`
}

// ExamTemplateSpec is a compiled, immutable exam definition.
// +kubebuilder:validation:XValidation:rule="self == oldSelf",message="ExamTemplate spec is immutable; compile a new one instead"
type ExamTemplateSpec struct {
	Source ExamSource `json:"source"`
	// +kubebuilder:validation:Minimum=1
	DurationMinutes int32 `json:"durationMinutes"`
	// PassMark is the pass threshold in percent (decimal).
	// +kubebuilder:validation:Pattern=`^[0-9]+(\.[0-9]+)?$`
	PassMark string `json:"passMark"`
	// +optional
	PassMarkNote string `json:"passMarkNote,omitempty"`
	// TaskCount is the number of tasks per attempt (sum of objective tasks).
	TaskCount   int32           `json:"taskCount"`
	Environment ExamEnvironment `json:"environment"`
	// +optional
	EnvTier string    `json:"envTier,omitempty"`
	Rules   ExamRules `json:"rules"`
	// +optional
	RetakePolicy ExamRetakePolicy `json:"retakePolicy,omitempty"`
	// +kubebuilder:validation:MinItems=1
	Objectives []ExamObjective `json:"objectives"`
}

// +kubebuilder:object:root=true
// +kubebuilder:resource:scope=Namespaced,shortName=et,categories=cloudtrain
// +kubebuilder:printcolumn:name="Exam",type=string,JSONPath=`.spec.source.id`
// +kubebuilder:printcolumn:name="Tasks",type=integer,JSONPath=`.spec.taskCount`
// +kubebuilder:printcolumn:name="Minutes",type=integer,JSONPath=`.spec.durationMinutes`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// ExamTemplate is a compiled exam simulation definition.
type ExamTemplate struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec ExamTemplateSpec `json:"spec,omitempty"`
}

// +kubebuilder:object:root=true

// ExamTemplateList contains a list of ExamTemplate.
type ExamTemplateList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ExamTemplate `json:"items"`
}

// ExamSessionPhase is the lifecycle phase of an attempt.
// +kubebuilder:validation:Enum=Pending;Provisioning;InProgress;Grading;Completed;Failed
type ExamSessionPhase string

const (
	ExamPending      ExamSessionPhase = "Pending"
	ExamProvisioning ExamSessionPhase = "Provisioning"
	// ExamInProgress: the timer runs; the candidate has access.
	ExamInProgress ExamSessionPhase = "InProgress"
	// ExamGrading: the environment is frozen (no candidate access) and
	// graded.
	ExamGrading ExamSessionPhase = "Grading"
	// ExamCompleted: status.report is final.
	ExamCompleted ExamSessionPhase = "Completed"
	// ExamFailed: the attempt could not run (draw or environment failure);
	// it is not scored.
	ExamFailed ExamSessionPhase = "Failed"
)

// Condition types maintained on ExamSession.
const (
	ExamConditionDrawn               = "Drawn"
	ExamConditionEnvironmentReady    = "EnvironmentReady"
	ExamConditionFrozen              = "Frozen"
	ExamConditionGraded              = "Graded"
	ExamConditionEnvironmentReleased = "EnvironmentReleased"
)

// ExamSessionSpec is one candidate attempt at an exam.
type ExamSessionSpec struct {
	// +kubebuilder:validation:XValidation:rule="self == oldSelf",message="examTemplateRef is immutable"
	ExamTemplateRef TemplateReference `json:"examTemplateRef"`
	Candidate       LearnerRef        `json:"candidate"`
	// Seed drives the draw and every task's params.
	// +kubebuilder:validation:XValidation:rule="self == oldSelf",message="seed is immutable"
	Seed int64 `json:"seed"`
	// AvoidTasks are task ids from the candidate's earlier attempts. With
	// the template's retakePolicy.freshDraw, the draw takes them only when
	// an objective's pool has too few other tasks.
	// +optional
	// +kubebuilder:validation:XValidation:rule="self == oldSelf",message="avoidTasks is immutable"
	AvoidTasks []string `json:"avoidTasks,omitempty"`
	// Duration overrides the exam's durationMinutes (accommodations,
	// verification runs).
	// +optional
	Duration *metav1.Duration `json:"duration,omitempty"`
	// Submit ends the attempt before the deadline: the environment is frozen
	// and graded. It cannot be withdrawn.
	// +optional
	Submit bool `json:"submit,omitempty"`
	// RetainEnvironment keeps the environment after grading (debugging);
	// by default it is torn down as soon as the report is written.
	// +optional
	RetainEnvironment bool `json:"retainEnvironment,omitempty"`
}

// ExamTaskStatus is one drawn task. It never carries hints, solutions or
// expected values: only what the candidate is meant to read.
type ExamTaskStatus struct {
	// Index is the 1-based task number shown to the candidate.
	Index int32 `json:"index"`
	// ID is the exam-task lab id.
	ID string `json:"id"`
	// Objective is the blueprint objective the task was drawn for.
	Objective string `json:"objective"`
	// Weight is the task's share of the total score in percent (decimal).
	Weight string `json:"weight"`
	// Seed resolved the task's params.
	Seed        int64  `json:"seed"`
	TemplateRef string `json:"templateRef"`
	Title       string `json:"title"`
	// Statement is the task description with params resolved (Markdown).
	Statement string `json:"statement"`
	// +optional
	EstimatedMinutes int32 `json:"estimatedMinutes,omitempty"`
	// Environment is the LabSession holding the task.
	Environment string `json:"environment"`
	// Nodes are the topology nodes the task uses (for the terminal picker).
	// +optional
	Nodes []string `json:"nodes,omitempty"`
	// Contexts are the kubeconfig contexts of the task's clusters.
	// +optional
	Contexts []string `json:"contexts,omitempty"`
}

// ExamEnvironmentStatus mirrors one environment LabSession.
type ExamEnvironmentStatus struct {
	// Name of the LabSession.
	Name string `json:"name"`
	// Tasks are the indexes of the tasks it serves.
	Tasks []int32 `json:"tasks"`
	// +optional
	Phase LabSessionPhase `json:"phase,omitempty"`
	// +optional
	EntryNode string `json:"entryNode,omitempty"`
	// +optional
	Nodes []string `json:"nodes,omitempty"`
	// Endpoints are withdrawn once the environment is frozen.
	// +optional
	Endpoints []Endpoint `json:"endpoints,omitempty"`
	// +optional
	Message string `json:"message,omitempty"`
}

// ExamGradingStage is the step of the post-exam grading:
// Freeze -> Initial -> [Rerun -> RerunGrade] -> [Reboot -> RebootWait ->
// RebootGrade] -> Done.
// +kubebuilder:validation:Enum=Freeze;Initial;Rerun;RerunGrade;Reboot;RebootWait;RebootGrade;Done
type ExamGradingStage string

const (
	GradingFreeze      ExamGradingStage = "Freeze"
	GradingInitial     ExamGradingStage = "Initial"
	GradingRerun       ExamGradingStage = "Rerun"
	GradingRerunGrade  ExamGradingStage = "RerunGrade"
	GradingReboot      ExamGradingStage = "Reboot"
	GradingRebootWait  ExamGradingStage = "RebootWait"
	GradingRebootGrade ExamGradingStage = "RebootGrade"
	GradingDone        ExamGradingStage = "Done"
)

// Grading pass names.
const (
	PassInitial = "initial"
	PassRerun   = "rerun"
	PassReboot  = "reboot"
)

// ExamGradingPass is one grading round over every environment.
type ExamGradingPass struct {
	// Name: initial, rerun (after the idempotency re-run) or reboot (after
	// rebooting the VMs).
	Name string `json:"name"`
	// Checks are per-task check results; IDs are "t<index>/<check id>".
	// Output is never kept.
	// +optional
	Checks []CheckResult `json:"checks,omitempty"`
	// +optional
	CompletedAt *metav1.Time `json:"completedAt,omitempty"`
}

// ExamRerunResult is the outcome of one task's idempotency re-run.
type ExamRerunResult struct {
	Task int32 `json:"task"`
	OK   bool  `json:"ok"`
	// Message is learner-safe.
	// +optional
	Message string `json:"message,omitempty"`
}

// ExamGradingStatus tracks the post-exam grading.
type ExamGradingStatus struct {
	Stage ExamGradingStage `json:"stage"`
	// Requests maps environment name to the validateRequest in flight.
	// +optional
	Requests map[string]int64 `json:"requests,omitempty"`
	// +optional
	Passes []ExamGradingPass `json:"passes,omitempty"`
	// +optional
	Reruns []ExamRerunResult `json:"reruns,omitempty"`
	// BootIDs are the pre-reboot boot ids ("<env>/<node>" -> id).
	// +optional
	BootIDs map[string]string `json:"bootIDs,omitempty"`
	// +optional
	RebootStartedAt *metav1.Time `json:"rebootStartedAt,omitempty"`
	// StageStartedAt is when the current stage began (stage timeouts).
	// +optional
	StageStartedAt *metav1.Time `json:"stageStartedAt,omitempty"`
	// +optional
	Message string `json:"message,omitempty"`
}

// TaskOutcome of a scored task.
// +kubebuilder:validation:Enum=pass;partial;fail
type TaskOutcome string

const (
	OutcomePass    TaskOutcome = "pass"
	OutcomePartial TaskOutcome = "partial"
	OutcomeFail    TaskOutcome = "fail"
)

// ExamCheckReport is one check in the score report (learner-safe: no
// expected values, no raw output).
type ExamCheckReport struct {
	ID string `json:"id"`
	// Description is the author's learner-facing check summary.
	// +optional
	Description string `json:"description,omitempty"`
	Passed      bool   `json:"passed"`
	// +optional
	Weight string `json:"weight,omitempty"`
	// +optional
	Skills []string `json:"skills,omitempty"`
	// +optional
	Message string `json:"message,omitempty"`
	// FailedAfterReboot: passed before the reboot, failed after it.
	// +optional
	FailedAfterReboot bool `json:"failedAfterReboot,omitempty"`
	// FailedOnRerun: passed before the idempotency re-run, failed after it
	// (or the re-run itself failed).
	// +optional
	FailedOnRerun bool `json:"failedOnRerun,omitempty"`
}

// ExamTaskReport is one task in the score report.
type ExamTaskReport struct {
	Index     int32  `json:"index"`
	ID        string `json:"id"`
	Title     string `json:"title"`
	Objective string `json:"objective"`
	// Weight is the task's share of the total in percent (decimal).
	Weight  string      `json:"weight"`
	Outcome TaskOutcome `json:"outcome"`
	// Score is the task score in percent (decimal, one place).
	Score  string            `json:"score"`
	Checks []ExamCheckReport `json:"checks"`
}

// ExamObjectiveReport is one objective in the score report.
type ExamObjectiveReport struct {
	ID string `json:"id"`
	// Weight is the objective's normalised share of the total in percent.
	Weight string `json:"weight"`
	Tasks  int32  `json:"tasks"`
	// Score is the objective score in percent (mean of its task scores).
	Score string `json:"score"`
}

// ExamScoreReport is the final result of an attempt.
type ExamScoreReport struct {
	// Score is the weighted total in percent (decimal, one place).
	Score    string `json:"score"`
	PassMark string `json:"passMark"`
	Passed   bool   `json:"passed"`
	// +optional
	PartialCredit PartialCredit         `json:"partialCredit,omitempty"`
	Objectives    []ExamObjectiveReport `json:"objectives"`
	Tasks         []ExamTaskReport      `json:"tasks"`
	// Passes lists the grading passes that ran (initial, rerun, reboot).
	// +optional
	Passes   []string    `json:"passes,omitempty"`
	GradedAt metav1.Time `json:"gradedAt"`
}

// ExamSessionStatus is the observed state of an attempt.
type ExamSessionStatus struct {
	// +optional
	Phase ExamSessionPhase `json:"phase,omitempty"`
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
	// +optional
	// +listType=map
	// +listMapKey=type
	Conditions []metav1.Condition `json:"conditions,omitempty"`
	// Message is learner-safe.
	// +optional
	Message string `json:"message,omitempty"`
	// +optional
	ExamID string `json:"examID,omitempty"`
	// +optional
	Tasks []ExamTaskStatus `json:"tasks,omitempty"`
	// +optional
	Environments []ExamEnvironmentStatus `json:"environments,omitempty"`
	// StartedAt is when every environment became ready (the timer starts).
	// +optional
	StartedAt *metav1.Time `json:"startedAt,omitempty"`
	// Deadline is StartedAt + duration; at the deadline the environment is
	// frozen and graded.
	// +optional
	Deadline *metav1.Time `json:"deadline,omitempty"`
	// +optional
	SubmittedAt *metav1.Time `json:"submittedAt,omitempty"`
	// FrozenAt is when candidate access was revoked.
	// +optional
	FrozenAt *metav1.Time `json:"frozenAt,omitempty"`
	// +optional
	CompletedAt *metav1.Time `json:"completedAt,omitempty"`
	// +optional
	Grading *ExamGradingStatus `json:"grading,omitempty"`
	// +optional
	Report *ExamScoreReport `json:"report,omitempty"`
	// EnvironmentReleased is true once every environment was torn down.
	// +optional
	EnvironmentReleased bool `json:"environmentReleased,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Namespaced,shortName=es,categories=cloudtrain
// +kubebuilder:printcolumn:name="Exam",type=string,JSONPath=`.status.examID`
// +kubebuilder:printcolumn:name="Candidate",type=string,JSONPath=`.spec.candidate.id`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="Deadline",type=date,JSONPath=`.status.deadline`
// +kubebuilder:printcolumn:name="Score",type=string,JSONPath=`.status.report.score`
// +kubebuilder:printcolumn:name="Passed",type=boolean,JSONPath=`.status.report.passed`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// ExamSession is one candidate attempt at an exam simulation.
type ExamSession struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   ExamSessionSpec   `json:"spec,omitempty"`
	Status ExamSessionStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// ExamSessionList contains a list of ExamSession.
type ExamSessionList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ExamSession `json:"items"`
}

// Labels the exam controller puts on the objects it creates.
const (
	// LabelExamSession marks environment LabSessions/LabTemplates (value: ExamSession name).
	LabelExamSession = "labs.cloudtrain.dev/exam-session"
	// LabelExamID marks ExamTemplates and environments with the exam id.
	LabelExamID = "labs.cloudtrain.dev/exam-id"
)

func init() {
	register(&ExamTemplate{}, &ExamTemplateList{}, &ExamSession{}, &ExamSessionList{})
}
