package controller

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	apiequality "k8s.io/apimachinery/pkg/api/equality"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/events"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	logf "sigs.k8s.io/controller-runtime/pkg/log"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/exam"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/rbac"
)

// Exam defaults.
const (
	// DefaultExamProvisionBudget fails an attempt whose environment is not
	// ready in time (the timer has not started, so it is not scored).
	DefaultExamProvisionBudget = 40 * time.Minute
	// DefaultExamGradingGrace keeps the environment alive past the deadline
	// for the grading passes.
	DefaultExamGradingGrace = 2 * time.Hour
	// DefaultExamStageTimeout bounds one grading wait (a grading round, the
	// reboot); on timeout grading goes on with what it has.
	DefaultExamStageTimeout = 15 * time.Minute

	requeueExam = 5 * time.Second
	// taskTemplateWait tolerates task LabTemplates created together with the
	// attempt that the cache has not seen yet.
	taskTemplateWait = 2 * time.Minute
)

// errTaskTemplatePending: a drawn task's LabTemplate does not exist (yet).
var errTaskTemplatePending = errors.New("task template not found")

// Learner-safe attempt messages.
const (
	ExamMsgPreparing   = "Your exam environment is being prepared. The timer starts when it is ready."
	ExamMsgInProgress  = "The exam is in progress."
	ExamMsgGrading     = "Time is up or the exam was submitted. Your work is being graded; the environment is closed."
	ExamMsgCompleted   = "Your exam has been graded."
	ExamMsgEnvFailed   = "The exam environment could not be prepared. This attempt is not scored and does not count."
	ExamMsgDrawFailed  = "The exam could not be assembled. This attempt is not scored and does not count."
	ExamMsgEnvReleased = "The exam environment was released."
)

// ExamSessionReconciler runs exam attempts on top of LabSessions.
type ExamSessionReconciler struct {
	client.Client
	Scheme   *runtime.Scheme
	Drivers  *drivers.Registry
	Recorder events.EventRecorder
	// Now is injectable for tests.
	Now             func() time.Time
	ProvisionBudget time.Duration
	GradingGrace    time.Duration
	StageTimeout    time.Duration
	// Access, when set, grants the manager its session permissions in the
	// attempt's namespace (grading execs into the environments).
	Access SessionNamespaceAccess
}

// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=examsessions,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=examsessions/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=examsessions/finalizers,verbs=update
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=examtemplates,verbs=get;list;watch
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labtemplates,verbs=get;list;watch;create;delete
// +kubebuilder:rbac:groups=labs.cloudtrain.dev,resources=labsessions,verbs=get;list;watch;create;update;patch;delete

func (r *ExamSessionReconciler) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *ExamSessionReconciler) provisionBudget() time.Duration {
	if r.ProvisionBudget > 0 {
		return r.ProvisionBudget
	}
	return DefaultExamProvisionBudget
}

func (r *ExamSessionReconciler) gradingGrace() time.Duration {
	if r.GradingGrace > 0 {
		return r.GradingGrace
	}
	return DefaultExamGradingGrace
}

func (r *ExamSessionReconciler) stageTimeout() time.Duration {
	if r.StageTimeout > 0 {
		return r.StageTimeout
	}
	return DefaultExamStageTimeout
}

func (r *ExamSessionReconciler) event(obj runtime.Object, typ, reason, msg string) {
	if r.Recorder != nil {
		r.Recorder.Eventf(obj, nil, typ, reason, reason, "%s", msg)
	}
}

func (r *ExamSessionReconciler) setCondition(es *labsv1.ExamSession, typ string, status metav1.ConditionStatus, reason, msg string) {
	meta.SetStatusCondition(&es.Status.Conditions, metav1.Condition{
		Type: typ, Status: status, Reason: reason, Message: msg,
		ObservedGeneration: es.Generation, LastTransitionTime: metav1.NewTime(r.now()),
	})
}

// examRun is the per-reconcile view of an attempt.
type examRun struct {
	es    *labsv1.ExamSession
	tpl   *labsv1.ExamTemplate
	tasks map[int32]*exam.Resolved
	save  func(context.Context) error
}

// Reconcile drives one ExamSession.
func (r *ExamSessionReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := logf.FromContext(ctx)
	es := &labsv1.ExamSession{}
	if err := r.Get(ctx, req.NamespacedName, es); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	if !es.DeletionTimestamp.IsZero() {
		return ctrl.Result{}, nil // owned environments are garbage-collected
	}
	// Grading execs into the environments' pods (session permissions).
	if err := ensureAccess(ctx, r.Access, es.Namespace); err != nil {
		if errors.Is(err, rbac.ErrNamespaceNotLab) {
			log.Info("exam session in a namespace without the lab label; waiting", "namespace", es.Namespace, "label", drivers.LabelLabNamespace)
			return ctrl.Result{RequeueAfter: requeueNamespaceNotLab}, nil
		}
		return ctrl.Result{}, err
	}
	base := es.DeepCopy()
	save := func(ctx context.Context) error {
		es.Status.ObservedGeneration = es.Generation
		if examStatusEqual(&base.Status, &es.Status) {
			return nil
		}
		if err := r.Status().Patch(ctx, es, client.MergeFrom(base)); err != nil {
			return err
		}
		base = es.DeepCopy()
		return nil
	}
	res, err := r.reconcile(ctx, &examRun{es: es, save: save})
	if uerr := save(ctx); uerr != nil {
		return ctrl.Result{}, errors.Join(err, uerr)
	}
	if err != nil {
		log.Error(err, "exam reconcile failed", "phase", es.Status.Phase)
	}
	return res, err
}

func (r *ExamSessionReconciler) reconcile(ctx context.Context, run *examRun) (ctrl.Result, error) {
	es := run.es
	st := &es.Status
	if st.Phase == "" {
		st.Phase = labsv1.ExamPending
		st.Message = ExamMsgPreparing
	}
	if st.Phase == labsv1.ExamCompleted || st.Phase == labsv1.ExamFailed {
		return r.release(ctx, run)
	}

	tpl := &labsv1.ExamTemplate{}
	if err := r.Get(ctx, client.ObjectKey{Namespace: es.Namespace, Name: es.Spec.ExamTemplateRef.Name}, tpl); err != nil {
		if apierrors.IsNotFound(err) && st.Phase == labsv1.ExamPending {
			r.setCondition(es, labsv1.ExamConditionDrawn, metav1.ConditionFalse, "TemplateNotFound", fmt.Sprintf("ExamTemplate %q not found", es.Spec.ExamTemplateRef.Name))
			if r.now().Sub(es.CreationTimestamp.Time) > r.provisionBudget() {
				return r.failAttempt(ctx, run, "TemplateNotFound", ExamMsgDrawFailed)
			}
			return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
		}
		return ctrl.Result{}, err
	}
	run.tpl = tpl
	st.ExamID = tpl.Spec.Source.ID

	// 1. Draw once.
	if len(st.Tasks) == 0 {
		if err := r.draw(ctx, run); err != nil {
			if errors.Is(err, errTaskTemplatePending) && r.now().Sub(es.CreationTimestamp.Time) < taskTemplateWait {
				r.setCondition(es, labsv1.ExamConditionDrawn, metav1.ConditionFalse, "WaitingForTaskTemplates", err.Error())
				return ctrl.Result{RequeueAfter: 2 * time.Second}, nil
			}
			r.setCondition(es, labsv1.ExamConditionDrawn, metav1.ConditionFalse, "DrawFailed", err.Error())
			r.event(es, "Warning", "DrawFailed", err.Error())
			return r.failAttempt(ctx, run, "DrawFailed", ExamMsgDrawFailed)
		}
		if err := run.save(ctx); err != nil {
			return ctrl.Result{}, err
		}
	}
	if run.tasks == nil {
		tasks, err := r.resolveTasks(ctx, es)
		if err != nil {
			r.setCondition(es, labsv1.ExamConditionDrawn, metav1.ConditionFalse, "TaskTemplateMissing", err.Error())
			return r.failAttempt(ctx, run, "TaskTemplateMissing", ExamMsgDrawFailed)
		}
		run.tasks = tasks
	}

	// 2. Environments exist and are mirrored.
	if err := r.ensureEnvironments(ctx, run); err != nil {
		return ctrl.Result{}, err
	}
	envs, err := r.observeEnvironments(ctx, run)
	if err != nil {
		return ctrl.Result{}, err
	}

	switch st.Phase {
	case labsv1.ExamPending, labsv1.ExamProvisioning:
		return r.waitReady(ctx, run, envs)
	case labsv1.ExamInProgress:
		return r.inProgress(ctx, run, envs)
	case labsv1.ExamGrading:
		return r.grading(ctx, run, envs)
	}
	return ctrl.Result{}, nil
}

/* ---------------------------------------------------------------- draw */

func (r *ExamSessionReconciler) draw(ctx context.Context, run *examRun) error {
	es, spec := run.es, &run.tpl.Spec
	drawn, err := exam.Draw(spec, es.Spec.Seed, es.Spec.AvoidTasks)
	if err != nil {
		return err
	}
	tasks := map[int32]*exam.Resolved{}
	var out []labsv1.ExamTaskStatus
	for _, d := range drawn {
		lt := &labsv1.LabTemplate{}
		if err := r.Get(ctx, client.ObjectKey{Namespace: es.Namespace, Name: d.TemplateRef}, lt); err != nil {
			if apierrors.IsNotFound(err) {
				return fmt.Errorf("task %s: LabTemplate %s: %w", d.ID, d.TemplateRef, errTaskTemplatePending)
			}
			return fmt.Errorf("task %s: LabTemplate %s: %w", d.ID, d.TemplateRef, err)
		}
		rt, err := exam.Resolve(d, &lt.Spec)
		if err != nil {
			return err
		}
		tasks[d.Index] = rt
		nodes, contexts := exam.TaskNodes(rt.Spec)
		out = append(out, labsv1.ExamTaskStatus{
			Index: d.Index, ID: d.ID, Objective: d.Objective, Weight: exam.FormatWeight(d.Weight),
			Seed: d.Seed, TemplateRef: d.TemplateRef, Title: rt.Spec.Source.Title,
			Statement: rt.Spec.Description, EstimatedMinutes: rt.Spec.Source.EstimatedMinutes,
			Environment: envName(es, spec.Environment, d.Index), Nodes: nodes, Contexts: contexts,
		})
	}
	es.Status.Tasks = out
	run.tasks = tasks
	ids := make([]string, 0, len(out))
	for _, t := range out {
		ids = append(ids, t.ID)
	}
	r.setCondition(es, labsv1.ExamConditionDrawn, metav1.ConditionTrue, "Drawn", fmt.Sprintf("%d task(s) drawn: %s", len(out), strings.Join(ids, ", ")))
	r.event(es, "Normal", "Drawn", strings.Join(ids, ", "))
	return nil
}

// resolveTasks rebuilds the resolved tasks from status (deterministic).
func (r *ExamSessionReconciler) resolveTasks(ctx context.Context, es *labsv1.ExamSession) (map[int32]*exam.Resolved, error) {
	out := map[int32]*exam.Resolved{}
	for _, t := range es.Status.Tasks {
		lt := &labsv1.LabTemplate{}
		if err := r.Get(ctx, client.ObjectKey{Namespace: es.Namespace, Name: t.TemplateRef}, lt); err != nil {
			return nil, fmt.Errorf("task %s: LabTemplate %s: %w", t.ID, t.TemplateRef, err)
		}
		rt, err := exam.Resolve(exam.Drawn{Index: t.Index, Objective: t.Objective, ID: t.ID, TemplateRef: t.TemplateRef, Seed: t.Seed}, &lt.Spec)
		if err != nil {
			return nil, err
		}
		out[t.Index] = rt
	}
	return out, nil
}

/* -------------------------------------------------------- environments */

func envName(es *labsv1.ExamSession, env labsv1.ExamEnvironment, task int32) string {
	if env == labsv1.ExamEnvironmentPerTask {
		return fmt.Sprintf("%s-t%d", es.Name, task)
	}
	return es.Name + "-env"
}

// envGroups maps environment name -> task indexes (sorted).
func envGroups(es *labsv1.ExamSession) (map[string][]int32, []string) {
	groups := map[string][]int32{}
	var names []string
	for _, t := range es.Status.Tasks {
		if _, ok := groups[t.Environment]; !ok {
			names = append(names, t.Environment)
		}
		groups[t.Environment] = append(groups[t.Environment], t.Index)
	}
	return groups, names
}

func (r *ExamSessionReconciler) duration(run *examRun) time.Duration {
	if d := run.es.Spec.Duration; d != nil && d.Duration > 0 {
		return d.Duration
	}
	return time.Duration(run.tpl.Spec.DurationMinutes) * time.Minute
}

func (r *ExamSessionReconciler) childLabels(es *labsv1.ExamSession) map[string]string {
	l := map[string]string{}
	for k, v := range es.Labels {
		l[k] = v
	}
	l[labsv1.LabelExamSession] = drivers.LabelValue(es.Name)
	l[labsv1.LabelExamID] = drivers.LabelValue(es.Status.ExamID)
	return l
}

// ensureEnvironments creates each environment's LabTemplate and LabSession
// (owned by the attempt) unless the attempt is past grading.
func (r *ExamSessionReconciler) ensureEnvironments(ctx context.Context, run *examRun) error {
	es := run.es
	if es.Status.Phase == labsv1.ExamGrading || es.Status.FrozenAt != nil {
		return nil // never (re)create an environment after the freeze
	}
	groups, names := envGroups(es)
	expires := metav1.NewTime(es.CreationTimestamp.Add(r.provisionBudget() + r.duration(run) + r.gradingGrace()))
	for _, name := range names {
		var tasks []*exam.Resolved
		for _, i := range groups[name] {
			tasks = append(tasks, run.tasks[i])
		}
		lt := &labsv1.LabTemplate{}
		err := r.Get(ctx, client.ObjectKey{Namespace: es.Namespace, Name: name}, lt)
		switch {
		case apierrors.IsNotFound(err):
			spec, err := exam.Environment(exam.EnvironmentMeta{ExamID: run.tpl.Spec.Source.ID, Title: run.tpl.Spec.Source.Title, Duration: int32(r.duration(run).Minutes())}, tasks)
			if err != nil {
				return fmt.Errorf("environment %s: %w", name, err)
			}
			lt = &labsv1.LabTemplate{
				ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: es.Namespace, Labels: r.childLabels(es)},
				Spec:       *spec,
			}
			if err := controllerutil.SetControllerReference(es, lt, r.Scheme); err != nil {
				return err
			}
			if err := r.Create(ctx, lt); err != nil && !apierrors.IsAlreadyExists(err) {
				return fmt.Errorf("create LabTemplate %s: %w", name, err)
			}
		case err != nil:
			return err
		}
		ls := &labsv1.LabSession{}
		err = r.Get(ctx, client.ObjectKey{Namespace: es.Namespace, Name: name}, ls)
		switch {
		case apierrors.IsNotFound(err):
			ls = &labsv1.LabSession{
				ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: es.Namespace, Labels: r.childLabels(es)},
				Spec: labsv1.LabSessionSpec{
					TemplateRef: labsv1.TemplateReference{Name: name},
					Learner:     es.Spec.Candidate,
					Seed:        es.Spec.Seed,
					ExpiresAt:   &expires,
				},
			}
			if err := controllerutil.SetControllerReference(es, ls, r.Scheme); err != nil {
				return err
			}
			if err := r.Create(ctx, ls); err != nil && !apierrors.IsAlreadyExists(err) {
				return fmt.Errorf("create LabSession %s: %w", name, err)
			}
			r.event(es, "Normal", "EnvironmentCreated", name)
		case err != nil:
			return err
		}
	}
	return nil
}

// observeEnvironments reads every environment session and mirrors it into
// status.environments (endpoints only while the attempt is in progress).
func (r *ExamSessionReconciler) observeEnvironments(ctx context.Context, run *examRun) (map[string]*labsv1.LabSession, error) {
	es := run.es
	groups, names := envGroups(es)
	out := map[string]*labsv1.LabSession{}
	var mirror []labsv1.ExamEnvironmentStatus
	for _, name := range names {
		ev := labsv1.ExamEnvironmentStatus{Name: name, Tasks: groups[name]}
		ls := &labsv1.LabSession{}
		if err := r.Get(ctx, client.ObjectKey{Namespace: es.Namespace, Name: name}, ls); err != nil {
			if !apierrors.IsNotFound(err) {
				return nil, err
			}
			ev.Message = "not created yet"
		} else {
			out[name] = ls
			ev.Phase, ev.EntryNode = ls.Status.Phase, ls.Status.EntryNode
			if ls.Status.Topology != nil {
				for _, n := range ls.Status.Topology.Nodes {
					ev.Nodes = append(ev.Nodes, n.Name)
				}
			}
			if es.Status.Phase == labsv1.ExamInProgress && es.Status.FrozenAt == nil && !accessRevoked(ls) {
				ev.Endpoints = ls.Status.Endpoints
			}
			ev.Message = envMessage(ls)
		}
		mirror = append(mirror, ev)
	}
	es.Status.Environments = mirror
	return out, nil
}

// envMessage is a learner-safe summary of an environment session.
func envMessage(ls *labsv1.LabSession) string {
	switch ls.Status.Phase {
	case labsv1.SessionReady, labsv1.SessionGrading:
		if accessRevoked(ls) {
			return "closed"
		}
		return "ready"
	case labsv1.SessionFailed:
		return "failed"
	case labsv1.SessionExpired:
		return "released"
	case "", labsv1.SessionPending:
		return "pending"
	default:
		return "preparing"
	}
}

func envBroken(ls *labsv1.LabSession) bool {
	return ls.Status.Phase == labsv1.SessionFailed || ls.Status.Phase == labsv1.SessionExpired
}

/* ------------------------------------------------------- before / during */

func (r *ExamSessionReconciler) waitReady(ctx context.Context, run *examRun, envs map[string]*labsv1.LabSession) (ctrl.Result, error) {
	es := run.es
	st := &es.Status
	_, names := envGroups(es)
	ready := len(envs) == len(names)
	var waiting []string
	for _, name := range names {
		ls := envs[name]
		if ls == nil {
			ready = false
			continue
		}
		if envBroken(ls) {
			msg := fmt.Sprintf("environment %s is %s", name, ls.Status.Phase)
			if c := meta.FindStatusCondition(ls.Status.Conditions, labsv1.ConditionReady); c != nil {
				msg += ": " + c.Message
			}
			r.setCondition(es, labsv1.ExamConditionEnvironmentReady, metav1.ConditionFalse, "EnvironmentFailed", msg)
			r.event(es, "Warning", "EnvironmentFailed", msg)
			return r.failAttempt(ctx, run, "EnvironmentFailed", ExamMsgEnvFailed)
		}
		if ls.Status.Phase != labsv1.SessionReady {
			ready = false
			waiting = append(waiting, name+"="+string(ls.Status.Phase))
		}
	}
	if !ready {
		st.Phase = labsv1.ExamProvisioning
		st.Message = ExamMsgPreparing
		r.setCondition(es, labsv1.ExamConditionEnvironmentReady, metav1.ConditionFalse, "Provisioning", "waiting for "+strings.Join(waiting, ", "))
		if r.now().Sub(es.CreationTimestamp.Time) > r.provisionBudget() {
			r.setCondition(es, labsv1.ExamConditionEnvironmentReady, metav1.ConditionFalse, "ProvisionTimeout",
				fmt.Sprintf("environment not ready after %s", r.provisionBudget()))
			return r.failAttempt(ctx, run, "ProvisionTimeout", ExamMsgEnvFailed)
		}
		return ctrl.Result{RequeueAfter: requeueExam}, nil
	}
	now := metav1.NewTime(r.now())
	deadline := metav1.NewTime(now.Add(r.duration(run)))
	st.StartedAt, st.Deadline = &now, &deadline
	st.Phase = labsv1.ExamInProgress
	st.Message = ExamMsgInProgress
	r.setCondition(es, labsv1.ExamConditionEnvironmentReady, metav1.ConditionTrue, "Ready", "every environment is ready; the timer started")
	r.event(es, "Normal", "Started", "timer started, deadline "+deadline.UTC().Format(time.RFC3339))
	// Endpoints become visible now.
	if _, err := r.observeEnvironments(ctx, run); err != nil {
		return ctrl.Result{}, err
	}
	return ctrl.Result{RequeueAfter: r.duration(run)}, nil
}

func (r *ExamSessionReconciler) inProgress(ctx context.Context, run *examRun, envs map[string]*labsv1.LabSession) (ctrl.Result, error) {
	es := run.es
	st := &es.Status
	now := r.now()
	for name, ls := range envs {
		if envBroken(ls) {
			// The platform lost the environment mid-attempt: the attempt is
			// not scored (and does not count against the retake policy).
			r.setCondition(es, labsv1.ExamConditionEnvironmentReady, metav1.ConditionFalse, "EnvironmentLost", fmt.Sprintf("environment %s is %s", name, ls.Status.Phase))
			return r.failAttempt(ctx, run, "EnvironmentLost", ExamMsgEnvFailed)
		}
	}
	expired := st.Deadline != nil && !now.Before(st.Deadline.Time)
	// A submit that arrives at or after the deadline (e.g. the client's
	// auto-submit at time-out) is a time-out, not a candidate submit.
	if es.Spec.Submit && st.SubmittedAt == nil && !expired {
		t := metav1.NewTime(now)
		st.SubmittedAt = &t
		r.event(es, "Normal", "Submitted", "submitted by the candidate")
	}
	if st.SubmittedAt == nil && !expired {
		return ctrl.Result{RequeueAfter: st.Deadline.Sub(now)}, nil
	}
	// Time is up (or submitted): freeze, then grade.
	t := metav1.NewTime(now)
	st.FrozenAt = &t
	st.Phase = labsv1.ExamGrading
	st.Message = ExamMsgGrading
	st.Grading = &labsv1.ExamGradingStatus{Stage: labsv1.GradingFreeze, StageStartedAt: &t}
	reason := "Submitted"
	if st.SubmittedAt == nil {
		reason = "TimeUp"
	}
	r.setCondition(es, labsv1.ExamConditionFrozen, metav1.ConditionFalse, reason, "revoking candidate access")
	r.event(es, "Normal", reason, "freezing the environment")
	if _, err := r.observeEnvironments(ctx, run); err != nil {
		return ctrl.Result{}, err
	}
	if err := run.save(ctx); err != nil {
		return ctrl.Result{}, err
	}
	return r.grading(ctx, run, envs)
}

/* -------------------------------------------------------------- grading */

func (r *ExamSessionReconciler) setStage(es *labsv1.ExamSession, stage labsv1.ExamGradingStage) {
	t := metav1.NewTime(r.now())
	es.Status.Grading.Stage = stage
	es.Status.Grading.StageStartedAt = &t
	es.Status.Grading.Requests = nil
	es.Status.Grading.Message = ""
}

func (r *ExamSessionReconciler) stageExpired(es *labsv1.ExamSession) bool {
	g := es.Status.Grading
	return g.StageStartedAt != nil && r.now().Sub(g.StageStartedAt.Time) > r.stageTimeout()
}

func (r *ExamSessionReconciler) grading(ctx context.Context, run *examRun, envs map[string]*labsv1.LabSession) (ctrl.Result, error) {
	es := run.es
	g := es.Status.Grading
	if g == nil {
		t := metav1.NewTime(r.now())
		es.Status.Grading = &labsv1.ExamGradingStatus{Stage: labsv1.GradingFreeze, StageStartedAt: &t}
		g = es.Status.Grading
	}
	switch g.Stage {
	case labsv1.GradingFreeze:
		done, err := r.freeze(ctx, run, envs)
		if err != nil || !done {
			return ctrl.Result{RequeueAfter: requeueExam}, err
		}
		r.setStage(es, labsv1.GradingInitial)
		return ctrl.Result{Requeue: true}, nil
	case labsv1.GradingInitial, labsv1.GradingRerunGrade, labsv1.GradingRebootGrade:
		pass := map[labsv1.ExamGradingStage]string{
			labsv1.GradingInitial: labsv1.PassInitial, labsv1.GradingRerunGrade: labsv1.PassRerun, labsv1.GradingRebootGrade: labsv1.PassReboot,
		}[g.Stage]
		done, err := r.gradePass(ctx, run, envs, pass)
		if err != nil || !done {
			return ctrl.Result{RequeueAfter: 2 * time.Second}, err
		}
		r.setStage(es, r.nextStage(run, g.Stage))
		return ctrl.Result{Requeue: true}, nil
	case labsv1.GradingRerun:
		if err := r.rerun(ctx, run, envs); err != nil {
			return ctrl.Result{}, err
		}
		r.setStage(es, labsv1.GradingRerunGrade)
		return ctrl.Result{Requeue: true}, nil
	case labsv1.GradingReboot:
		if err := r.reboot(ctx, run, envs); err != nil {
			return ctrl.Result{}, err
		}
		r.setStage(es, labsv1.GradingRebootWait)
		return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
	case labsv1.GradingRebootWait:
		up, msg := r.rebootedAndReady(ctx, run, envs)
		if !up && !r.stageExpired(es) {
			g.Message = msg
			return ctrl.Result{RequeueAfter: requeueExam}, nil
		}
		if !up {
			r.event(es, "Warning", "RebootTimeout", msg)
		}
		r.setStage(es, labsv1.GradingRebootGrade)
		return ctrl.Result{Requeue: true}, nil
	case labsv1.GradingDone:
		return r.finish(ctx, run)
	}
	return ctrl.Result{}, nil
}

// nextStage is the stage after a grading pass.
func (r *ExamSessionReconciler) nextStage(run *examRun, after labsv1.ExamGradingStage) labsv1.ExamGradingStage {
	rules := run.tpl.Spec.Rules
	if after == labsv1.GradingInitial && rules.IdempotencyRerun && r.hasReruns(run) {
		return labsv1.GradingRerun
	}
	if after != labsv1.GradingRebootGrade && rules.RebootBeforeGrade && r.hasRebootTargets(run) {
		return labsv1.GradingReboot
	}
	return labsv1.GradingDone
}

func (r *ExamSessionReconciler) hasReruns(run *examRun) bool {
	for _, t := range run.tasks {
		if t.Spec.Exam != nil && len(t.Spec.Exam.Rerun) > 0 {
			return true
		}
	}
	return false
}

func (r *ExamSessionReconciler) hasRebootTargets(run *examRun) bool {
	for _, t := range run.tasks {
		if len(rebootTargets(&t.Spec.Topology)) > 0 {
			return true
		}
	}
	return false
}

// freeze sets accessRevoked on every environment and waits until each one
// confirms (or is gone).
func (r *ExamSessionReconciler) freeze(ctx context.Context, run *examRun, envs map[string]*labsv1.LabSession) (bool, error) {
	es := run.es
	done := true
	for _, ls := range envs {
		if envBroken(ls) {
			continue
		}
		if !ls.Spec.AccessRevoked {
			patch := client.RawPatch("application/merge-patch+json", []byte(`{"spec":{"accessRevoked":true}}`))
			if err := r.Patch(ctx, ls, patch); err != nil {
				return false, fmt.Errorf("revoke %s: %w", ls.Name, err)
			}
			done = false
			continue
		}
		if !meta.IsStatusConditionTrue(ls.Status.Conditions, labsv1.ConditionAccessRevoked) {
			done = false
		}
	}
	if !done && !r.stageExpired(es) {
		return false, nil
	}
	msg := "candidate access revoked on every environment"
	if !done {
		msg = "access revocation not confirmed in time; grading continues"
		r.event(es, "Warning", "FreezeTimeout", msg)
	}
	r.setCondition(es, labsv1.ExamConditionFrozen, metav1.ConditionTrue, "Frozen", msg)
	return true, nil
}

// gradePass bumps validateRequest on every environment and records the
// results as one pass (check output dropped).
func (r *ExamSessionReconciler) gradePass(ctx context.Context, run *examRun, envs map[string]*labsv1.LabSession, pass string) (bool, error) {
	es := run.es
	g := es.Status.Grading
	if g.Requests == nil {
		g.Requests = map[string]int64{}
	}
	_, names := envGroups(es)
	var results []labsv1.CheckResult
	complete := true
	for _, name := range names {
		ls := envs[name]
		if ls == nil || envBroken(ls) {
			continue // its checks stay ungraded (they fail)
		}
		req, ok := g.Requests[name]
		if !ok {
			req = ls.Spec.ValidateRequest + 1
			patch := client.RawPatch("application/merge-patch+json", []byte(fmt.Sprintf(`{"spec":{"validateRequest":%d}}`, req)))
			if err := r.Patch(ctx, ls, patch); err != nil {
				return false, fmt.Errorf("grade %s: %w", name, err)
			}
			g.Requests[name] = req
			complete = false
			continue
		}
		v := ls.Status.Validation
		if v == nil || v.ObservedRequest != req || v.Phase == labsv1.ValidationRunning {
			complete = false
			continue
		}
		for _, c := range v.Checks {
			c.Output = ""
			results = append(results, c)
		}
	}
	if !complete && !r.stageExpired(es) {
		g.Message = "grading " + pass
		return false, nil
	}
	if !complete {
		r.event(es, "Warning", "GradingTimeout", "grading pass "+pass+" incomplete; ungraded checks fail")
	}
	sort.SliceStable(results, func(i, j int) bool { return results[i].ID < results[j].ID })
	t := metav1.NewTime(r.now())
	g.Passes = append(g.Passes, labsv1.ExamGradingPass{Name: pass, Checks: results, CompletedAt: &t})
	r.event(es, "Normal", "GradingPass", fmt.Sprintf("%s: %d check(s) graded", pass, len(results)))
	return true, nil
}

// executor runs actions on an environment's nodes through the drivers.
func (r *ExamSessionReconciler) executor(ctx context.Context, ls *labsv1.LabSession) (*NodeExecutor, error) {
	lt := &labsv1.LabTemplate{}
	if err := r.Get(ctx, client.ObjectKey{Namespace: ls.Namespace, Name: ls.Spec.TemplateRef.Name}, lt); err != nil {
		return nil, err
	}
	spec, _, err := compile.Resolve(&lt.Spec, ls.Spec.Seed, compile.ResolveOptions{})
	if err != nil {
		return nil, err
	}
	return &NodeExecutor{Drivers: r.Drivers, Session: ls, Template: spec}, nil
}

// rerun runs each task's exam.rerun actions once (results persisted per
// task, so a restart does not run a task twice).
func (r *ExamSessionReconciler) rerun(ctx context.Context, run *examRun, envs map[string]*labsv1.LabSession) error {
	es := run.es
	g := es.Status.Grading
	doneTasks := map[int32]bool{}
	for _, rr := range g.Reruns {
		doneTasks[rr.Task] = true
	}
	for _, t := range es.Status.Tasks {
		rt := run.tasks[t.Index]
		if doneTasks[t.Index] || rt.Spec.Exam == nil || len(rt.Spec.Exam.Rerun) == 0 {
			continue
		}
		res := labsv1.ExamRerunResult{Task: t.Index, OK: true}
		ls := envs[t.Environment]
		if ls == nil || envBroken(ls) {
			res.OK, res.Message = false, exam.MsgRerunFailed
		} else {
			ex, err := r.executor(ctx, ls)
			if err != nil {
				return err
			}
			for i, a := range rt.Spec.Exam.Rerun {
				if _, err := ex.RunAction(ctx, a); err != nil {
					if !errors.Is(err, errActionFailed) && !drivers.IsPermanent(err) && ctx.Err() == nil {
						return fmt.Errorf("task %d rerun %d: %w", t.Index, i, err)
					}
					res.OK, res.Message = false, exam.MsgRerunFailed
					logf.FromContext(ctx).Info("idempotency re-run failed", "task", t.ID, "action", i, "err", err.Error())
					break
				}
			}
		}
		g.Reruns = append(g.Reruns, res)
		if err := run.save(ctx); err != nil {
			return err
		}
	}
	return nil
}

// rebootTargets are the nodes rebooted before grading: VMs and kubeadm
// cluster members.
func rebootTargets(topo *labsv1.Topology) []string {
	var out []string
	for _, n := range topo.Nodes {
		switch {
		case n.Driver == labsv1.DriverVM:
			out = append(out, n.Name)
		case n.Driver == labsv1.DriverK8sCluster && n.Cluster != nil && n.Cluster.Mode == labsv1.ClusterModeKubeadm:
			for _, m := range n.Cluster.Nodes {
				out = append(out, n.Name+"/"+m.Name)
			}
		}
	}
	return out
}

const (
	bootIDCommand = "cat /proc/sys/kernel/random/boot_id"
	rebootCommand = "nohup sh -c 'sleep 2; systemctl reboot || reboot' >/dev/null 2>&1 &"
)

func (r *ExamSessionReconciler) envSpec(ctx context.Context, ls *labsv1.LabSession) (*NodeExecutor, []string, error) {
	ex, err := r.executor(ctx, ls)
	if err != nil {
		return nil, nil, err
	}
	return ex, rebootTargets(&ex.Template.Topology), nil
}

// reboot records each target's boot id and reboots it (guest reboot, like
// the real exam's "the system is rebooted before grading").
func (r *ExamSessionReconciler) reboot(ctx context.Context, run *examRun, envs map[string]*labsv1.LabSession) error {
	es := run.es
	g := es.Status.Grading
	if g.BootIDs == nil {
		g.BootIDs = map[string]string{}
	}
	for name, ls := range envs {
		if envBroken(ls) {
			continue
		}
		ex, targets, err := r.envSpec(ctx, ls)
		if err != nil {
			return err
		}
		for _, on := range targets {
			key := name + "/" + on
			if _, ok := g.BootIDs[key]; ok {
				continue
			}
			cmd := bootIDCommand
			out, err := ex.RunAction(ctx, labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &cmd, TimeoutSec: 30})
			if err != nil {
				return fmt.Errorf("boot id %s: %w", key, err)
			}
			rb := rebootCommand
			if _, err := ex.RunAction(ctx, labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &rb, TimeoutSec: 30}); err != nil {
				return fmt.Errorf("reboot %s: %w", key, err)
			}
			g.BootIDs[key] = strings.TrimSpace(out.Stdout)
			if err := run.save(ctx); err != nil {
				return err
			}
		}
	}
	t := metav1.NewTime(r.now())
	g.RebootStartedAt = &t
	r.event(es, "Normal", "Rebooting", fmt.Sprintf("%d node(s) rebooting before grading", len(g.BootIDs)))
	return nil
}

// rebootedAndReady reports whether every rebooted node runs a new boot and
// answers, every kubeadm API server is ready again, and every environment
// is Ready.
func (r *ExamSessionReconciler) rebootedAndReady(ctx context.Context, run *examRun, envs map[string]*labsv1.LabSession) (bool, string) {
	g := run.es.Status.Grading
	var waiting []string
	for name, ls := range envs {
		if envBroken(ls) {
			continue
		}
		ex, targets, err := r.envSpec(ctx, ls)
		if err != nil {
			return false, err.Error()
		}
		for _, on := range targets {
			cmd := bootIDCommand
			out, err := ex.RunAction(ctx, labsv1.Action{On: on, As: labsv1.ActionAsAdmin, Run: &cmd, TimeoutSec: 10})
			if err != nil || strings.TrimSpace(out.Stdout) == "" || strings.TrimSpace(out.Stdout) == g.BootIDs[name+"/"+on] {
				waiting = append(waiting, on)
			}
		}
		for _, n := range ex.Template.Topology.Nodes {
			if n.Driver == labsv1.DriverK8sCluster && n.Cluster != nil && n.Cluster.Mode == labsv1.ClusterModeKubeadm {
				cmd := "kubectl get --raw=/readyz"
				if _, err := ex.RunAction(ctx, labsv1.Action{On: n.Name, As: labsv1.ActionAsAdmin, Run: &cmd, TimeoutSec: 15}); err != nil {
					waiting = append(waiting, n.Name+" API")
				}
			}
		}
		if ls.Status.Phase != labsv1.SessionReady && ls.Status.Phase != labsv1.SessionGrading {
			waiting = append(waiting, name+"="+string(ls.Status.Phase))
		}
	}
	if len(waiting) > 0 {
		return false, "waiting for reboot: " + strings.Join(waiting, ", ")
	}
	return true, ""
}

/* --------------------------------------------------------------- finish */

func (r *ExamSessionReconciler) finish(ctx context.Context, run *examRun) (ctrl.Result, error) {
	es := run.es
	var scored []exam.ScoredTask
	for _, t := range es.Status.Tasks {
		scored = append(scored, exam.ScoredTask{Status: t, Checks: run.tasks[t.Index].Spec.Checks})
	}
	now := metav1.NewTime(r.now())
	es.Status.Report = exam.Score(&run.tpl.Spec, scored, es.Status.Grading, now)
	es.Status.CompletedAt = &now
	es.Status.Phase = labsv1.ExamCompleted
	es.Status.Message = ExamMsgCompleted
	verdict := "failed"
	if es.Status.Report.Passed {
		verdict = "passed"
	}
	r.setCondition(es, labsv1.ExamConditionGraded, metav1.ConditionTrue, "Graded",
		fmt.Sprintf("score %s%% (pass mark %s%%): %s", es.Status.Report.Score, es.Status.Report.PassMark, verdict))
	r.event(es, "Normal", "Graded", fmt.Sprintf("score %s%%, %s", es.Status.Report.Score, verdict))
	if err := run.save(ctx); err != nil {
		return ctrl.Result{}, err
	}
	return r.release(ctx, run)
}

func (r *ExamSessionReconciler) failAttempt(ctx context.Context, run *examRun, reason, msg string) (ctrl.Result, error) {
	es := run.es
	now := metav1.NewTime(r.now())
	es.Status.Phase = labsv1.ExamFailed
	es.Status.Message = msg
	es.Status.CompletedAt = &now
	for i := range es.Status.Environments {
		es.Status.Environments[i].Endpoints = nil
	}
	r.event(es, "Warning", reason, msg)
	if err := run.save(ctx); err != nil {
		return ctrl.Result{}, err
	}
	return r.release(ctx, run)
}

// release tears the environments down (unless spec.retainEnvironment) and
// marks the attempt released once every environment session is gone.
func (r *ExamSessionReconciler) release(ctx context.Context, run *examRun) (ctrl.Result, error) {
	es := run.es
	if es.Status.EnvironmentReleased {
		return ctrl.Result{}, nil
	}
	sel := client.MatchingLabels{labsv1.LabelExamSession: drivers.LabelValue(es.Name)}
	sessions := &labsv1.LabSessionList{}
	if err := r.List(ctx, sessions, client.InNamespace(es.Namespace), sel); err != nil {
		return ctrl.Result{}, err
	}
	if es.Spec.RetainEnvironment {
		for i := range es.Status.Environments {
			es.Status.Environments[i].Endpoints = nil
		}
		return ctrl.Result{}, nil
	}
	remaining := 0
	for i := range sessions.Items {
		ls := &sessions.Items[i]
		if !metav1.IsControlledBy(ls, es) {
			continue
		}
		remaining++
		if ls.DeletionTimestamp.IsZero() {
			if err := r.Delete(ctx, ls); err != nil && !apierrors.IsNotFound(err) {
				return ctrl.Result{}, err
			}
		}
	}
	if remaining > 0 {
		r.setCondition(es, labsv1.ExamConditionEnvironmentReleased, metav1.ConditionFalse, "TearingDown", fmt.Sprintf("%d environment(s) tearing down", remaining))
		return ctrl.Result{RequeueAfter: requeueTeardown}, nil
	}
	templates := &labsv1.LabTemplateList{}
	if err := r.List(ctx, templates, client.InNamespace(es.Namespace), sel); err != nil {
		return ctrl.Result{}, err
	}
	for i := range templates.Items {
		lt := &templates.Items[i]
		if metav1.IsControlledBy(lt, es) {
			if err := r.Delete(ctx, lt); err != nil && !apierrors.IsNotFound(err) {
				return ctrl.Result{}, err
			}
		}
	}
	es.Status.EnvironmentReleased = true
	for i := range es.Status.Environments {
		es.Status.Environments[i].Endpoints = nil
		es.Status.Environments[i].Message = "released"
	}
	r.setCondition(es, labsv1.ExamConditionEnvironmentReleased, metav1.ConditionTrue, "Released", ExamMsgEnvReleased)
	r.event(es, "Normal", "Released", ExamMsgEnvReleased)
	return ctrl.Result{}, nil
}

func examStatusEqual(a, b *labsv1.ExamSessionStatus) bool {
	ac, bc := a.DeepCopy(), b.DeepCopy()
	for i := range ac.Conditions {
		ac.Conditions[i].LastTransitionTime = metav1.Time{}
	}
	for i := range bc.Conditions {
		bc.Conditions[i].LastTransitionTime = metav1.Time{}
	}
	return apiequality.Semantic.DeepEqual(ac, bc)
}

// SetupWithManager registers the reconciler; it watches the environment
// LabSessions it owns.
func (r *ExamSessionReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&labsv1.ExamSession{}).
		Owns(&labsv1.LabSession{}).
		Named("examsession").
		Complete(r)
}
