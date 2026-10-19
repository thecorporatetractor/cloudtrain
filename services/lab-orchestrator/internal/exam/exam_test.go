package exam

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
)

const fixtures = "../../testdata/exams"

func loadFixtures(t *testing.T) (*Definition, map[string]*labsv1.LabTemplate) {
	t.Helper()
	defs, _, err := LoadFile(filepath.Join(fixtures, "exams.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	def, err := Find(defs, "sim-test-k8s-dev")
	if err != nil {
		t.Fatal(err)
	}
	labs := map[string]*labsv1.LabTemplate{}
	entries, err := os.ReadDir(filepath.Join(fixtures, "tasks"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		lt, err := compile.CompileFile(filepath.Join(fixtures, "tasks", e.Name(), "lab.yaml"), compile.Options{})
		if err != nil {
			t.Fatal(err)
		}
		labs[lt.Spec.Source.ID] = lt
	}
	return def, labs
}

func compiled(t *testing.T) *Compiled {
	t.Helper()
	def, labs := loadFixtures(t)
	c, err := Compile(def, labs, CompileOptions{Namespace: "ns"})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestParseCurriculumExams(t *testing.T) {
	// Every exam of the real curriculum parses and validates (YAML 1.2:
	// envTier N stays a string; shared rules via anchors resolve).
	defs, _, err := LoadFile("../../../../content/curriculum.yaml")
	if os.IsNotExist(err) {
		t.Skip("curriculum not found")
	}
	if err != nil {
		t.Fatal(err)
	}
	if len(defs) < 10 {
		t.Fatalf("%d exams", len(defs))
	}
	for _, d := range defs {
		var sum int32
		for _, o := range d.Blueprint {
			sum += o.Tasks
		}
		if sum != d.TaskCount {
			t.Errorf("%s: blueprint draws %d, taskCount %d", d.ID, sum, d.TaskCount)
		}
		if d.Rules.Hints {
			t.Errorf("%s: hints allowed", d.ID)
		}
	}
	net, err := Find(defs, "sim-net-associate")
	if err != nil || net.EnvTier != "N" {
		t.Errorf("sim-net-associate envTier = %q (%v)", net.EnvTier, err)
	}
}

func TestParseRejectsHints(t *testing.T) {
	b, err := os.ReadFile(filepath.Join(fixtures, "exams.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	bad := strings.Replace(string(b), "hints: false", "hints: true", 1)
	if _, err := Parse([]byte(bad)); err == nil {
		t.Fatal("hints: true accepted")
	}
	if _, err := Parse([]byte("exams: []")); err == nil {
		t.Fatal("empty exams accepted")
	}
}

func TestCompile(t *testing.T) {
	c := compiled(t)
	spec := c.Exam.Spec
	if spec.TaskCount != 3 || len(spec.Objectives) != 3 || spec.Environment != labsv1.ExamEnvironmentShared {
		t.Fatalf("spec = %+v", spec)
	}
	if !spec.Rules.IdempotencyRerun || spec.Rules.PartialCredit != labsv1.PartialCreditPerCheck || spec.PassMark != "66" {
		t.Errorf("rules = %+v passMark %s", spec.Rules, spec.PassMark)
	}
	if len(c.Tasks) != 6 {
		t.Fatalf("%d task templates", len(c.Tasks))
	}
	for _, task := range c.Tasks {
		if !strings.HasPrefix(task.Name, task.Spec.Source.ID+"-v1-") || len(task.Name) != len(task.Spec.Source.ID)+4+10 || task.Namespace != "ns" {
			t.Errorf("task template name %q ns %q", task.Name, task.Namespace)
		}
	}
	if !strings.HasPrefix(c.Exam.Name, "sim-test-k8s-dev-") || c.Exam.Labels[labsv1.LabelExamID] != "sim-test-k8s-dev" {
		t.Errorf("exam template %s %v", c.Exam.Name, c.Exam.Labels)
	}
	// Deterministic.
	if again := compiled(t); again.Exam.Name != c.Exam.Name {
		t.Errorf("digest unstable: %s vs %s", again.Exam.Name, c.Exam.Name)
	}
}

func TestCompileIssues(t *testing.T) {
	def, labs := loadFixtures(t)
	delete(labs, "xt-secret-literal")
	delete(labs, "xt-configmap-key")
	_, err := Compile(def, labs, CompileOptions{})
	if err == nil || !strings.Contains(err.Error(), "xt-secret-literal (ckad:environment-config-security) has no lab") ||
		!strings.Contains(err.Error(), "draws 1 task(s) but its pool has 0 available") {
		t.Fatalf("err = %v", err)
	}
	// AllowMissing still fails when a pool cannot cover its draw...
	if _, err := Compile(def, labs, CompileOptions{AllowMissing: true}); err == nil {
		t.Fatal("empty pool accepted")
	}
	// ...but drops a missing task when the pool still covers it.
	def2, labs2 := loadFixtures(t)
	delete(labs2, "xt-secret-literal")
	c, err := Compile(def2, labs2, CompileOptions{AllowMissing: true})
	if err != nil || len(c.Missing) != 1 || c.Missing[0] != "xt-secret-literal" {
		t.Fatalf("allow-missing: %v %+v", err, c)
	}

	// taskCount mismatch, duplicate pool membership, k8s-context check.
	def3, labs3 := loadFixtures(t)
	def3.TaskCount = 4
	def3.Blueprint[1].Pool = append(def3.Blueprint[1].Pool, "xt-scale-manifest-api")
	ctxLab := labs3["xt-secret-literal"]
	ctxLab.Spec.Checks = append(ctxLab.Spec.Checks, labsv1.Check{ID: "ctx", Type: "k8s-context", Skills: []string{"s"}})
	_, err = Compile(def3, labs3, CompileOptions{})
	for _, want := range []string{"taskCount is 4 but the blueprint draws 3", "is in the pools of both", "k8s-context checks are not allowed"} {
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("missing issue %q in %v", want, err)
		}
	}
}

func TestSharedConsistency(t *testing.T) {
	_, labs := loadFixtures(t)
	var tasks []*labsv1.LabTemplate
	for _, id := range []string{"xt-scale-manifest-api", "xt-expose-clusterip"} {
		tasks = append(tasks, labs[id])
	}
	if issues := SharedConsistency(tasks); len(issues) != 0 {
		t.Fatalf("fixtures inconsistent: %v", issues)
	}
	// Same node name, different definition.
	bad := labs["xt-secret-literal"].DeepCopy()
	bad.Spec.Topology.Nodes[1].Cluster.Version = "v1.36"
	// Same context on another node.
	ctx := labs["xt-configmap-key"].DeepCopy()
	ctx.Spec.Topology.Nodes[1].Name = "other-core"
	// Another entry node.
	entry := labs["xt-set-image-tally"].DeepCopy()
	entry.Spec.Topology.Entry = "exam-core"
	issues := strings.Join(SharedConsistency(append(tasks, bad, ctx, entry)), "\n")
	for _, want := range []string{"node exam-core is defined differently", "context exam-core names node", "enter through different nodes"} {
		if !strings.Contains(issues, want) {
			t.Errorf("missing %q in\n%s", want, issues)
		}
	}
}

func TestDrawDeterministicAndWeighted(t *testing.T) {
	c := compiled(t)
	a, err := Draw(&c.Exam.Spec, 7, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := Draw(&c.Exam.Spec, 7, nil)
	if len(a) != 3 || ids(a) != ids(b) {
		t.Fatalf("draw %s vs %s", ids(a), ids(b))
	}
	wantW := []float64{40, 35, 25}
	for i, d := range a {
		if d.Index != int32(i+1) || d.Objective != c.Exam.Spec.Objectives[i].ID || d.Weight != wantW[i] || d.Seed <= 0 {
			t.Errorf("drawn[%d] = %+v", i, d)
		}
		if d.Seed != TaskSeed(7, d.ID) {
			t.Errorf("task seed not derived from (seed, id)")
		}
	}
	// Different seeds eventually draw different tasks.
	differs := false
	for s := int64(8); s < 40 && !differs; s++ {
		o, _ := Draw(&c.Exam.Spec, s, nil)
		differs = ids(o) != ids(a)
	}
	if !differs {
		t.Error("draw does not depend on the seed")
	}
}

func TestDrawAvoidsPreviousTasks(t *testing.T) {
	c := compiled(t)
	for seed := int64(1); seed < 30; seed++ {
		first, _ := Draw(&c.Exam.Spec, seed, nil)
		var avoid []string
		for _, d := range first {
			avoid = append(avoid, d.ID)
		}
		second, err := Draw(&c.Exam.Spec, seed+100, avoid)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range second {
			for _, x := range avoid {
				if d.ID == x || d.Reused {
					t.Fatalf("seed %d: retake drew %s again (avoid %v)", seed, d.ID, avoid)
				}
			}
		}
		// Third attempt: pools (2 each) are exhausted, so tasks are reused.
		for _, d := range second {
			avoid = append(avoid, d.ID)
		}
		third, err := Draw(&c.Exam.Spec, seed+200, avoid)
		if err != nil || len(third) != 3 {
			t.Fatalf("third draw %v %v", third, err)
		}
		for _, d := range third {
			if !d.Reused {
				t.Errorf("third draw %s not marked reused", d.ID)
			}
		}
	}
	// freshDraw false ignores the avoid list.
	spec := c.Exam.Spec.DeepCopy()
	spec.RetakePolicy.FreshDraw = false
	first, _ := Draw(spec, 3, nil)
	var avoid []string
	for _, d := range first {
		avoid = append(avoid, d.ID)
	}
	same, _ := Draw(spec, 3, avoid)
	if ids(same) != ids(first) {
		t.Errorf("freshDraw=false: %s vs %s", ids(same), ids(first))
	}
}

func TestObjectiveWeightsNormalised(t *testing.T) {
	spec := &labsv1.ExamTemplateSpec{Objectives: []labsv1.ExamObjective{
		{ID: "a", Weight: "10", Tasks: 1}, {ID: "b", Weight: "30", Tasks: 2}, {ID: "c", Weight: "60", Tasks: 0},
	}}
	w := ObjectiveWeights(spec)
	if w["a"] != 25 || w["b"] != 75 || len(w) != 2 {
		t.Errorf("weights = %v", w)
	}
}

func resolveAll(t *testing.T, c *Compiled, seed int64) []*Resolved {
	t.Helper()
	drawn, err := Draw(&c.Exam.Spec, seed, nil)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]*labsv1.LabTemplate{}
	for _, lt := range c.Tasks {
		byName[lt.Name] = lt
	}
	var out []*Resolved
	for _, d := range drawn {
		r, err := Resolve(d, &byName[d.TemplateRef].Spec)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func TestEnvironmentUnion(t *testing.T) {
	c := compiled(t)
	tasks := resolveAll(t, c, 7)
	env, err := Environment(EnvironmentMeta{ExamID: "sim-test-k8s-dev", Title: "T", Duration: 30}, tasks)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, n := range env.Topology.Nodes {
		names = append(names, n.Name)
	}
	if strings.Join(names, ",") != "workstation,exam-core,exam-edge" || env.Topology.Entry != "workstation" {
		t.Errorf("nodes %v entry %s", names, env.Topology.Entry)
	}
	if len(env.Params) != 0 || len(env.Hints) != 0 || len(env.Misconceptions) != 0 || env.Solution.Explanation != "" || len(env.Solution.Alternatives) != 0 {
		t.Error("environment leaks params, hints, misconceptions or solution text")
	}
	if len(env.Solution.Steps) != 1 || *env.Solution.Steps[0].Run != "true" {
		t.Errorf("solution = %+v", env.Solution)
	}
	nChecks, nSetup := 0, 0
	for _, r := range tasks {
		nChecks += len(r.Spec.Checks)
		nSetup += len(r.Spec.Setup)
	}
	if len(env.Checks) != nChecks || len(env.Setup) != nSetup {
		t.Errorf("checks %d/%d setup %d/%d", len(env.Checks), nChecks, len(env.Setup), nSetup)
	}
	for _, ch := range env.Checks {
		task, id, ok := SplitCheckID(ch.ID)
		if !ok || task < 1 || task > 3 || id == "" {
			t.Errorf("check id %q", ch.ID)
		}
		if strings.Contains(ch.Description+ch.Command+ch.Expect.Value, "{{") {
			t.Errorf("check %s has unresolved params", ch.ID)
		}
	}
	for _, r := range tasks {
		if strings.Contains(r.Spec.Description, "{{") {
			t.Errorf("statement of %s unresolved", r.ID)
		}
	}
	// Conflicting nodes cannot be merged.
	bad := *tasks[1]
	bad.Spec = tasks[1].Spec.DeepCopy()
	bad.Spec.Topology.Nodes[1].Image = "different"
	bad.Spec.Topology.Nodes[1].Name = tasks[0].Spec.Topology.Nodes[1].Name
	if _, err := Environment(EnvironmentMeta{ExamID: "x"}, []*Resolved{tasks[0], &bad}); err == nil {
		t.Error("conflicting node accepted")
	}
	nodes, contexts := TaskNodes(tasks[0].Spec)
	if len(nodes) != 2 || len(contexts) != 1 {
		t.Errorf("task nodes %v contexts %v", nodes, contexts)
	}
}

func TestSplitCheckID(t *testing.T) {
	for in, want := range map[string]bool{"t1/a": true, "t12/a/b": true, "x1/a": false, "t0/a": false, "t/a": false, "ta": false} {
		if _, _, ok := SplitCheckID(in); ok != want {
			t.Errorf("%s: %v", in, ok)
		}
	}
	if n, id, _ := SplitCheckID(CheckID(3, "ready")); n != 3 || id != "ready" {
		t.Errorf("roundtrip %d %s", n, id)
	}
}

func scoreSpec(credit labsv1.PartialCredit) *labsv1.ExamTemplateSpec {
	return &labsv1.ExamTemplateSpec{
		PassMark: "66",
		Rules:    labsv1.ExamRules{PartialCredit: credit},
		Objectives: []labsv1.ExamObjective{
			{ID: "o1", Weight: "60", Tasks: 2}, {ID: "o2", Weight: "40", Tasks: 1},
		},
	}
}

func scoreTasks() []ScoredTask {
	ck := func(id, w string) labsv1.Check {
		return labsv1.Check{ID: id, Description: "desc " + id, Weight: w, Skills: []string{"sk." + id}}
	}
	return []ScoredTask{
		{Status: labsv1.ExamTaskStatus{Index: 1, ID: "a", Objective: "o1", Weight: "30", Title: "A"}, Checks: []labsv1.Check{ck("x", "1"), ck("y", "3")}},
		{Status: labsv1.ExamTaskStatus{Index: 2, ID: "b", Objective: "o1", Weight: "30", Title: "B"}, Checks: []labsv1.Check{ck("x", "1")}},
		{Status: labsv1.ExamTaskStatus{Index: 3, ID: "c", Objective: "o2", Weight: "40", Title: "C"}, Checks: []labsv1.Check{ck("x", "1"), ck("z", "1")}},
	}
}

func pass(name string, results map[string]bool) labsv1.ExamGradingPass {
	p := labsv1.ExamGradingPass{Name: name}
	for id, ok := range results {
		msg := "not satisfied yet"
		if ok {
			msg = "passed"
		}
		p.Checks = append(p.Checks, labsv1.CheckResult{ID: id, Passed: ok, Message: msg, Output: "secret expected value"})
	}
	return p
}

func TestScorePerCheck(t *testing.T) {
	g := &labsv1.ExamGradingStatus{Passes: []labsv1.ExamGradingPass{pass(labsv1.PassInitial, map[string]bool{
		"t1/x": true, "t1/y": false, // 25 %
		"t2/x": true,               // 100 %
		"t3/x": true, "t3/z": true, // 100 %
	})}}
	rep := Score(scoreSpec(labsv1.PartialCreditPerCheck), scoreTasks(), g, metav1.Now())
	// o1 = (25 + 100) / 2 = 62.5; o2 = 100; total = 0.6*62.5 + 0.4*100 = 77.5
	if rep.Score != "77.5" || !rep.Passed || rep.PassMark != "66" {
		t.Fatalf("score %s passed %v", rep.Score, rep.Passed)
	}
	if rep.Objectives[0].Score != "62.5" || rep.Objectives[0].Weight != "60" || rep.Objectives[1].Score != "100" || rep.Objectives[0].Tasks != 2 {
		t.Errorf("objectives %+v", rep.Objectives)
	}
	want := []labsv1.TaskOutcome{labsv1.OutcomePartial, labsv1.OutcomePass, labsv1.OutcomePass}
	for i, tr := range rep.Tasks {
		if tr.Outcome != want[i] {
			t.Errorf("task %d outcome %s", tr.Index, tr.Outcome)
		}
	}
	if rep.Tasks[0].Score != "25" || rep.Tasks[0].Checks[1].Message != "not satisfied yet" || rep.Tasks[0].Checks[1].Description != "desc y" {
		t.Errorf("task 1 = %+v", rep.Tasks[0])
	}
	// Ungraded checks fail with a learner-safe message.
	g2 := &labsv1.ExamGradingStatus{Passes: []labsv1.ExamGradingPass{pass(labsv1.PassInitial, map[string]bool{"t1/x": true})}}
	rep2 := Score(scoreSpec(labsv1.PartialCreditPerCheck), scoreTasks(), g2, metav1.Now())
	if rep2.Tasks[2].Outcome != labsv1.OutcomeFail || rep2.Tasks[2].Checks[0].Message != MsgNotGraded || rep2.Passed {
		t.Errorf("ungraded: %+v passed %v", rep2.Tasks[2], rep2.Passed)
	}
}

func TestScorePerTaskAndFail(t *testing.T) {
	g := &labsv1.ExamGradingStatus{Passes: []labsv1.ExamGradingPass{pass(labsv1.PassInitial, map[string]bool{
		"t1/x": true, "t1/y": false, "t2/x": true, "t3/x": true, "t3/z": false,
	})}}
	rep := Score(scoreSpec(labsv1.PartialCreditPerTask), scoreTasks(), g, metav1.Now())
	// o1 = (0 + 100)/2 = 50, o2 = 0 => 30
	if rep.Score != "30" || rep.Passed || rep.Tasks[0].Outcome != labsv1.OutcomeFail || rep.Tasks[2].Outcome != labsv1.OutcomeFail {
		t.Fatalf("rep %+v", rep)
	}
}

func TestScoreRerunAndReboot(t *testing.T) {
	all := map[string]bool{"t1/x": true, "t1/y": true, "t2/x": true, "t3/x": true, "t3/z": true}
	rerun := map[string]bool{"t1/x": true, "t1/y": true, "t2/x": false, "t3/x": true, "t3/z": true}
	reboot := map[string]bool{"t1/x": true, "t1/y": false, "t2/x": false, "t3/x": true, "t3/z": true}
	g := &labsv1.ExamGradingStatus{
		Passes: []labsv1.ExamGradingPass{pass(labsv1.PassInitial, all), pass(labsv1.PassRerun, rerun), pass(labsv1.PassReboot, reboot)},
		Reruns: []labsv1.ExamRerunResult{{Task: 3, OK: false}},
	}
	rep := Score(scoreSpec(labsv1.PartialCreditPerCheck), scoreTasks(), g, metav1.Now())
	t1, t2, t3 := rep.Tasks[0], rep.Tasks[1], rep.Tasks[2]
	if !t1.Checks[1].FailedAfterReboot || t1.Checks[1].Message != MsgFailedAfterReboot || t1.Checks[0].FailedAfterReboot || !t1.Checks[0].Passed {
		t.Errorf("task 1 %+v", t1.Checks)
	}
	if !t2.Checks[0].FailedOnRerun || t2.Checks[0].Message != MsgFailedOnRerun || t2.Checks[0].FailedAfterReboot {
		t.Errorf("task 2 %+v", t2.Checks)
	}
	for _, c := range t3.Checks {
		if c.Passed || !c.FailedOnRerun || c.Message != MsgRerunFailed {
			t.Errorf("task 3 (rerun failed) %+v", c)
		}
	}
	if strings.Join(rep.Passes, ",") != "initial,rerun,reboot" {
		t.Errorf("passes %v", rep.Passes)
	}
}

// A check that a later pass could not grade (its environment broke after the
// first pass) fails; it does not keep its first-pass credit.
func TestScoreCheckMissingFromLaterPassFails(t *testing.T) {
	all := map[string]bool{"t1/x": true, "t1/y": true, "t2/x": true, "t3/x": true, "t3/z": true}
	rerun := map[string]bool{"t1/x": true, "t1/y": true, "t3/x": true, "t3/z": true} // t2 ungraded
	reboot := map[string]bool{"t2/x": true, "t3/x": true, "t3/z": true}              // t1 ungraded
	g := &labsv1.ExamGradingStatus{Passes: []labsv1.ExamGradingPass{
		pass(labsv1.PassInitial, all), pass(labsv1.PassRerun, rerun), pass(labsv1.PassReboot, reboot)}}
	rep := Score(scoreSpec(labsv1.PartialCreditPerCheck), scoreTasks(), g, metav1.Now())
	t1, t2, t3 := rep.Tasks[0], rep.Tasks[1], rep.Tasks[2]
	for _, c := range t1.Checks {
		if c.Passed || !c.FailedAfterReboot || c.Message != MsgNotGraded {
			t.Errorf("task 1 (ungraded after reboot) %+v", c)
		}
	}
	if c := t2.Checks[0]; c.Passed || !c.FailedOnRerun || c.Message != MsgNotGraded {
		t.Errorf("task 2 (ungraded after re-run) %+v", c)
	}
	for _, c := range t3.Checks {
		if !c.Passed {
			t.Errorf("task 3 %+v", c)
		}
	}
	if t1.Outcome != labsv1.OutcomeFail || t2.Outcome != labsv1.OutcomeFail || t3.Outcome != labsv1.OutcomePass {
		t.Errorf("outcomes %s %s %s", t1.Outcome, t2.Outcome, t3.Outcome)
	}
	// Without later passes nothing changes (initial only).
	g = &labsv1.ExamGradingStatus{Passes: []labsv1.ExamGradingPass{pass(labsv1.PassInitial, all)}}
	if rep := Score(scoreSpec(labsv1.PartialCreditPerCheck), scoreTasks(), g, metav1.Now()); rep.Score != "100" {
		t.Errorf("initial-only score %s", rep.Score)
	}
}

func TestScoreNeverLeaksOutput(t *testing.T) {
	g := &labsv1.ExamGradingStatus{Passes: []labsv1.ExamGradingPass{pass(labsv1.PassInitial, map[string]bool{"t1/x": false})}}
	rep := Score(scoreSpec(labsv1.PartialCreditPerCheck), scoreTasks(), g, metav1.Now())
	for _, tr := range rep.Tasks {
		for _, c := range tr.Checks {
			if strings.Contains(c.Message, "secret") {
				t.Fatalf("output leaked: %+v", c)
			}
		}
	}
}

func ids(ds []Drawn) string {
	var out []string
	for _, d := range ds {
		out = append(out, d.ID)
	}
	return strings.Join(out, ",")
}
