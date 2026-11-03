package main

import (
	"strings"
	"testing"
	"time"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func grades(results map[string]bool, weights map[string]string) *GradeReport {
	g := &GradeReport{}
	for _, id := range []string{"ctx", "a", "b", "intact", "gone"} {
		if p, ok := results[id]; ok {
			g.Checks = append(g.Checks, labsv1.CheckResult{ID: id, Passed: p, Weight: weights[id]})
		}
	}
	return g
}

var prepassSpec = &labsv1.LabTemplateSpec{Checks: []labsv1.Check{
	{ID: "ctx", Type: "k8s-context"},
	{ID: "a", Type: "shell", Command: "x"},
	{ID: "b", Type: "shell", Command: "x"},
	{ID: "intact", Type: "shell", Command: "x"},
	{ID: "gone", Type: "shell", Command: `test -e /x && echo present || echo gone`, Expect: &labsv1.Expectation{Match: "exact", Value: "gone"}},
}}

// content-8: a k8s-context check that fails at the start no longer hides an
// otherwise solved lab, and the passing share is measured.
func TestCheckPrepass(t *testing.T) {
	w := map[string]string{"a": "2", "b": "2", "intact": "0.5", "gone": "0.5"}
	p := checkPrepass(prepassSpec, grades(map[string]bool{"ctx": false, "a": true, "b": true, "intact": true, "gone": true}, w))
	if !p.solved || p.share != 1 {
		t.Errorf("solved except the context check: %+v", p)
	}
	p = checkPrepass(prepassSpec, grades(map[string]bool{"ctx": false, "a": false, "b": false, "intact": true, "gone": true}, w))
	if p.solved || p.share != 0.2 || strings.Join(p.ids, ",") != "intact,gone" {
		t.Errorf("guards only: %+v", p)
	}
	if !strings.Contains(strings.Join(p.warnings, "\n"), "check gone passes before the solution and prints its expected value") {
		t.Errorf("fail-open warning missing: %v", p.warnings)
	}
	p = checkPrepass(prepassSpec, grades(map[string]bool{"ctx": false, "a": true, "b": false, "intact": true, "gone": true}, w))
	if p.solved || p.share != 0.6 {
		t.Errorf("one main check free: %+v", p)
	}
}

func TestFailOpen(t *testing.T) {
	for cmd, want := range map[string]bool{
		`grep -q x f && echo ok || echo missing`:                             false,
		`grep -q x f && echo bad || echo ok`:                                 true,
		`kubectl get x 2>/dev/null || echo "not found"`:                      false,
		`cmd || echo "all good"; true`:                                       false,
		`docker inspect p >/dev/null 2>&1 && echo present || echo 'removed'`: false,
	} {
		c := labsv1.Check{Type: "shell", Command: cmd, Expect: &labsv1.Expectation{Match: "exact", Value: "ok"}}
		if cmd == `docker inspect p >/dev/null 2>&1 && echo present || echo 'removed'` {
			c.Expect.Value, want = "removed", true
		}
		if cmd == `cmd || echo "all good"; true` {
			c.Expect.Value, want = "all good", true
		}
		if got := failOpen(c); got != want {
			t.Errorf("failOpen(%q, %q) = %v", cmd, c.Expect.Value, got)
		}
	}
}

// content-5: grading twice in a row must agree.
func TestRegradeDiffs(t *testing.T) {
	a := grades(map[string]bool{"a": true, "b": true, "intact": false}, nil)
	b := grades(map[string]bool{"a": true, "b": false, "intact": true}, nil)
	d := regradeDiffs(a, b)
	if len(d) != 2 || !strings.Contains(d[0], "b passed then failed") || !strings.Contains(d[1], "intact failed then passed") {
		t.Errorf("diffs %v", d)
	}
	if len(regradeDiffs(a, a)) != 0 {
		t.Error("identical gradings differ")
	}
}

func TestGradeDuration(t *testing.T) {
	g := &GradeReport{Checks: []labsv1.CheckResult{{DurationMs: 40_000}, {DurationMs: 30_500}}}
	if d := gradeDuration(g); d != 70500*time.Millisecond {
		t.Errorf("duration %s", d)
	}
}
