package main

// labctl exam run: attempts on a live cluster through the in-cluster
// ExamSession controller, exactly as a candidate's attempt runs.
//
//   --auto-solve  applies each drawn task's reference solution (resolved with
//                 the task's seed) on the attempt's environment, submits, and
//                 expects every task to pass (100 %).
//   --no-solve    submits untouched and expects the attempt to fail.
//   --expire      does not submit: waits for the timer, proves the freeze
//                 (endpoints withdrawn, a learner process started before the
//                 deadline is gone) and grading on time-out.
//   --attempts N  runs N attempts in a row; each retake avoids the earlier
//                 attempts' tasks and must draw disjoint tasks where the
//                 pools allow.
//
// Afterwards every attempt's environment must be released and the namespace
// must hold nothing but what the verifier created.

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/controller"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/exam"
)

// ExamAttemptReport is one attempt of `labctl exam run`.
type ExamAttemptReport struct {
	Name        string                         `json:"name"`
	Seed        int64                          `json:"seed"`
	Avoid       []string                       `json:"avoid,omitempty"`
	Tasks       []DrawnTask                    `json:"tasks"`
	Envs        []labsv1.ExamEnvironmentStatus `json:"environments"`
	EnvNodes    map[string][]string            `json:"environmentNodes,omitempty"`
	ReadySec    float64                        `json:"readySeconds,omitempty"`
	StartedAt   *metav1.Time                   `json:"startedAt,omitempty"`
	Deadline    *metav1.Time                   `json:"deadline,omitempty"`
	SubmittedAt *metav1.Time                   `json:"submittedAt,omitempty"`
	FrozenAt    *metav1.Time                   `json:"frozenAt,omitempty"`
	CompletedAt *metav1.Time                   `json:"completedAt,omitempty"`
	Freeze      *FreezeProof                   `json:"freeze,omitempty"`
	Passes      []string                       `json:"gradingPasses,omitempty"`
	Reruns      []labsv1.ExamRerunResult       `json:"reruns,omitempty"`
	Report      *labsv1.ExamScoreReport        `json:"report,omitempty"`
	Released    bool                           `json:"environmentReleased"`
	OK          bool                           `json:"ok"`
	Errors      []string                       `json:"errors,omitempty"`
	DurationSec float64                        `json:"durationSeconds"`
}

// FreezeProof is what --expire observed at the deadline.
type FreezeProof struct {
	LearnerPIDBefore  string `json:"learnerPidBefore"`
	EndpointsBefore   int    `json:"endpointsBefore"`
	EndpointsAfter    int    `json:"endpointsAfter"`
	AccessRevoked     bool   `json:"accessRevokedCondition"`
	LearnerProcsAfter string `json:"learnerProcessesAfter"`
	// ZombiesAfter are killed learner processes not yet reaped (no live code).
	ZombiesAfter         []string `json:"killedZombiesAfter,omitempty"`
	FrozenAfterDeadlineS int64    `json:"frozenSecondsAfterDeadline"`
}

// ExamRunReport is written to <out>/<exam>-<mode>.json.
type ExamRunReport struct {
	Exam           string              `json:"exam"`
	Mode           string              `json:"mode"`
	Namespace      string              `json:"namespace"`
	StartedAt      time.Time           `json:"startedAt"`
	Attempts       []ExamAttemptReport `json:"attempts"`
	RetakeDisjoint *bool               `json:"retakeDisjoint,omitempty"`
	Teardown       string              `json:"teardown"`
	Leftovers      []string            `json:"leftovers,omitempty"`
	OK             bool                `json:"ok"`
	Errors         []string            `json:"errors,omitempty"`
	DurationSec    float64             `json:"durationSeconds"`
}

type examRunOpts struct {
	verifyOpts
	mode     string // auto-solve | no-solve
	expire   bool
	attempts int
	seed     int64
	duration time.Duration
}

func cmdExamRun(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("exam run", flag.ContinueOnError)
	fl.SetOutput(stderr)
	var src examSource
	src.bind(fl)
	o := examRunOpts{}
	autoSolve := fl.Bool("auto-solve", false, "apply every drawn task's reference solution, then submit (expect 100 %)")
	noSolve := fl.Bool("no-solve", false, "submit without solving (expect a fail)")
	fl.BoolVar(&o.expire, "expire", false, "do not submit: wait for the timer and prove the freeze (use with --duration)")
	fl.IntVar(&o.attempts, "attempts", 1, "attempts in a row (retakes avoid earlier tasks)")
	fl.Int64Var(&o.seed, "seed", 0, "seed of the first attempt (default random; later attempts add 1)")
	fl.DurationVar(&o.duration, "duration", 0, "override the exam duration (e.g. 3m)")
	fl.StringVar(&o.kubeContext, "context", "", "kubeconfig context (default: current context; never changed)")
	fl.StringVar(&o.kubeconfig, "kubeconfig", "", "kubeconfig file")
	fl.BoolVar(&o.keep, "keep", false, "keep the namespace (skips the teardown check)")
	fl.StringVar(&o.outDir, "out", "", "report directory (default: <repo>/deploy/.results/exams)")
	fl.DurationVar(&o.readyTimeout, "ready-timeout", 25*time.Minute, "max time for the environment to become ready")
	fl.DurationVar(&o.gradeTimeout, "grade-timeout", 20*time.Minute, "max time from submit/deadline to the report")
	fl.DurationVar(&o.teardownTimeout, "teardown-timeout", 10*time.Minute, "max time for the environment teardown")
	sessionLabel := fl.String("session-label", verifyLabel+"=true", "label key=value on every ExamSession (match it with the manager's --session-selector)")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	if fl.NArg() != 1 || *autoSolve == *noSolve {
		fmt.Fprintln(stderr, "usage: labctl exam run (--auto-solve|--no-solve) [flags] <exam-id>")
		return 2
	}
	o.mode = "no-solve"
	if *autoSolve {
		o.mode = "auto-solve"
	}
	k, val, ok := strings.Cut(*sessionLabel, "=")
	if !ok || k == "" {
		fmt.Fprintln(stderr, "--session-label must be key=value")
		return 2
	}
	o.sessionLabels = map[string]string{k: val}
	if o.seed == 0 {
		o.seed = rand.Int64N(1<<31-1) + 1
	}
	defs, labs, err := src.load(fl.Args())
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	compiled, err := exam.Compile(defs[0], labs, exam.CompileOptions{AllowMissing: src.allowMissing})
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if o.outDir == "" {
		o.outDir = filepath.Join(src.repoRoot, "deploy", ".results", "exams")
	}
	cfg, err := restConfig(o.kubeconfig, o.kubeContext)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	v, err := newVerifier(cfg, o.verifyOpts, stderr)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	rep := (&examRunner{v: v, o: o, c: compiled}).run(ctx)

	if err := os.MkdirAll(o.outDir, 0o750); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	suffix := o.mode
	if o.expire {
		suffix += "-expire"
	}
	path := filepath.Join(o.outDir, fmt.Sprintf("%s-%s.json", rep.Exam, suffix))
	b, _ := json.MarshalIndent(rep, "", "  ")
	if err := os.WriteFile(path, append(b, '\n'), 0o600); err != nil {
		fmt.Fprintln(stderr, err)
	}
	printExamSummary(stdout, rep)
	fmt.Fprintf(stdout, "\nreport: %s\n", path)
	if !rep.OK {
		return 1
	}
	return 0
}

type examRunner struct {
	v *verifier
	o examRunOpts
	c *exam.Compiled
}

func (x *examRunner) run(ctx context.Context) *ExamRunReport {
	start := time.Now()
	spec := &x.c.Exam.Spec
	ns := nsName(spec.Source.ID, "exam")
	rep := &ExamRunReport{Exam: spec.Source.ID, Mode: x.o.mode, Namespace: ns, StartedAt: start}
	if x.o.expire {
		rep.Mode += "+expire"
	}
	fail := func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		rep.Errors = append(rep.Errors, msg)
		x.v.logf("FAIL %s", msg)
	}
	defer func() { rep.DurationSec = time.Since(start).Seconds() }()

	if err := x.setup(ctx, ns); err != nil {
		fail("setup: %v", err)
		x.cleanup(context.WithoutCancel(ctx), rep)
		return rep
	}
	var avoid []string
	for i := 0; i < x.o.attempts; i++ {
		ar := x.attempt(ctx, ns, x.o.seed+int64(i), avoid)
		rep.Attempts = append(rep.Attempts, ar)
		for _, t := range ar.Tasks {
			avoid = append(avoid, t.ID)
		}
		if ctx.Err() != nil {
			break
		}
	}
	if len(rep.Attempts) > 1 {
		disjoint := retakeDisjoint(spec, rep.Attempts)
		rep.RetakeDisjoint = &disjoint
		if !disjoint {
			fail("a retake drew a task of an earlier attempt although the pools allow a fresh draw")
		}
	}
	x.cleanup(context.WithoutCancel(ctx), rep)
	rep.OK = len(rep.Errors) == 0 && (rep.Teardown == "clean" || rep.Teardown == "skipped" && x.o.keep)
	for _, a := range rep.Attempts {
		rep.OK = rep.OK && a.OK
	}
	return rep
}

// retakeDisjoint checks that each later attempt avoided the earlier tasks of
// every objective whose pool had enough unused tasks left.
func retakeDisjoint(spec *labsv1.ExamTemplateSpec, attempts []ExamAttemptReport) bool {
	used := map[string]bool{}
	for _, a := range attempts {
		for _, o := range spec.Objectives {
			free := 0
			for _, p := range o.Pool {
				if !used[p.ID] {
					free++
				}
			}
			if free < int(o.Tasks) {
				continue // the pool cannot avoid every earlier task
			}
			for _, t := range a.Tasks {
				if t.Objective == o.ID && used[t.ID] {
					return false
				}
			}
		}
		for _, t := range a.Tasks {
			used[t.ID] = true
		}
	}
	return true
}

func (x *examRunner) setup(ctx context.Context, ns string) error {
	err := x.v.c.Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns, Labels: sessionNamespaceLabels(map[string]string{
		verifyLabel: "true", labsv1.LabelExamID: x.c.Exam.Spec.Source.ID,
	})}})
	if err != nil {
		return err
	}
	for _, t := range x.c.Tasks {
		lt := t.DeepCopy()
		lt.Namespace = ns
		if err := x.v.c.Create(ctx, lt); err != nil {
			return fmt.Errorf("LabTemplate %s: %w", lt.Name, err)
		}
	}
	et := x.c.Exam.DeepCopy()
	et.Namespace = ns
	if err := x.v.c.Create(ctx, et); err != nil {
		return fmt.Errorf("ExamTemplate: %w", err)
	}
	x.v.logf("namespace %s: %d task template(s) + ExamTemplate %s", ns, len(x.c.Tasks), et.Name)
	return nil
}

func (x *examRunner) attempt(ctx context.Context, ns string, seed int64, avoid []string) (ar ExamAttemptReport) {
	start := time.Now()
	ar = ExamAttemptReport{Name: "es-" + randSuffix(), Seed: seed, Avoid: avoid}
	tag := ar.Name
	fail := func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		ar.Errors = append(ar.Errors, msg)
		x.v.logf("%s FAIL %s", tag, msg)
	}
	defer func() {
		ar.DurationSec = time.Since(start).Seconds()
		ar.OK = len(ar.Errors) == 0
	}()

	es := &labsv1.ExamSession{
		ObjectMeta: metav1.ObjectMeta{Name: ar.Name, Namespace: ns, Labels: x.o.sessionLabels},
		Spec: labsv1.ExamSessionSpec{
			ExamTemplateRef: labsv1.TemplateReference{Name: x.c.Exam.Name},
			Candidate:       labsv1.LearnerRef{ID: "exam-verifier"},
			Seed:            seed,
			AvoidTasks:      avoid,
		},
	}
	if x.o.duration > 0 {
		es.Spec.Duration = &metav1.Duration{Duration: x.o.duration}
	}
	if err := x.v.c.Create(ctx, es); err != nil {
		fail("create ExamSession: %v", err)
		return ar
	}
	x.v.logf("%s: seed %d, avoid %v", tag, seed, avoid)

	// The offline preview must match what the controller drew.
	want, resolved, _, err := preview(x.c, seed, avoid, false)
	if err != nil {
		fail("preview: %v", err)
		return ar
	}
	ar.Tasks = want.Tasks

	cur, err := x.waitExam(ctx, es, x.o.readyTimeout, func(e *labsv1.ExamSession) bool {
		return e.Status.Phase == labsv1.ExamInProgress || e.Status.Phase == labsv1.ExamFailed || e.Status.Phase == labsv1.ExamCompleted
	})
	if err != nil {
		fail("not in progress: %v", err)
		return x.finishAttempt(ctx, ar, es)
	}
	if cur.Status.Phase != labsv1.ExamInProgress {
		fail("phase %s: %s", cur.Status.Phase, conditionMessages(cur.Status.Conditions))
		return x.finishAttempt(ctx, ar, es)
	}
	ar.ReadySec = time.Since(start).Seconds()
	ar.StartedAt, ar.Deadline = cur.Status.StartedAt, cur.Status.Deadline
	ar.Envs = cur.Status.Environments
	x.v.logf("%s: in progress after %.0fs, deadline %s", tag, ar.ReadySec, cur.Status.Deadline.UTC().Format(time.RFC3339))

	// Draw = preview; environment = union of the drawn tasks' nodes.
	if got := drawnIDs(cur.Status.Tasks); got != taskIDs(want.Tasks) {
		fail("controller drew %s, preview %s", got, taskIDs(want.Tasks))
	}
	ar.EnvNodes = map[string][]string{}
	for _, e := range cur.Status.Environments {
		ar.EnvNodes[e.Name] = e.Nodes
	}
	for _, w := range want.Envs {
		name := ar.Name + "-" + w.Name
		got := append([]string{}, ar.EnvNodes[name]...)
		wantNodes := topoNodes(w)
		if strings.Join(got, ",") != strings.Join(wantNodes, ",") {
			fail("environment %s nodes %v, want %v", name, got, wantNodes)
		}
	}
	for _, e := range cur.Status.Environments {
		if len(e.Endpoints) == 0 {
			fail("environment %s publishes no endpoints while in progress", e.Name)
		}
	}
	for _, t := range cur.Status.Tasks {
		if strings.Contains(t.Statement, "{{") {
			fail("task %d statement has unresolved params", t.Index)
		}
	}

	if x.o.mode == "auto-solve" {
		if err := x.solve(ctx, cur, resolved); err != nil {
			fail("auto-solve: %v", err)
			return x.finishAttempt(ctx, ar, es)
		}
	}

	if x.o.expire {
		proof, err := x.proveFreeze(ctx, cur)
		ar.Freeze = proof
		if err != nil {
			fail("freeze: %v", err)
		}
	} else {
		patch := client.RawPatch("application/merge-patch+json", []byte(`{"spec":{"submit":true}}`))
		if err := x.v.c.Patch(ctx, es, patch); err != nil {
			fail("submit: %v", err)
			return x.finishAttempt(ctx, ar, es)
		}
		x.v.logf("%s: submitted", tag)
	}

	done, err := x.waitExam(ctx, es, x.o.gradeTimeout+x.o.duration, func(e *labsv1.ExamSession) bool {
		return e.Status.Phase == labsv1.ExamCompleted || e.Status.Phase == labsv1.ExamFailed
	})
	if err != nil {
		fail("no report: %v", err)
		return x.finishAttempt(ctx, ar, es)
	}
	ar.SubmittedAt, ar.FrozenAt, ar.CompletedAt = done.Status.SubmittedAt, done.Status.FrozenAt, done.Status.CompletedAt
	if done.Status.Grading != nil {
		ar.Reruns = done.Status.Grading.Reruns
	}
	if done.Status.Phase != labsv1.ExamCompleted || done.Status.Report == nil {
		fail("phase %s: %s", done.Status.Phase, conditionMessages(done.Status.Conditions))
		return x.finishAttempt(ctx, ar, es)
	}
	ar.Report = done.Status.Report
	ar.Passes = done.Status.Report.Passes
	x.v.logf("%s: score %s%% (pass mark %s%%), passed=%v", tag, ar.Report.Score, ar.Report.PassMark, ar.Report.Passed)
	switch x.o.mode {
	case "auto-solve":
		if !ar.Report.Passed || ar.Report.Score != "100" {
			fail("auto-solve scored %s%% (passed=%v), want 100%%", ar.Report.Score, ar.Report.Passed)
		}
		for _, t := range ar.Report.Tasks {
			if t.Outcome != labsv1.OutcomePass {
				for _, c := range t.Checks {
					if !c.Passed {
						fail("task %d %s check %s: %s", t.Index, t.ID, c.ID, c.Message)
					}
				}
			}
		}
	case "no-solve":
		if ar.Report.Passed {
			fail("no-solve passed with %s%%", ar.Report.Score)
		}
	}
	if x.o.expire && done.Status.SubmittedAt != nil {
		fail("--expire attempt shows a submit")
	}
	return x.finishAttempt(ctx, ar, es)
}

// finishAttempt waits for the environment release and records it.
func (x *examRunner) finishAttempt(ctx context.Context, ar ExamAttemptReport, es *labsv1.ExamSession) ExamAttemptReport {
	cur, err := x.waitExam(ctx, es, x.o.teardownTimeout, func(e *labsv1.ExamSession) bool {
		return e.Status.EnvironmentReleased || (e.Status.Phase != labsv1.ExamCompleted && e.Status.Phase != labsv1.ExamFailed)
	})
	if err == nil && cur.Status.EnvironmentReleased {
		ar.Released = true
		sessions := &labsv1.LabSessionList{}
		if err := x.v.c.List(ctx, sessions, client.InNamespace(es.Namespace), client.MatchingLabels{labsv1.LabelExamSession: es.Name}); err == nil && len(sessions.Items) > 0 {
			ar.Errors = append(ar.Errors, fmt.Sprintf("%d environment session(s) left after release", len(sessions.Items)))
		}
	} else if cur != nil && (cur.Status.Phase == labsv1.ExamCompleted || cur.Status.Phase == labsv1.ExamFailed) {
		ar.Errors = append(ar.Errors, "environment not released")
	}
	return ar
}

func topoNodes(e DrawEnvironent) []string { return e.Nodes }

func drawnIDs(ts []labsv1.ExamTaskStatus) string {
	var ids []string
	for _, t := range ts {
		ids = append(ids, t.ID)
	}
	return strings.Join(ids, ",")
}

func taskIDs(ts []DrawnTask) string {
	var ids []string
	for _, t := range ts {
		ids = append(ids, t.ID)
	}
	return strings.Join(ids, ",")
}

func conditionMessages(cs []metav1.Condition) string {
	var out []string
	for _, c := range cs {
		if c.Status != metav1.ConditionTrue {
			out = append(out, c.Type+": "+c.Message)
		}
	}
	return strings.Join(out, "; ")
}

func (x *examRunner) waitExam(ctx context.Context, es *labsv1.ExamSession, timeout time.Duration, done func(*labsv1.ExamSession) bool) (*labsv1.ExamSession, error) {
	deadline := time.Now().Add(timeout)
	last := ""
	for {
		cur := &labsv1.ExamSession{}
		if err := x.v.c.Get(ctx, client.ObjectKeyFromObject(es), cur); err != nil {
			return nil, err
		}
		if done(cur) {
			return cur, nil
		}
		msg := string(cur.Status.Phase)
		if g := cur.Status.Grading; g != nil {
			msg += "/" + string(g.Stage)
		}
		if c := meta.FindStatusCondition(cur.Status.Conditions, labsv1.ExamConditionEnvironmentReady); c != nil && c.Status != metav1.ConditionTrue {
			msg += ": " + c.Message
		}
		if msg != last {
			x.v.logf("%s: %s", es.Name, msg)
			last = msg
		}
		if time.Now().After(deadline) {
			return cur, fmt.Errorf("timed out after %s (%s)", timeout, msg)
		}
		select {
		case <-ctx.Done():
			return cur, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

// envExecutor builds an executor on an environment session.
func (x *examRunner) envExecutor(ctx context.Context, ns, name string) (*controller.NodeExecutor, error) {
	ls := &labsv1.LabSession{}
	if err := x.v.c.Get(ctx, client.ObjectKey{Namespace: ns, Name: name}, ls); err != nil {
		return nil, err
	}
	lt := &labsv1.LabTemplate{}
	if err := x.v.c.Get(ctx, client.ObjectKey{Namespace: ns, Name: ls.Spec.TemplateRef.Name}, lt); err != nil {
		return nil, err
	}
	spec, _, err := compile.Resolve(&lt.Spec, ls.Spec.Seed, compile.ResolveOptions{})
	if err != nil {
		return nil, err
	}
	return &controller.NodeExecutor{Drivers: x.v.rt.Registry, Session: ls, Template: spec}, nil
}

// solve applies each drawn task's reference solution on its environment.
// The solutions come from the task templates resolved with the task seed
// (never from the attempt's objects, which do not carry them).
func (x *examRunner) solve(ctx context.Context, es *labsv1.ExamSession, resolved []*exam.Resolved) error {
	byIndex := map[int32]*exam.Resolved{}
	for _, r := range resolved {
		byIndex[r.Index] = r
	}
	for _, t := range es.Status.Tasks {
		rt := byIndex[t.Index]
		if rt == nil || rt.ID != t.ID {
			return fmt.Errorf("task %d: no resolved task %s", t.Index, t.ID)
		}
		ex, err := x.envExecutor(ctx, es.Namespace, t.Environment)
		if err != nil {
			return err
		}
		for i, a := range rt.Spec.Solution.Steps {
			sctx, cancel := context.WithTimeout(ctx, controller.ActionRequest(a).Timeout+time.Minute)
			res, err := ex.RunAction(sctx, a)
			cancel()
			if err != nil {
				return fmt.Errorf("task %d %s step %d: %v (stdout: %s)", t.Index, t.ID, i, err, tail(res.Stdout, 300))
			}
		}
		x.v.logf("%s: solved task %d %s", es.Name, t.Index, t.ID)
	}
	return nil
}

// learnerProcs lists the learner's live processes on a node (as root).
// Killed processes whose parent is gone stay as zombies until the
// container's PID 1 reaps them (the jumphost has no reaping init); they hold
// no resources and run nothing, so they are reported separately as "Z<pid>".
const learnerProcs = `uid=$(id -u learner 2>/dev/null) || exit 0
for d in /proc/[0-9]*; do
  [ "$(awk '/^Uid:/{print $2}' "$d/status" 2>/dev/null)" = "$uid" ] || continue
  if [ "$(awk '/^State:/{print $2}' "$d/status" 2>/dev/null)" = Z ]; then printf 'Z%s ' "${d#/proc/}"; continue; fi
  printf '%s:%s ' "${d#/proc/}" "$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)"
done; true`

// proveFreeze starts a learner background process, waits for the deadline
// and checks that access was revoked and the process is gone.
func (x *examRunner) proveFreeze(ctx context.Context, es *labsv1.ExamSession) (*FreezeProof, error) {
	p := &FreezeProof{}
	env := es.Status.Environments[0]
	for _, e := range es.Status.Environments {
		p.EndpointsBefore += len(e.Endpoints)
	}
	ex, err := x.envExecutor(ctx, es.Namespace, env.Name)
	if err != nil {
		return p, err
	}
	entry := ex.Template.Topology.Entry
	start := `nohup setsid sleep 86400 >/dev/null 2>&1 < /dev/null & echo $!`
	res, err := ex.RunAction(ctx, labsv1.Action{On: entry, As: labsv1.ActionAsLearner, Run: &start})
	if err != nil {
		return p, fmt.Errorf("start learner process: %w", err)
	}
	p.LearnerPIDBefore = strings.TrimSpace(res.Stdout)
	ps := learnerProcs
	before, _ := ex.RunAction(ctx, labsv1.Action{On: entry, As: labsv1.ActionAsAdmin, Run: &ps})
	x.v.logf("%s: learner process %s running before the deadline (%s)", es.Name, p.LearnerPIDBefore, strings.TrimSpace(before.Stdout))

	frozen, err := x.waitExam(ctx, es, time.Until(es.Status.Deadline.Time)+5*time.Minute, func(e *labsv1.ExamSession) bool {
		return e.Status.FrozenAt != nil
	})
	if err != nil {
		return p, fmt.Errorf("no freeze after the deadline: %w", err)
	}
	p.FrozenAfterDeadlineS = int64(frozen.Status.FrozenAt.Sub(es.Status.Deadline.Time).Seconds())
	// Wait for the environment to confirm.
	deadline := time.Now().Add(3 * time.Minute)
	for {
		ls := &labsv1.LabSession{}
		if err := x.v.c.Get(ctx, client.ObjectKey{Namespace: es.Namespace, Name: env.Name}, ls); err != nil {
			return p, err
		}
		if meta.IsStatusConditionTrue(ls.Status.Conditions, labsv1.ConditionAccessRevoked) {
			p.AccessRevoked = true
			p.EndpointsAfter = len(ls.Status.Endpoints)
			break
		}
		if time.Now().After(deadline) {
			return p, fmt.Errorf("AccessRevoked not confirmed on %s", env.Name)
		}
		time.Sleep(2 * time.Second)
	}
	after, err := ex.RunAction(ctx, labsv1.Action{On: entry, As: labsv1.ActionAsAdmin, Run: &ps})
	if err != nil {
		return p, fmt.Errorf("list learner processes: %w", err)
	}
	for _, f := range strings.Fields(after.Stdout) {
		if strings.HasPrefix(f, "Z") {
			p.ZombiesAfter = append(p.ZombiesAfter, strings.TrimPrefix(f, "Z"))
		} else {
			p.LearnerProcsAfter = strings.TrimSpace(p.LearnerProcsAfter + " " + f)
		}
	}
	x.v.logf("%s: frozen %ds after the deadline; endpoints %d -> %d; live learner processes after: %q; killed (zombie) pids: %v", es.Name, p.FrozenAfterDeadlineS, p.EndpointsBefore, p.EndpointsAfter, p.LearnerProcsAfter, p.ZombiesAfter)
	switch {
	case p.EndpointsAfter != 0:
		return p, fmt.Errorf("%d endpoint(s) still published after the freeze", p.EndpointsAfter)
	case p.LearnerProcsAfter != "":
		return p, fmt.Errorf("learner processes survived the freeze: %s", p.LearnerProcsAfter)
	}
	return p, nil
}

// cleanup deletes the attempts and templates, then checks the namespace is
// empty and deletes it.
func (x *examRunner) cleanup(ctx context.Context, rep *ExamRunReport) {
	if x.o.keep {
		rep.Teardown = "skipped"
		x.v.logf("--keep: namespace %s left in place", rep.Namespace)
		return
	}
	ns := rep.Namespace
	var errs []string
	ess := &labsv1.ExamSessionList{}
	if err := x.v.c.List(ctx, ess, client.InNamespace(ns)); err == nil {
		for i := range ess.Items {
			if err := x.v.c.Delete(ctx, &ess.Items[i]); err != nil && !apierrors.IsNotFound(err) {
				errs = append(errs, err.Error())
			}
		}
	}
	// Environment sessions are owned by their attempt; wait for them (and
	// their teardown) to finish.
	deadline := time.Now().Add(x.o.teardownTimeout)
	for {
		ls := &labsv1.LabSessionList{}
		if err := x.v.c.List(ctx, ls, client.InNamespace(ns)); err != nil {
			errs = append(errs, err.Error())
			break
		}
		if len(ls.Items) == 0 {
			break
		}
		for i := range ls.Items {
			if ls.Items[i].DeletionTimestamp.IsZero() {
				_ = x.v.c.Delete(ctx, &ls.Items[i])
			}
		}
		if time.Now().After(deadline) {
			errs = append(errs, fmt.Sprintf("%d LabSession(s) still present", len(ls.Items)))
			break
		}
		time.Sleep(3 * time.Second)
	}
	for _, list := range []client.ObjectList{&labsv1.ExamTemplateList{}} {
		if err := x.v.c.List(ctx, list, client.InNamespace(ns)); err == nil {
			items, _ := meta.ExtractList(list)
			for _, it := range items {
				_ = x.v.c.Delete(ctx, it.(client.Object))
			}
		}
	}
	left, err := x.v.leftovers(ctx, ns, "")
	switch {
	case err != nil:
		errs = append(errs, "leftover check: "+err.Error())
	default:
		var real []string
		for _, l := range left {
			if strings.HasPrefix(l, "examsession/") || strings.HasPrefix(l, "examtemplate/") {
				continue // deletion in flight (no finalizers)
			}
			real = append(real, l)
		}
		rep.Leftovers = real
		if len(real) > 0 {
			errs = append(errs, fmt.Sprintf("teardown left %d object(s): %s", len(real), strings.Join(real, ", ")))
		}
	}
	if len(errs) > 0 {
		rep.Teardown = "leftovers"
		rep.Errors = append(rep.Errors, errs...)
	} else {
		rep.Teardown = "clean"
	}
	nsObj := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns}}
	if err := x.v.c.Delete(ctx, nsObj); err != nil && !apierrors.IsNotFound(err) {
		rep.Errors = append(rep.Errors, "delete namespace: "+err.Error())
		return
	}
	if err := x.v.waitGone(ctx, nsObj, 5*time.Minute); err != nil {
		rep.Errors = append(rep.Errors, "namespace: "+err.Error())
	}
}

func printExamSummary(w io.Writer, rep *ExamRunReport) {
	fmt.Fprintf(w, "exam %s, mode %s, namespace %s\n\n", rep.Exam, rep.Mode, rep.Namespace)
	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "ATTEMPT\tSEED\tTASKS\tREADY\tSCORE\tPASSED\tRELEASED\tRESULT")
	for _, a := range rep.Attempts {
		var ids []string
		for _, t := range a.Tasks {
			ids = append(ids, t.ID)
		}
		score, passed := "-", "-"
		if a.Report != nil {
			score, passed = a.Report.Score+"%", fmt.Sprint(a.Report.Passed)
		}
		res := "ok"
		if !a.OK {
			res = "FAIL " + firstLine(strings.Join(a.Errors, "; "))
		}
		fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\t%s\t%v\t%s\n", a.Name, a.Seed, strings.Join(ids, ","), secs(a.ReadySec), score, passed, a.Released, res)
	}
	_ = tw.Flush()
	for _, a := range rep.Attempts {
		if a.Report == nil {
			continue
		}
		fmt.Fprintf(w, "\n%s objectives:", a.Name)
		for _, o := range a.Report.Objectives {
			fmt.Fprintf(w, " %s=%s%% (w %s)", o.ID, o.Score, o.Weight)
		}
		fmt.Fprintln(w)
		for _, t := range a.Report.Tasks {
			fmt.Fprintf(w, "  task %d %-26s %-8s %5s%% of weight %s%%\n", t.Index, t.ID, t.Outcome, t.Score, t.Weight)
		}
	}
	if rep.RetakeDisjoint != nil {
		fmt.Fprintf(w, "\nretake drew disjoint tasks: %v\n", *rep.RetakeDisjoint)
	}
	fmt.Fprintf(w, "teardown: %s\n", rep.Teardown)
	if len(rep.Errors) > 0 {
		fmt.Fprintf(w, "errors:\n  %s\n", strings.Join(rep.Errors, "\n  "))
	}
	verdict := "PASS"
	if !rep.OK {
		verdict = "FAIL"
	}
	fmt.Fprintf(w, "result: %s\n", verdict)
}
