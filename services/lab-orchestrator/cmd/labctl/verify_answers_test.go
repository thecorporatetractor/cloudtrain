package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"k8s.io/utils/ptr"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func answerSpec() *labsv1.LabTemplateSpec {
	return &labsv1.LabTemplateSpec{
		Topology: labsv1.Topology{Entry: "box"},
		Checks: []labsv1.Check{
			{ID: "end", Type: "shell"},
			{ID: "q-ip", Type: labsv1.CheckTypeAnswer, Answer: &labsv1.AnswerSpec{Match: labsv1.AnswerExact, Whitespace: labsv1.WhitespaceCollapse, Value: ptr.To("203.0.113.7")}},
			{ID: "q-n", Type: labsv1.CheckTypeAnswer, Answer: &labsv1.AnswerSpec{Match: labsv1.AnswerNumber, Compute: &labsv1.AnswerCompute{Command: "c"}}},
		},
		Solution: labsv1.Solution{Answers: map[string]labsv1.AnswerInput{
			"q-ip": {Command: "awk ..."},
			"q-n":  {Value: ptr.To("12")},
		}},
		Misconceptions: []labsv1.Misconception{
			{ID: "first-ip", ExpectFail: []string{"q-ip"}, Answers: map[string]labsv1.AnswerInput{"q-ip": {Value: ptr.To("192.0.2.1")}}},
			{ID: "mutation", ExpectFail: []string{"end"}, Mutation: &labsv1.Action{On: "box"}},
		},
	}
}

func source(cmdOut string, err error) answerSource {
	return func(_ context.Context, in labsv1.AnswerInput) (string, error) {
		if in.Value != nil {
			return *in.Value, nil
		}
		return cmdOut, err
	}
}

func TestVerifyAnswers(t *testing.T) {
	ctx := context.Background()
	reps, problems, digests := verifyAnswers(ctx, answerSpec(), map[string]string{"q-n": "12"}, source(" 203.0.113.7 ", nil))
	if len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	// solution + empty per question, one misconception answer.
	if len(reps) != 5 || len(digests) != 2 {
		t.Fatalf("reports = %+v, digests = %v", reps, digests)
	}
	for _, r := range reps {
		if r.Accepted != r.WantAccepted {
			t.Errorf("%+v", r)
		}
	}

	_, problems, _ = verifyAnswers(ctx, answerSpec(), map[string]string{"q-n": "12"}, source("192.0.2.1", nil))
	if len(problems) != 1 || !strings.Contains(problems[0], `q-ip rejects the solution answer "192.0.2.1"`) {
		t.Errorf("wrong solution: %v", problems)
	}

	s := answerSpec()
	s.Misconceptions[0].Answers["q-ip"] = labsv1.AnswerInput{Value: ptr.To("203.0.113.7")}
	_, problems, _ = verifyAnswers(ctx, s, map[string]string{"q-n": "12"}, source("203.0.113.7", nil))
	if len(problems) != 1 || !strings.Contains(problems[0], "accepts the misconception:first-ip answer") {
		t.Errorf("misconception accepted: %v", problems)
	}

	_, problems, _ = verifyAnswers(ctx, answerSpec(), nil, source("203.0.113.7", nil))
	if len(problems) != 1 || !strings.Contains(problems[0], "q-n: the expected answer has not been computed") {
		t.Errorf("not computed: %v", problems)
	}

	_, problems, _ = verifyAnswers(ctx, answerSpec(), map[string]string{"q-n": "12"}, source("", errors.New("exited 1")))
	if len(problems) != 1 || !strings.Contains(problems[0], "solution answer for q-ip: exited 1") {
		t.Errorf("command failed: %v", problems)
	}

	if reps, problems, _ := verifyAnswers(ctx, &labsv1.LabTemplateSpec{Checks: []labsv1.Check{{ID: "x", Type: "shell"}}}, nil, nil); reps != nil || problems != nil {
		t.Errorf("plain lab: %v %v", reps, problems)
	}
}

func TestSameAnswersAcrossSeeds(t *testing.T) {
	runs := []RunReport{
		{Kind: runBase, answerDigests: map[string]string{"a": "1", "b": "2"}},
		{Kind: runMutation},
		{Kind: runBase, answerDigests: map[string]string{"a": "1", "b": "3"}},
	}
	if got := sameAnswersAcrossSeeds(runs); len(got) != 1 || got[0] != "a" {
		t.Errorf("got %v", got)
	}
	if got := sameAnswersAcrossSeeds(runs[:2]); got != nil {
		t.Errorf("one base run: %v", got)
	}
}

func TestPlanSkipsAnswerOnlyMisconceptions(t *testing.T) {
	l := &labUnderTest{tpl: &labsv1.LabTemplate{Spec: *answerSpec()}}
	runs := plan(l, false)
	kinds := []string{}
	for _, r := range runs {
		kinds = append(kinds, r.kind+":"+r.id)
	}
	if got := strings.Join(kinds, ","); got != "base:seed-1,base:seed-2,mutation:mutation" {
		t.Errorf("runs = %s", got)
	}
}
