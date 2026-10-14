package exam

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	apiequality "k8s.io/apimachinery/pkg/api/equality"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// CompileOptions tune exam compilation.
type CompileOptions struct {
	Namespace string
	// AllowMissing drops pool tasks whose lab is not available instead of
	// failing; an objective whose pool then holds fewer tasks than it draws
	// still fails.
	AllowMissing bool
}

// Compiled is an exam ready to apply: its ExamTemplate plus the LabTemplate
// of every pool task it references.
type Compiled struct {
	Exam  *labsv1.ExamTemplate
	Tasks []*labsv1.LabTemplate
	// Missing lists pool task ids without a lab (only with AllowMissing).
	Missing []string
}

// IssueError lists everything wrong with an exam definition.
type IssueError struct {
	Exam   string
	Issues []string
}

func (e *IssueError) Error() string {
	return fmt.Sprintf("exam %s: %d issue(s):\n  - %s", e.Exam, len(e.Issues), strings.Join(e.Issues, "\n  - "))
}

// ContentName names a task LabTemplate after its id, version and content
// digest, exactly like the gateway (services/gateway/src/kube/compile.ts),
// so labs and exams share templates and an edited lab gets a new template.
func ContentName(lt *labsv1.LabTemplate) string {
	digest := strings.TrimPrefix(lt.Spec.Source.Digest, "sha256:")
	if len(digest) > 10 {
		digest = digest[:10]
	}
	if digest == "" {
		return lt.Name
	}
	return fmt.Sprintf("%s-v%d-%s", lt.Spec.Source.ID, lt.Spec.Source.Version, digest)
}

// Compile turns an exam definition and its pool tasks' compiled (unresolved)
// LabTemplates, keyed by lab id, into an ExamTemplate.
func Compile(def *Definition, labs map[string]*labsv1.LabTemplate, opts CompileOptions) (*Compiled, error) {
	var issues []string
	add := func(format string, args ...any) { issues = append(issues, fmt.Sprintf(format, args...)) }
	if def.Rules.Hints {
		add("rules.hints must be false")
	}
	env := labsv1.ExamEnvironment(def.Environment)
	if env != labsv1.ExamEnvironmentShared && env != labsv1.ExamEnvironmentPerTask {
		add("environment %q is not shared or per-task", def.Environment)
	}

	out := &Compiled{}
	spec := labsv1.ExamTemplateSpec{
		Source: labsv1.ExamSource{
			ID: def.ID, Title: def.Title, Domain: def.Domain, AlignsTo: def.AlignsTo,
			Disclaimer: def.Disclaimer, Format: def.Format, Description: def.Description,
		},
		DurationMinutes: def.DurationMinutes,
		PassMark:        def.PassMark.String(),
		PassMarkNote:    def.PassMarkNote,
		Environment:     env,
		EnvTier:         def.EnvTier,
		Rules: labsv1.ExamRules{
			Timer: def.Rules.Timer, AnyOrder: def.Rules.AnyOrder, FlagForReview: def.Rules.FlagForReview,
			RebootBeforeGrade: def.Rules.RebootBeforeGrade, IdempotencyRerun: def.Rules.IdempotencyRerun,
			PartialCredit: labsv1.PartialCredit(def.Rules.PartialCredit), DocsAllowed: def.Rules.DocsAllowed,
			Notes: def.Rules.Notes,
		},
		RetakePolicy: labsv1.ExamRetakePolicy{
			FreeRetakes: def.RetakePolicy.FreeRetakes, CooldownHours: def.RetakePolicy.CooldownHours,
			MaxAttemptsPer30Days: def.RetakePolicy.MaxAttemptsPer30Days, FreshDraw: def.RetakePolicy.FreshDraw,
			Notes: def.RetakePolicy.Notes,
		},
	}
	if spec.Rules.PartialCredit == "" {
		spec.Rules.PartialCredit = labsv1.PartialCreditPerCheck
	}

	seenTask := map[string]string{} // task id -> objective
	var used []*labsv1.LabTemplate
	var total int32
	for _, o := range def.Blueprint {
		obj := labsv1.ExamObjective{ID: o.Objective, Weight: o.Weight.String(), Tasks: o.Tasks}
		for _, id := range o.Pool {
			if prev, dup := seenTask[id]; dup {
				add("task %s is in the pools of both %s and %s (a task belongs to exactly one pool)", id, prev, o.Objective)
				continue
			}
			seenTask[id] = o.Objective
			lt, ok := labs[id]
			if !ok {
				if opts.AllowMissing {
					out.Missing = append(out.Missing, id)
				} else {
					add("pool task %s (%s) has no lab", id, o.Objective)
				}
				continue
			}
			t := lt.DeepCopy()
			t.Name = ContentName(t)
			t.Namespace = opts.Namespace
			t.ResourceVersion = ""
			used = append(used, t)
			obj.Pool = append(obj.Pool, labsv1.ExamPoolTask{ID: id, TemplateRef: labsv1.TemplateReference{Name: t.Name}})
		}
		if int32(len(obj.Pool)) < o.Tasks {
			add("objective %s draws %d task(s) but its pool has %d available", o.Objective, o.Tasks, len(obj.Pool))
		}
		total += o.Tasks
		spec.Objectives = append(spec.Objectives, obj)
	}
	if total != def.TaskCount {
		add("taskCount is %d but the blueprint draws %d", def.TaskCount, total)
	}
	spec.TaskCount = total
	for _, t := range used {
		issues = append(issues, taskIssues(t)...)
	}
	if env == labsv1.ExamEnvironmentShared {
		issues = append(issues, SharedConsistency(used)...)
	}
	if len(issues) > 0 {
		return nil, &IssueError{Exam: def.ID, Issues: issues}
	}

	digest, err := examDigest(def, used)
	if err != nil {
		return nil, err
	}
	spec.Source.Digest = digest
	out.Exam = &labsv1.ExamTemplate{
		TypeMeta: metav1.TypeMeta{APIVersion: labsv1.GroupVersion.String(), Kind: "ExamTemplate"},
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-%s", def.ID, strings.TrimPrefix(digest, "sha256:")[:10]),
			Namespace: opts.Namespace,
			Labels:    map[string]string{labsv1.LabelExamID: def.ID},
		},
		Spec: spec,
	}
	out.Tasks = used
	sort.Strings(out.Missing)
	return out, nil
}

// taskIssues are exam-task rules a lab must follow beyond the lab schema.
func taskIssues(t *labsv1.LabTemplate) []string {
	var out []string
	id := t.Spec.Source.ID
	for _, c := range t.Spec.Checks {
		if c.Type == "k8s-context" {
			// The candidate switches contexts between tasks of a shared
			// environment; the final current context says nothing about one task.
			out = append(out, fmt.Sprintf("task %s check %s: k8s-context checks are not allowed in exam tasks (the statement names the context instead)", id, c.ID))
		}
	}
	return out
}

// SharedConsistency checks that the tasks can share one environment for any
// draw: a node name means the same node in every task (same driver, image,
// resources, access and cluster definition), a kubeconfig context belongs to
// one node, every task enters through the same entry node, and links never
// disagree about an interface.
func SharedConsistency(tasks []*labsv1.LabTemplate) []string {
	var issues []string
	type owner struct {
		task string
		node labsv1.Node
	}
	nodes := map[string]owner{}
	contexts := map[string]owner{}
	ifaces := map[string]string{} // "node:iface" -> "peer|subnet"
	ifaceOwner := map[string]string{}
	entry, entryTask := "", ""
	for _, t := range tasks {
		id := t.Spec.Source.ID
		topo := &t.Spec.Topology
		if topo.Entry != "" {
			if entry == "" {
				entry, entryTask = topo.Entry, id
			} else if entry != topo.Entry {
				issues = append(issues, fmt.Sprintf("tasks %s and %s enter through different nodes (%s, %s); a shared environment has one entry node", entryTask, id, entry, topo.Entry))
			}
		}
		for _, n := range topo.Nodes {
			if prev, ok := nodes[n.Name]; ok {
				if !apiequality.Semantic.DeepEqual(prev.node, n) {
					issues = append(issues, fmt.Sprintf("node %s is defined differently by tasks %s and %s; shared nodes must be identical", n.Name, prev.task, id))
				}
			} else {
				nodes[n.Name] = owner{id, n}
			}
			if n.Cluster != nil && n.Cluster.Context != "" {
				if prev, ok := contexts[n.Cluster.Context]; ok && prev.node.Name != n.Name {
					issues = append(issues, fmt.Sprintf("context %s names node %s in task %s but node %s in task %s", n.Cluster.Context, prev.node.Name, prev.task, n.Name, id))
				} else if !ok {
					contexts[n.Cluster.Context] = owner{id, n}
				}
			}
		}
		for _, l := range topo.Links {
			for _, end := range [][2]string{{l.A, l.B}, {l.B, l.A}} {
				v := end[1] + "|" + l.Subnet
				if prev, ok := ifaces[end[0]]; ok && prev != v {
					issues = append(issues, fmt.Sprintf("interface %s is wired differently by tasks %s and %s", end[0], ifaceOwner[end[0]], id))
				} else if !ok {
					ifaces[end[0]], ifaceOwner[end[0]] = v, id
				}
			}
		}
	}
	return issues
}

func examDigest(def *Definition, tasks []*labsv1.LabTemplate) (string, error) {
	b, err := json.Marshal(def)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write(b)
	for _, t := range tasks {
		h.Write([]byte("\x00" + t.Spec.Source.ID + "\x00" + t.Spec.Source.Digest))
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}
