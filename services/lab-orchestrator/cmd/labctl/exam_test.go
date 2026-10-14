package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

var examArgs = []string{"--exams", "../../testdata/exams/exams.yaml", "--labs", "../../testdata/exams/tasks"}

func TestExamCompileCLI(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run(append(append([]string{"exam", "compile"}, examArgs...), "--namespace", "x", "sim-test-k8s-dev"), &out, &errb); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	docs := strings.Split(out.String(), "\n---\n")
	if len(docs) != 7 || strings.Count(out.String(), "kind: LabTemplate") != 6 || !strings.Contains(docs[6], "kind: ExamTemplate") {
		t.Fatalf("%d documents:\n%s", len(docs), out.String())
	}
	if !strings.Contains(out.String(), "namespace: x") || !strings.Contains(out.String(), "idempotencyRerun: true") {
		t.Error("namespace or rules missing")
	}
	// Unknown exam, and an exam whose pools have no labs.
	errb.Reset()
	if code := run(append(append([]string{"exam", "compile"}, examArgs...), "nope"), &out, &errb); code == 0 || !strings.Contains(errb.String(), "not found") {
		t.Errorf("unknown exam: %d %s", code, errb.String())
	}
	errb.Reset()
	if code := run([]string{"exam", "compile", "--exams", "../../testdata/exams/exams.yaml", "--labs", "../../testdata/labs", "sim-test-k8s-dev"}, &out, &errb); code == 0 || !strings.Contains(errb.String(), "has no lab") {
		t.Errorf("missing labs: %d %s", code, errb.String())
	}
}

func TestExamDrawCLI(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run(append(append([]string{"exam", "draw", "-o", "json", "--seed", "7", "--statements"}, examArgs...), "sim-test-k8s-dev"), &out, &errb); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	var rep DrawReport
	if err := json.Unmarshal(out.Bytes(), &rep); err != nil {
		t.Fatal(err)
	}
	if len(rep.Tasks) != 3 || len(rep.Envs) != 1 || strings.Join(rep.Envs[0].Nodes, ",") != "workstation,exam-core,exam-edge" {
		t.Fatalf("draw %+v", rep)
	}
	for _, task := range rep.Tasks {
		if len(task.Params) == 0 || strings.Contains(task.Statement, "{{") || task.Statement == "" {
			t.Errorf("task %+v", task)
		}
	}
	// A retake that avoids every first-attempt task draws the other half.
	var avoid []string
	for _, task := range rep.Tasks {
		avoid = append(avoid, task.ID)
	}
	out.Reset()
	if code := run(append(append([]string{"exam", "draw", "-o", "json", "--seed", "8", "--avoid", strings.Join(avoid, ",")}, examArgs...), "sim-test-k8s-dev"), &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	var rep2 DrawReport
	_ = json.Unmarshal(out.Bytes(), &rep2)
	for _, task := range rep2.Tasks {
		for _, a := range avoid {
			if task.ID == a {
				t.Errorf("retake drew %s", a)
			}
		}
	}
	// Text output.
	out.Reset()
	if code := run(append(append([]string{"exam", "draw"}, examArgs...), "sim-test-k8s-dev"), &out, &errb); code != 0 || !strings.Contains(out.String(), "environment env: tasks [1 2 3]") {
		t.Errorf("text: %d %s", code, out.String())
	}
}

func TestRetakeDisjoint(t *testing.T) {
	spec := &labsv1.ExamTemplateSpec{Objectives: []labsv1.ExamObjective{
		{ID: "a", Tasks: 1, Pool: []labsv1.ExamPoolTask{{ID: "a1"}, {ID: "a2"}}},
		{ID: "b", Tasks: 1, Pool: []labsv1.ExamPoolTask{{ID: "b1"}}},
	}}
	at := func(ids ...string) ExamAttemptReport {
		var a ExamAttemptReport
		for _, id := range ids {
			a.Tasks = append(a.Tasks, DrawnTask{ID: id, Objective: id[:1]})
		}
		return a
	}
	if !retakeDisjoint(spec, []ExamAttemptReport{at("a1", "b1"), at("a2", "b1")}) {
		t.Error("b's pool of one cannot avoid b1; a2 is fresh")
	}
	if retakeDisjoint(spec, []ExamAttemptReport{at("a1", "b1"), at("a1", "b1")}) {
		t.Error("a1 repeated although a2 was free")
	}
}

func TestExamRunUsage(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run([]string{"exam", "run", "sim-test-k8s-dev"}, &out, &errb); code != 2 {
		t.Errorf("run without a mode: %d", code)
	}
	if code := run([]string{"exam", "nope"}, &out, &errb); code != 2 {
		t.Errorf("unknown subcommand: %d", code)
	}
}
