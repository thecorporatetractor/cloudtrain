package controller

import (
	"context"
	"fmt"
	"strings"
	"time"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/answer"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/grader"
)

// computedChecks are the answer checks whose expected value is computed.
func computedChecks(spec *labsv1.LabTemplateSpec) []labsv1.Check {
	var out []labsv1.Check
	for _, c := range spec.Checks {
		if c.Type == labsv1.CheckTypeAnswer && c.Answer != nil && c.Answer.Compute != nil {
			out = append(out, c)
		}
	}
	return out
}

// answersComputed reports whether status.computedAnswers holds a value for
// every computed answer check of the template.
func answersComputed(s *labsv1.LabSession, spec *labsv1.LabTemplateSpec) bool {
	for _, c := range computedChecks(spec) {
		if _, ok := s.Status.ComputedAnswers[c.ID]; !ok {
			return false
		}
	}
	return true
}

// ComputeAnswers runs the answer.compute command of every computed answer
// check (as admin, on compute.on or the entry node) and returns the expected
// values by check id: stdout without its trailing newline. A non-zero exit,
// empty output or output over answer.MaxComputed is a lab error
// (errActionFailed); transport errors are returned as they are (retried).
func ComputeAnswers(ctx context.Context, ex grader.Executor, spec *labsv1.LabTemplateSpec) (map[string]string, error) {
	checks := computedChecks(spec)
	if len(checks) == 0 {
		return nil, nil
	}
	out := make(map[string]string, len(checks))
	for _, c := range checks {
		cmp := c.Answer.Compute
		on := cmp.On
		if on == "" {
			on = spec.Topology.Entry
		}
		t := time.Duration(cmp.TimeoutSec) * time.Second
		if t <= 0 {
			t = 30 * time.Second
		}
		if t > maxActionTimeout {
			t = maxActionTimeout
		}
		req := drivers.ExecRequest{Kind: drivers.ExecShell, User: labsv1.ActionAsAdmin, Command: []string{"/bin/sh", "-c", cmp.Command}, Timeout: t}
		res, err := ex.Exec(ctx, on, req)
		if err != nil {
			return nil, fmt.Errorf("compute answer %s on %s: %w", c.ID, on, err)
		}
		if res.ExitCode != 0 {
			return nil, fmt.Errorf("compute answer %s on %s exited %d: %s: %w", c.ID, on, res.ExitCode, lastLines(res.Stderr, 5), errActionFailed)
		}
		v := grader.Normalize(res.Stdout)
		if strings.TrimSpace(v) == "" {
			return nil, fmt.Errorf("compute answer %s on %s: empty output: %w", c.ID, on, errActionFailed)
		}
		if len(v) > answer.MaxComputed {
			return nil, fmt.Errorf("compute answer %s on %s: output over %d bytes: %w", c.ID, on, answer.MaxComputed, errActionFailed)
		}
		out[c.ID] = v
	}
	return out, nil
}
