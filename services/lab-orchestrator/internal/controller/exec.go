package controller

import (
	"context"
	"fmt"
	"strings"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// NodeExecutor runs requests on the nodes of one session ("node" or
// "node/member") through their drivers. Setup actions, checks and the
// verifier's solution steps all go through it.
type NodeExecutor struct {
	Drivers  *drivers.Registry
	Session  *labsv1.LabSession
	Template *labsv1.LabTemplateSpec
}

// Exec implements grader.Executor.
func (e *NodeExecutor) Exec(ctx context.Context, on string, req drivers.ExecRequest) (drivers.ExecResult, error) {
	nodeName, member, _ := strings.Cut(on, "/")
	tpl := EffectiveTemplate(e.Template, e.Session)
	node, ok := findNode(tpl.Topology.Nodes, nodeName)
	if !ok {
		return drivers.ExecResult{}, fmt.Errorf("unknown node %q: %w", on, drivers.ErrUnsupported)
	}
	d, err := e.Drivers.Get(node.Driver)
	if err != nil {
		return drivers.ExecResult{}, err
	}
	req.Member = member
	return d.Exec(ctx, drivers.NodeRef{Session: e.Session, Template: tpl, Node: node}, req)
}

// EffectiveTemplate is tpl with the nodes as the manager provisioned them
// (status.topology): a node the manager rewrote to its KubeVirt VM twin
// (tier sandbox vmFallback) is a vm node there, while a template resolved
// outside the manager (labctl verify, exam grading) still says container.
func EffectiveTemplate(tpl *labsv1.LabTemplateSpec, s *labsv1.LabSession) *labsv1.LabTemplateSpec {
	if tpl == nil || s == nil || s.Status.Topology == nil {
		return tpl
	}
	var out *labsv1.LabTemplateSpec
	for i, n := range tpl.Topology.Nodes {
		rec, ok := findNode(s.Status.Topology.Nodes, n.Name)
		if !ok || (rec.Driver == n.Driver && rec.Image == n.Image) {
			continue
		}
		if out == nil {
			out = tpl.DeepCopy()
		}
		out.Topology.Nodes[i] = *rec.DeepCopy()
	}
	if out == nil {
		return tpl
	}
	return out
}

// RunAction executes one lab action and fails on a non-zero exit.
func (e *NodeExecutor) RunAction(ctx context.Context, a labsv1.Action) (drivers.ExecResult, error) {
	res, err := e.Exec(ctx, a.On, ActionRequest(a))
	if err != nil {
		return res, fmt.Errorf("on %s: %w", a.On, err)
	}
	if res.ExitCode != 0 {
		return res, fmt.Errorf("on %s exited %d: %s: %w", a.On, res.ExitCode, lastLines(res.Stderr, 5), errActionFailed)
	}
	return res, nil
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, " | ")
}
