package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// world is the shared, scripted state behind every fake node of an exam
// environment: which checks pass, boot ids, executed commands.
type world struct {
	mu       sync.Mutex
	passing  map[string]bool // marker in a check command -> passes
	failRun  map[string]bool // marker in an action -> exits 1
	boots    map[string]int  // node -> boot counter
	commands []string        // "<node>|<user>|<script>"
	provErr  map[string]error
}

func newWorld() *world {
	return &world{passing: map[string]bool{}, failRun: map[string]bool{}, boots: map[string]int{}, provErr: map[string]error{}}
}

func (w *world) ran(substr string) []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []string
	for _, c := range w.commands {
		if strings.Contains(c, substr) {
			out = append(out, c)
		}
	}
	return out
}

// scriptDriver is a NodeDriver whose Exec consults the world.
type scriptDriver struct {
	name labsv1.DriverName
	w    *world
}

func (d *scriptDriver) Name() labsv1.DriverName { return d.name }
func (d *scriptDriver) Provision(_ context.Context, ref drivers.NodeRef) (drivers.NodeState, error) {
	d.w.mu.Lock()
	defer d.w.mu.Unlock()
	if err := d.w.provErr[ref.Node.Name]; err != nil {
		return drivers.NodeState{}, err
	}
	return drivers.NodeState{Phase: labsv1.NodeReady, InstanceID: "i-" + ref.Node.Name}, nil
}
func (d *scriptDriver) Status(ctx context.Context, ref drivers.NodeRef) (drivers.NodeState, error) {
	return d.Provision(ctx, ref)
}
func (d *scriptDriver) Connect(_ context.Context, ref drivers.NodeRef, a labsv1.AccessType) (labsv1.Endpoint, error) {
	return labsv1.Endpoint{Node: ref.Node.Name, Access: a, Protocol: "k8s-exec", Target: "ns/pod-" + ref.Node.Name + "/node"}, nil
}
func (d *scriptDriver) Reset(context.Context, drivers.NodeRef) error   { return nil }
func (d *scriptDriver) Destroy(context.Context, drivers.NodeRef) error { return nil }
func (d *scriptDriver) Exec(_ context.Context, ref drivers.NodeRef, req drivers.ExecRequest) (drivers.ExecResult, error) {
	d.w.mu.Lock()
	defer d.w.mu.Unlock()
	node := ref.Node.Name
	if req.Member != "" {
		node += "/" + req.Member
	}
	script := strings.Join(req.Command, " ") + string(req.Stdin)
	d.w.commands = append(d.w.commands, fmt.Sprintf("%s|%s|%s", node, req.User, script))
	switch {
	case strings.Contains(script, "boot_id"):
		return drivers.ExecResult{Stdout: fmt.Sprintf("boot-%d\n", d.w.boots[node])}, nil
	case strings.Contains(script, "systemctl reboot"):
		d.w.boots[node]++
		return drivers.ExecResult{}, nil
	}
	for marker, ok := range d.w.passing {
		if strings.Contains(script, marker) {
			if ok {
				return drivers.ExecResult{Stdout: "ok"}, nil
			}
			return drivers.ExecResult{ExitCode: 1}, nil
		}
	}
	for marker := range d.w.failRun {
		if strings.Contains(script, marker) {
			return drivers.ExecResult{ExitCode: 1, Stderr: "changed=1"}, nil
		}
	}
	if strings.Contains(script, "CHECK ") {
		return drivers.ExecResult{ExitCode: 1}, nil // unsolved by default
	}
	return drivers.ExecResult{}, nil
}

const examNS = "exams"

// examTask builds a task LabTemplate: workstation + cluster "core" (+ a VM
// "db" when vm is set), one check per name, an optional rerun action.
func examTask(id string, vm bool, rerun bool, checks ...string) *labsv1.LabTemplate {
	nodes := []labsv1.Node{
		{Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1", Access: []labsv1.AccessType{labsv1.AccessShell}},
		{Name: "core", Driver: labsv1.DriverK8sCluster, Cluster: &labsv1.ClusterSpec{Mode: labsv1.ClusterModeVirtual, Context: "core"}},
	}
	if vm {
		nodes = append(nodes, labsv1.Node{Name: "db", Driver: labsv1.DriverVM, Image: "el-vm:10", Access: []labsv1.AccessType{labsv1.AccessSSH}})
	}
	lt := &labsv1.LabTemplate{
		ObjectMeta: metav1.ObjectMeta{Name: id + "-v1-0123456789", Namespace: examNS},
		Spec: labsv1.LabTemplateSpec{
			Source:      labsv1.LabSource{ID: id, Version: 1, Title: "Task " + id, Domain: "kubernetes", Difficulty: "easy", EstimatedMinutes: 5},
			Description: "Do " + id + " with {{n}} replicas",
			Params:      map[string]labsv1.ParamSpec{"n": {Type: labsv1.ParamInt, Min: ptr.To[int64](2), Max: ptr.To[int64](4)}},
			Topology:    labsv1.Topology{Entry: "workstation", Nodes: nodes},
			Setup:       []labsv1.Action{{On: "core", Run: ptr.To("SETUP " + id)}},
			Hints:       []labsv1.Hint{{Title: "HINT-SECRET", Body: "HINT-SECRET"}},
			Solution:    labsv1.Solution{Explanation: "SOLUTION-SECRET", Steps: []labsv1.Action{{On: "workstation", Run: ptr.To("SOLUTION-SECRET " + id)}}},
		},
	}
	for _, c := range checks {
		lt.Spec.Checks = append(lt.Spec.Checks, labsv1.Check{ID: c, Description: "check " + c, Skills: []string{"sk." + c}, Type: "shell", On: "core",
			Command: fmt.Sprintf("CHECK %s/%s {{n}}", id, c), Weight: "1"})
	}
	if rerun {
		lt.Spec.Exam = &labsv1.ExamTaskSpec{Rerun: []labsv1.Action{{On: "workstation", As: labsv1.ActionAsLearner, Run: ptr.To("RERUN " + id)}}}
	}
	return lt
}

func examTemplate(env labsv1.ExamEnvironment, reboot, rerun bool) *labsv1.ExamTemplate {
	return &labsv1.ExamTemplate{
		ObjectMeta: metav1.ObjectMeta{Name: "sim-x-abc", Namespace: examNS},
		Spec: labsv1.ExamTemplateSpec{
			Source:          labsv1.ExamSource{ID: "sim-x", Title: "Sim X", Domain: "kubernetes", Disclaimer: "d"},
			DurationMinutes: 30, PassMark: "66", TaskCount: 2, Environment: env,
			Rules:        labsv1.ExamRules{Timer: "single", RebootBeforeGrade: reboot, IdempotencyRerun: rerun, PartialCredit: labsv1.PartialCreditPerCheck},
			RetakePolicy: labsv1.ExamRetakePolicy{FreshDraw: true},
			Objectives: []labsv1.ExamObjective{
				{ID: "o:a", Weight: "60", Tasks: 1, Pool: []labsv1.ExamPoolTask{{ID: "ta1", TemplateRef: labsv1.TemplateReference{Name: "ta1-v1-0123456789"}}, {ID: "ta2", TemplateRef: labsv1.TemplateReference{Name: "ta2-v1-0123456789"}}}},
				{ID: "o:b", Weight: "40", Tasks: 1, Pool: []labsv1.ExamPoolTask{{ID: "tb1", TemplateRef: labsv1.TemplateReference{Name: "tb1-v1-0123456789"}}, {ID: "tb2", TemplateRef: labsv1.TemplateReference{Name: "tb2-v1-0123456789"}}}},
			},
		},
	}
}

type examHarness struct {
	t    *testing.T
	c    client.Client
	er   *ExamSessionReconciler
	lr   *LabSessionReconciler
	w    *world
	now  time.Time
	name types.NamespacedName
}

func newExamHarness(t *testing.T, tpl *labsv1.ExamTemplate, mut ...func(*labsv1.ExamSession)) *examHarness {
	t.Helper()
	s := scheme(t)
	es := &labsv1.ExamSession{
		ObjectMeta: metav1.ObjectMeta{Name: "es1", Namespace: examNS, UID: "uid-es1", CreationTimestamp: metav1.NewTime(t0),
			Labels: map[string]string{"labs.cloudtrain.dev/verify": "true"}},
		Spec: labsv1.ExamSessionSpec{ExamTemplateRef: labsv1.TemplateReference{Name: tpl.Name}, Candidate: labsv1.LearnerRef{ID: "cand-1"}, Seed: 11},
	}
	for _, m := range mut {
		m(es)
	}
	objs := []client.Object{tpl, es,
		examTask("ta1", false, false, "a", "b"), examTask("ta2", false, false, "a"),
		examTask("tb1", true, true, "x"), examTask("tb2", true, true, "x", "y")}
	c := fake.NewClientBuilder().WithScheme(s).WithObjects(objs...).
		WithStatusSubresource(&labsv1.LabSession{}, &labsv1.ExamSession{}).Build()
	w := newWorld()
	reg, err := drivers.NewRegistry(&scriptDriver{labsv1.DriverContainer, w}, &scriptDriver{labsv1.DriverK8sCluster, w}, &scriptDriver{labsv1.DriverVM, w})
	if err != nil {
		t.Fatal(err)
	}
	h := &examHarness{t: t, c: c, w: w, now: t0.Add(time.Minute), name: types.NamespacedName{Namespace: examNS, Name: es.Name}}
	clock := func() time.Time { return h.now }
	h.er = &ExamSessionReconciler{Client: c, Scheme: s, Drivers: reg, Now: clock}
	h.lr = &LabSessionReconciler{Client: c, Scheme: s, Drivers: reg, Now: clock}
	return h
}

// pump reconciles the attempt and every LabSession n times.
func (h *examHarness) pump(n int) {
	h.t.Helper()
	ctx := context.Background()
	for i := 0; i < n; i++ {
		if _, err := h.er.Reconcile(ctx, ctrl.Request{NamespacedName: h.name}); err != nil {
			h.t.Fatalf("exam reconcile: %v", err)
		}
		list := &labsv1.LabSessionList{}
		if err := h.c.List(ctx, list, client.InNamespace(examNS)); err != nil {
			h.t.Fatal(err)
		}
		for _, ls := range list.Items {
			if _, err := h.lr.Reconcile(ctx, ctrl.Request{NamespacedName: client.ObjectKeyFromObject(&ls)}); err != nil && !apierrors.IsNotFound(err) {
				h.t.Fatalf("session reconcile %s: %v", ls.Name, err)
			}
		}
	}
}

func (h *examHarness) es() *labsv1.ExamSession {
	h.t.Helper()
	es := &labsv1.ExamSession{}
	if err := h.c.Get(context.Background(), h.name, es); err != nil {
		h.t.Fatal(err)
	}
	return es
}

func (h *examHarness) sessions() []labsv1.LabSession {
	list := &labsv1.LabSessionList{}
	_ = h.c.List(context.Background(), list, client.InNamespace(examNS))
	return list.Items
}

func (h *examHarness) patchES(p string) {
	h.t.Helper()
	if err := h.c.Patch(context.Background(), h.es(), client.RawPatch("application/merge-patch+json", []byte(p))); err != nil {
		h.t.Fatal(err)
	}
}

// solveAll makes every check of the drawn tasks pass.
func (h *examHarness) solveAll() {
	h.w.mu.Lock()
	defer h.w.mu.Unlock()
	h.w.passing["CHECK "] = true
}

func TestExamLifecycleSubmitSharedEnvironment(t *testing.T) {
	h := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentShared, true, true))
	h.pump(3)
	es := h.es()
	if es.Status.Phase != labsv1.ExamInProgress {
		t.Fatalf("phase %s; conditions %+v", es.Status.Phase, es.Status.Conditions)
	}
	if len(es.Status.Tasks) != 2 || es.Status.Tasks[0].Objective != "o:a" || es.Status.Tasks[1].Objective != "o:b" {
		t.Fatalf("tasks %+v", es.Status.Tasks)
	}
	if es.Status.Tasks[0].Weight != "60" || es.Status.Tasks[1].Weight != "40" {
		t.Errorf("weights %s %s", es.Status.Tasks[0].Weight, es.Status.Tasks[1].Weight)
	}
	for _, task := range es.Status.Tasks {
		if strings.Contains(task.Statement, "{{") || !strings.HasPrefix(task.Statement, "Do "+task.ID) || task.Environment != "es1-env" {
			t.Errorf("task %+v", task)
		}
	}
	if es.Status.StartedAt == nil || !es.Status.Deadline.Time.Equal(es.Status.StartedAt.Add(30*time.Minute)) {
		t.Errorf("timer %v %v", es.Status.StartedAt, es.Status.Deadline)
	}
	// One shared environment: union of the drawn tasks' nodes, entry first.
	if len(es.Status.Environments) != 1 {
		t.Fatalf("environments %+v", es.Status.Environments)
	}
	env := es.Status.Environments[0]
	if strings.Join(env.Nodes, ",") != "workstation,core,db" || env.EntryNode != "workstation" || len(env.Endpoints) != 2 || env.Phase != labsv1.SessionReady {
		t.Errorf("environment %+v", env)
	}
	ls := h.sessions()
	if len(ls) != 1 || ls[0].Labels["labs.cloudtrain.dev/verify"] != "true" || ls[0].Labels[labsv1.LabelExamSession] != "es1" || !metav1.IsControlledBy(&ls[0], es) {
		t.Fatalf("sessions %+v", ls)
	}
	if ls[0].Spec.Learner.ID != "cand-1" || ls[0].Spec.ExpiresAt == nil {
		t.Errorf("session spec %+v", ls[0].Spec)
	}
	// Setup of both tasks ran in the one environment.
	if len(h.w.ran("SETUP ")) != 2 {
		t.Errorf("setup ran %v", h.w.ran("SETUP "))
	}
	// Nothing an attempt creates carries hints or solutions.
	envTpl := &labsv1.LabTemplate{}
	if err := h.c.Get(context.Background(), types.NamespacedName{Namespace: examNS, Name: "es1-env"}, envTpl); err != nil {
		t.Fatal(err)
	}
	for what, obj := range map[string]any{"status": es.Status, "environment template": envTpl.Spec} {
		b, _ := json.Marshal(obj)
		if strings.Contains(string(b), "SOLUTION-SECRET") || strings.Contains(string(b), "HINT-SECRET") {
			t.Errorf("%s leaks hints or solutions", what)
		}
	}
	if len(h.w.ran("SOLUTION-SECRET")) != 0 {
		t.Error("solution ran")
	}

	// The candidate solves and submits.
	h.solveAll()
	h.now = h.now.Add(10 * time.Minute)
	h.patchES(`{"spec":{"submit":true}}`)
	h.pump(14)
	es = h.es()
	if es.Status.Phase != labsv1.ExamCompleted {
		t.Fatalf("phase %s grading %+v", es.Status.Phase, es.Status.Grading)
	}
	if es.Status.SubmittedAt == nil || es.Status.FrozenAt == nil || !meta.IsStatusConditionTrue(es.Status.Conditions, labsv1.ExamConditionFrozen) {
		t.Errorf("submit/freeze not recorded: %+v", es.Status)
	}
	rep := es.Status.Report
	if rep == nil || rep.Score != "100" || !rep.Passed || strings.Join(rep.Passes, ",") != "initial,rerun,reboot" {
		t.Fatalf("report %+v", rep)
	}
	for _, tr := range rep.Tasks {
		if tr.Outcome != labsv1.OutcomePass {
			t.Errorf("task %+v", tr)
		}
	}
	// Freeze: learner processes killed on the entry node and the VM.
	if len(h.w.ran("workstation|admin|/bin/sh -c u=learner")) == 0 || len(h.w.ran("db|admin|/bin/sh -c u=learner")) == 0 {
		t.Errorf("revoke script did not run on entry and VM: %v", h.w.ran("u=learner"))
	}
	// Rerun ran for the tb task, reboot hit the VM, grading waited for the new boot.
	if len(h.w.ran("RERUN tb")) != 1 || h.w.boots["db"] != 1 {
		t.Errorf("rerun %v boots %v", h.w.ran("RERUN"), h.w.boots)
	}
	// Environment released: sessions and environment template gone.
	if !es.Status.EnvironmentReleased || len(h.sessions()) != 0 {
		t.Errorf("released=%v sessions=%d", es.Status.EnvironmentReleased, len(h.sessions()))
	}
	if err := h.c.Get(context.Background(), types.NamespacedName{Namespace: examNS, Name: "es1-env"}, envTpl); !apierrors.IsNotFound(err) {
		t.Errorf("environment template still present: %v", err)
	}
	for _, e := range es.Status.Environments {
		if len(e.Endpoints) != 0 {
			t.Errorf("endpoints after completion: %+v", e)
		}
	}
	// No grader output in the stored passes.
	for _, p := range es.Status.Grading.Passes {
		for _, c := range p.Checks {
			if c.Output != "" {
				t.Errorf("output kept in pass %s: %+v", p.Name, c)
			}
		}
	}
}

func TestExamTimerExpiryFreezesAndGrades(t *testing.T) {
	h := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentShared, false, false), func(es *labsv1.ExamSession) {
		es.Spec.Duration = &metav1.Duration{Duration: 2 * time.Minute}
	})
	h.pump(3)
	es := h.es()
	if es.Status.Phase != labsv1.ExamInProgress || !es.Status.Deadline.Time.Equal(es.Status.StartedAt.Add(2*time.Minute)) {
		t.Fatalf("phase %s deadline %v", es.Status.Phase, es.Status.Deadline)
	}
	res, err := h.er.Reconcile(context.Background(), ctrl.Request{NamespacedName: h.name})
	if err != nil || res.RequeueAfter <= 0 || res.RequeueAfter > 2*time.Minute {
		t.Errorf("requeue before deadline: %v %v", res, err)
	}
	// Before the deadline nothing is frozen.
	h.now = h.now.Add(time.Minute)
	h.pump(1)
	if h.es().Status.FrozenAt != nil {
		t.Fatal("frozen before the deadline")
	}
	h.now = h.now.Add(2 * time.Minute)
	// The client's auto-submit lands after the deadline: still a time-out.
	h.patchES(`{"spec":{"submit":true}}`)
	h.pump(2)
	es = h.es()
	if es.Status.FrozenAt == nil || es.Status.SubmittedAt != nil {
		t.Fatalf("frozen %v submitted %v", es.Status.FrozenAt, es.Status.SubmittedAt)
	}
	if c := meta.FindStatusCondition(es.Status.Conditions, labsv1.ExamConditionFrozen); c == nil || (c.Reason != "TimeUp" && c.Reason != "Frozen") {
		t.Errorf("frozen condition %+v", c)
	}
	ls := h.sessions()
	if len(ls) != 1 || !ls[0].Spec.AccessRevoked {
		t.Fatalf("access not revoked: %+v", ls)
	}
	if !meta.IsStatusConditionTrue(ls[0].Status.Conditions, labsv1.ConditionAccessRevoked) || len(ls[0].Status.Endpoints) != 0 {
		t.Errorf("session not frozen: endpoints %v conditions %+v", ls[0].Status.Endpoints, ls[0].Status.Conditions)
	}
	if len(es.Status.Environments[0].Endpoints) != 0 {
		t.Error("attempt still mirrors endpoints after the deadline")
	}
	h.pump(8)
	es = h.es()
	if es.Status.Phase != labsv1.ExamCompleted || es.Status.Report.Passed || es.Status.Report.Score != "0" {
		t.Fatalf("phase %s report %+v", es.Status.Phase, es.Status.Report)
	}
	for _, tr := range es.Status.Report.Tasks {
		if tr.Outcome != labsv1.OutcomeFail {
			t.Errorf("task %+v", tr)
		}
		for _, c := range tr.Checks {
			if c.Message != "not satisfied yet" {
				t.Errorf("message %q", c.Message)
			}
		}
	}
	if strings.Join(es.Status.Report.Passes, ",") != "initial" {
		t.Errorf("passes %v (no reboot/rerun rules)", es.Status.Report.Passes)
	}
}

func TestExamRetakeAvoidsEarlierTasks(t *testing.T) {
	h := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentShared, false, false))
	h.pump(1)
	var first []string
	for _, task := range h.es().Status.Tasks {
		first = append(first, task.ID)
	}
	h2 := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentShared, false, false), func(es *labsv1.ExamSession) {
		es.Spec.AvoidTasks = first
		es.Spec.Seed = 999
	})
	h2.pump(1)
	for _, task := range h2.es().Status.Tasks {
		for _, f := range first {
			if task.ID == f {
				t.Fatalf("retake drew %s again (first %v)", task.ID, first)
			}
		}
	}
}

func TestExamPerTaskEnvironmentsAndRerunFailure(t *testing.T) {
	h := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentPerTask, false, true))
	h.pump(3)
	es := h.es()
	if len(es.Status.Environments) != 2 || es.Status.Environments[0].Name != "es1-t1" || es.Status.Environments[1].Name != "es1-t2" {
		t.Fatalf("environments %+v", es.Status.Environments)
	}
	if es.Status.Phase != labsv1.ExamInProgress {
		t.Fatalf("phase %s", es.Status.Phase)
	}
	h.solveAll()
	h.w.mu.Lock()
	h.w.failRun["RERUN "] = true
	h.w.mu.Unlock()
	h.patchES(`{"spec":{"submit":true}}`)
	h.pump(10)
	rep := h.es().Status.Report
	if rep == nil {
		t.Fatalf("no report: %+v", h.es().Status)
	}
	// Task 1 (no rerun) passes; task 2's rerun failed, so its checks fail.
	if rep.Tasks[0].Outcome != labsv1.OutcomePass || rep.Tasks[1].Outcome != labsv1.OutcomeFail {
		t.Fatalf("tasks %+v", rep.Tasks)
	}
	for _, c := range rep.Tasks[1].Checks {
		if !c.FailedOnRerun {
			t.Errorf("check %+v", c)
		}
	}
	if rep.Score != "60" || rep.Passed {
		t.Errorf("score %s passed %v", rep.Score, rep.Passed)
	}
}

func TestExamEnvironmentFailureIsNotScored(t *testing.T) {
	h := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentShared, false, false))
	h.w.provErr["core"] = fmt.Errorf("image missing: %w", drivers.ErrUnsupported)
	h.pump(4)
	es := h.es()
	if es.Status.Phase != labsv1.ExamFailed || es.Status.Report != nil || es.Status.StartedAt != nil {
		t.Fatalf("status %+v", es.Status)
	}
	if es.Status.Message != ExamMsgEnvFailed || strings.Contains(es.Status.Message, "image") {
		t.Errorf("message %q is not the learner-safe one", es.Status.Message)
	}
	h.pump(2)
	if !h.es().Status.EnvironmentReleased || len(h.sessions()) != 0 {
		t.Errorf("not released: %d sessions", len(h.sessions()))
	}
}

func TestExamTemplateMissingThenFound(t *testing.T) {
	h := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentShared, false, false), func(es *labsv1.ExamSession) {
		es.Spec.ExamTemplateRef.Name = "missing"
	})
	res, err := h.er.Reconcile(context.Background(), ctrl.Request{NamespacedName: h.name})
	if err != nil || res.RequeueAfter != 30*time.Second || h.es().Status.Phase != labsv1.ExamPending {
		t.Fatalf("res %v err %v phase %s", res, err, h.es().Status.Phase)
	}
	h.now = t0.Add(DefaultExamProvisionBudget + time.Minute)
	h.pump(1)
	if h.es().Status.Phase != labsv1.ExamFailed || h.es().Status.Message != ExamMsgDrawFailed {
		t.Errorf("status %+v", h.es().Status)
	}
}

func TestRevokeTargetsAndStickiness(t *testing.T) {
	spec := &labsv1.LabTemplateSpec{Topology: labsv1.Topology{Entry: "ws", Nodes: []labsv1.Node{
		{Name: "ws", Driver: labsv1.DriverContainer},
		{Name: "vm1", Driver: labsv1.DriverVM},
		{Name: "vc", Driver: labsv1.DriverK8sCluster, Cluster: &labsv1.ClusterSpec{Mode: labsv1.ClusterModeVirtual}},
		{Name: "k", Driver: labsv1.DriverK8sCluster, Cluster: &labsv1.ClusterSpec{Mode: labsv1.ClusterModeKubeadm, Nodes: []labsv1.ClusterNode{{Name: "cp"}, {Name: "w1"}}}},
	}}}
	if got := strings.Join(revokeTargets(spec), ","); got != "ws,vm1,k/cp,k/w1" {
		t.Errorf("revoke targets %s", got)
	}
	if got := strings.Join(rebootTargets(&spec.Topology), ","); got != "vm1,k/cp,k/w1" {
		t.Errorf("reboot targets %s", got)
	}
	s := &labsv1.LabSession{}
	if accessRevoked(s) {
		t.Fatal("revoked by default")
	}
	meta.SetStatusCondition(&s.Status.Conditions, metav1.Condition{Type: labsv1.ConditionAccessRevoked, Status: metav1.ConditionTrue, Reason: "x"})
	if !accessRevoked(s) {
		t.Fatal("revocation not sticky after spec cleared")
	}
}

func TestExamWaitsForTaskTemplatesCreatedAlongside(t *testing.T) {
	h := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentShared, false, false))
	// The cache has not seen the task templates yet.
	ctx := context.Background()
	saved := map[string]*labsv1.LabTemplate{}
	for _, id := range []string{"ta1", "ta2", "tb1", "tb2"} {
		lt := &labsv1.LabTemplate{}
		if err := h.c.Get(ctx, types.NamespacedName{Namespace: examNS, Name: id + "-v1-0123456789"}, lt); err != nil {
			t.Fatal(err)
		}
		saved[id] = lt.DeepCopy()
		if err := h.c.Delete(ctx, lt); err != nil {
			t.Fatal(err)
		}
	}
	res, err := h.er.Reconcile(ctx, ctrl.Request{NamespacedName: h.name})
	if err != nil || res.RequeueAfter != 2*time.Second {
		t.Fatalf("res %v err %v", res, err)
	}
	es := h.es()
	if es.Status.Phase != labsv1.ExamPending || len(es.Status.Tasks) != 0 {
		t.Fatalf("status %+v", es.Status)
	}
	if c := meta.FindStatusCondition(es.Status.Conditions, labsv1.ExamConditionDrawn); c == nil || c.Reason != "WaitingForTaskTemplates" {
		t.Errorf("condition %+v", c)
	}
	for _, lt := range saved {
		lt.ResourceVersion = ""
		if err := h.c.Create(ctx, lt); err != nil {
			t.Fatal(err)
		}
	}
	h.pump(3)
	if h.es().Status.Phase != labsv1.ExamInProgress {
		t.Fatalf("phase %s", h.es().Status.Phase)
	}
	// Past the wait, a missing template fails the attempt.
	h2 := newExamHarness(t, examTemplate(labsv1.ExamEnvironmentShared, false, false))
	for id := range saved {
		lt := &labsv1.LabTemplate{}
		_ = h2.c.Get(ctx, types.NamespacedName{Namespace: examNS, Name: id + "-v1-0123456789"}, lt)
		_ = h2.c.Delete(ctx, lt)
	}
	h2.now = t0.Add(taskTemplateWait + time.Minute)
	h2.pump(1)
	if h2.es().Status.Phase != labsv1.ExamFailed {
		t.Errorf("phase %s", h2.es().Status.Phase)
	}
}
