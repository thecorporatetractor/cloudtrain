package exam

import (
	"fmt"
	"sort"
	"strings"

	apiequality "k8s.io/apimachinery/pkg/api/equality"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
)

// Resolved is a drawn task with its params resolved from its seed.
type Resolved struct {
	Drawn
	Spec   *labsv1.LabTemplateSpec
	Params map[string]string
}

// Resolve resolves a drawn task's template with the task seed.
func Resolve(d Drawn, tpl *labsv1.LabTemplateSpec) (*Resolved, error) {
	spec, values, err := compile.Resolve(tpl, d.Seed, compile.ResolveOptions{})
	if err != nil {
		return nil, fmt.Errorf("task %s: %w", d.ID, err)
	}
	return &Resolved{Drawn: d, Spec: spec, Params: values}, nil
}

// CheckID is the environment-level id of a task's check.
func CheckID(task int32, check string) string { return fmt.Sprintf("t%d/%s", task, check) }

// SplitCheckID reverses CheckID.
func SplitCheckID(id string) (int32, string, bool) {
	head, rest, ok := strings.Cut(id, "/")
	if !ok || !strings.HasPrefix(head, "t") {
		return 0, "", false
	}
	var n int32
	if _, err := fmt.Sscanf(head[1:], "%d", &n); err != nil || n <= 0 {
		return 0, "", false
	}
	return n, rest, true
}

// TaskNodes returns the node names and kubeconfig contexts a task uses.
func TaskNodes(spec *labsv1.LabTemplateSpec) (nodes, contexts []string) {
	for _, n := range spec.Topology.Nodes {
		nodes = append(nodes, n.Name)
		if n.Cluster != nil {
			if n.Cluster.Context != "" {
				contexts = append(contexts, n.Cluster.Context)
			}
			for _, m := range n.Cluster.Nodes {
				nodes = append(nodes, m.Name)
			}
		}
	}
	return nodes, contexts
}

// EnvironmentMeta is what an environment template says about itself.
type EnvironmentMeta struct {
	ExamID   string
	Title    string
	Duration int32 // minutes
}

// Environment builds one environment LabTemplateSpec for the given resolved
// tasks: the union of their topologies (node names and contexts exactly as
// the tasks declare them; entry node first, the others sorted by name),
// their setup and teardown actions in task order, and their checks with ids
// prefixed "t<index>/". It has no params (each task was resolved with its
// own seed), no hints, no misconceptions and no solution: the reference
// solutions stay in the task templates (used only by `labctl exam run
// --auto-solve`), so nothing an attempt creates carries them.
func Environment(meta EnvironmentMeta, tasks []*Resolved) (*labsv1.LabTemplateSpec, error) {
	if len(tasks) == 0 {
		return nil, fmt.Errorf("no tasks")
	}
	first := tasks[0].Spec
	minutes := meta.Duration
	if minutes < 1 {
		minutes = 1
	}
	if minutes > 240 {
		minutes = 240
	}
	out := &labsv1.LabTemplateSpec{
		Source: labsv1.LabSource{
			ID: meta.ExamID + "-environment", Version: 1, Title: truncate(meta.Title, 80),
			Domain: first.Source.Domain, Difficulty: first.Source.Difficulty, EstimatedMinutes: minutes,
			Tags: []string{"exam-environment"},
		},
		Description: fmt.Sprintf("Environment of an attempt at %s.", meta.ExamID),
	}
	nodes := map[string]labsv1.Node{}
	var names []string
	for _, t := range tasks {
		topo := t.Spec.Topology
		if topo.Entry != "" {
			if out.Topology.Entry != "" && out.Topology.Entry != topo.Entry {
				return nil, fmt.Errorf("tasks enter through different nodes (%s, %s)", out.Topology.Entry, topo.Entry)
			}
			out.Topology.Entry = topo.Entry
		}
		for _, n := range topo.Nodes {
			if prev, ok := nodes[n.Name]; ok {
				if !apiequality.Semantic.DeepEqual(prev, n) {
					return nil, fmt.Errorf("node %s is defined differently by two drawn tasks", n.Name)
				}
				continue
			}
			nodes[n.Name] = n
			names = append(names, n.Name)
		}
		for _, l := range topo.Links {
			dup := false
			for _, have := range out.Topology.Links {
				if apiequality.Semantic.DeepEqual(have, l) {
					dup = true
					break
				}
			}
			if !dup {
				out.Topology.Links = append(out.Topology.Links, l)
			}
		}
		out.Setup = append(out.Setup, t.Spec.Setup...)
		out.Teardown = append(out.Teardown, t.Spec.Teardown...)
		for _, c := range t.Spec.Checks {
			c.ID = CheckID(t.Index, c.ID)
			out.Checks = append(out.Checks, c)
		}
	}
	sort.Strings(names)
	if e := out.Topology.Entry; e != "" {
		for i, n := range names {
			if n == e {
				names = append([]string{e}, append(names[:i:i], names[i+1:]...)...)
				break
			}
		}
	}
	for _, n := range names {
		out.Topology.Nodes = append(out.Topology.Nodes, nodes[n])
	}
	if out.Topology.Entry == "" {
		out.Topology.Entry = out.Topology.Nodes[0].Name
	}
	// LabTemplate requires solution steps; the environment's is a no-op on
	// the entry node (see above: solutions never enter an attempt's objects).
	noop := "true"
	out.Solution = labsv1.Solution{Steps: []labsv1.Action{{On: out.Topology.Entry, As: labsv1.ActionAsAdmin, Run: &noop}}}
	return out, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.TrimSpace(s[:n-1]) + "…"
}
