package main

// Answer checks in labctl verify: base runs submit the solution's answers
// (each must be accepted), an empty answer (must be rejected) and every
// misconception's wrong answers (each check in its expectFail must reject
// it), all against the session's own expected values. Wrong answers need no
// fresh session: answers do not change the lab's state.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/answer"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/grader"
)

// AnswerReport is one answer the verifier submitted. Expected values are
// never written to reports.
type AnswerReport struct {
	Check string `json:"check"`
	// Source is "solution", "empty" or "misconception:<id>".
	Source       string `json:"source"`
	Answer       string `json:"answer"`
	WantAccepted bool   `json:"wantAccepted"`
	Accepted     bool   `json:"accepted"`
	Error        string `json:"error,omitempty"`
}

// answerSource produces the text a verifier submits for an AnswerInput.
type answerSource func(ctx context.Context, in labsv1.AnswerInput) (string, error)

// execAnswerSource runs command inputs on the session's nodes.
func execAnswerSource(ex grader.Executor, entry string) answerSource {
	return func(ctx context.Context, in labsv1.AnswerInput) (string, error) {
		if in.Value != nil {
			return *in.Value, nil
		}
		on := in.On
		if on == "" {
			on = entry
		}
		user := in.As
		if user == "" {
			user = labsv1.ActionAsLearner
		}
		t := time.Duration(in.TimeoutSec) * time.Second
		if t <= 0 {
			t = time.Minute
		}
		cctx, cancel := context.WithTimeout(ctx, t+30*time.Second)
		defer cancel()
		res, err := ex.Exec(cctx, on, drivers.ExecRequest{Kind: drivers.ExecShell, User: user, Command: []string{"/bin/sh", "-c", in.Command}, Timeout: t})
		if err != nil {
			return "", fmt.Errorf("on %s: %w", on, err)
		}
		if res.ExitCode != 0 {
			return "", fmt.Errorf("on %s exited %d: %s", on, res.ExitCode, tail(res.Stderr, 200))
		}
		return strings.TrimSpace(res.Stdout), nil
	}
}

// verifyAnswers grades the solution's and the misconceptions' answers of a
// resolved spec against computed (status.computedAnswers). It returns the
// reports, the problems found and a digest of every check's expected
// values (to compare seeds).
func verifyAnswers(ctx context.Context, spec *labsv1.LabTemplateSpec, computed map[string]string, src answerSource) ([]AnswerReport, []string, map[string]string) {
	var reports []AnswerReport
	var problems []string
	digests := map[string]string{}
	checks := map[string]labsv1.Check{}
	var ids []string
	for _, c := range spec.Checks {
		if c.Type == labsv1.CheckTypeAnswer && c.Answer != nil {
			checks[c.ID] = c
			ids = append(ids, c.ID)
		}
	}
	if len(ids) == 0 {
		return nil, nil, nil
	}
	expected := map[string][]string{}
	for _, id := range ids {
		v, ok := computed[id]
		exp, err := answer.Expected(checks[id].Answer, v, ok)
		if err != nil {
			problems = append(problems, fmt.Sprintf("answer check %s: %v", id, err))
			continue
		}
		expected[id] = exp
		h := sha256.Sum256([]byte(strings.Join(exp, "\x00")))
		digests[id] = hex.EncodeToString(h[:8])
	}
	submit := func(id, source, text string, want bool) {
		r := AnswerReport{Check: id, Source: source, Answer: truncateAnswer(text), WantAccepted: want}
		exp, ok := expected[id]
		if !ok {
			return // already reported
		}
		got, err := answer.Match(checks[id].Answer, exp, text)
		switch {
		case err != nil:
			r.Error = err.Error()
			problems = append(problems, fmt.Sprintf("answer check %s: %v", id, err))
		case got != want && want:
			problems = append(problems, fmt.Sprintf("answer check %s rejects the %s answer %q", id, source, r.Answer))
		case got != want:
			problems = append(problems, fmt.Sprintf("answer check %s accepts the %s answer %q", id, source, r.Answer))
		}
		r.Accepted = got
		reports = append(reports, r)
	}
	for _, id := range ids {
		in, ok := spec.Solution.Answers[id]
		if !ok {
			problems = append(problems, fmt.Sprintf("answer check %s: the solution gives no answer", id))
			continue
		}
		text, err := src(ctx, in)
		if err != nil {
			problems = append(problems, fmt.Sprintf("solution answer for %s: %v", id, err))
			continue
		}
		submit(id, "solution", text, true)
		submit(id, "empty", "", false)
	}
	for _, m := range spec.Misconceptions {
		if len(m.Answers) == 0 {
			continue
		}
		fail := append([]string{}, m.ExpectFail...)
		sort.Strings(fail)
		for _, id := range fail {
			in, ok := m.Answers[id]
			if !ok {
				continue
			}
			text, err := src(ctx, in)
			if err != nil {
				problems = append(problems, fmt.Sprintf("misconception %s answer for %s: %v", m.ID, id, err))
				continue
			}
			submit(id, "misconception:"+m.ID, text, false)
		}
	}
	return reports, problems, digests
}

func truncateAnswer(s string) string {
	if len(s) > 200 {
		return s[:200] + "…"
	}
	return s
}

// sameAnswersAcrossSeeds lists the answer checks whose expected values are
// identical in two base runs with different params (shareable answers).
func sameAnswersAcrossSeeds(runs []RunReport) []string {
	var base []RunReport
	for _, r := range runs {
		if r.Kind == runBase && r.answerDigests != nil {
			base = append(base, r)
		}
	}
	if len(base) < 2 {
		return nil
	}
	var out []string
	for id, d := range base[0].answerDigests {
		if base[1].answerDigests[id] == d {
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out
}
