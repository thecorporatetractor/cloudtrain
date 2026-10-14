package main

// labctl exam: compile exam simulations from content/curriculum.yaml, preview
// a draw, and run attempts end to end on a live cluster as the exam's
// verification gate (--auto-solve must score 100 %, --no-solve must fail).

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"

	"sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/exam"
)

const examUsage = `labctl exam - exam simulations

Usage:
  labctl exam compile [flags] <exam-id>|--all   print the exam's LabTemplates + ExamTemplate (multi-document YAML)
  labctl exam draw [flags] <exam-id>            preview one attempt's draw, params and environment
  labctl exam run [flags] <exam-id>             run attempts on a live cluster (--auto-solve or --no-solve)

Common flags: --exams FILE (default <repo>/content/curriculum.yaml),
--labs DIR[,DIR] (default <repo>/content/packs), --allow-missing.
`

func cmdExam(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, examUsage)
		return 2
	}
	switch args[0] {
	case "compile":
		return cmdExamCompile(args[1:], stdout, stderr)
	case "draw":
		return cmdExamDraw(args[1:], stdout, stderr)
	case "run":
		return cmdExamRun(args[1:], stdout, stderr)
	case "-h", "--help", "help":
		fmt.Fprint(stdout, examUsage)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown exam command %q\n\n%s", args[0], examUsage)
		return 2
	}
}

// examSource are the flags every exam command shares.
type examSource struct {
	exams, labs, repoRoot string
	allowMissing          bool
}

func (s *examSource) bind(fl *flag.FlagSet) {
	fl.StringVar(&s.exams, "exams", "", "curriculum (or any YAML with an `exams` list) (default <repo>/content/curriculum.yaml)")
	fl.StringVar(&s.labs, "labs", "", "lab directories searched for pool tasks, comma separated (default <repo>/content/packs)")
	fl.StringVar(&s.repoRoot, "repo-root", "", "repository root (default: found from the working directory)")
	fl.BoolVar(&s.allowMissing, "allow-missing", false, "drop pool tasks without a lab instead of failing (pools must still cover their draw)")
}

func (s *examSource) resolveDefaults() {
	if s.repoRoot == "" {
		s.repoRoot = findRepoRoot()
	}
	if s.exams == "" {
		s.exams = filepath.Join(s.repoRoot, "content", "curriculum.yaml")
	}
	if s.labs == "" {
		s.labs = filepath.Join(s.repoRoot, "content", "packs")
	}
}

// load parses the exams and compiles every lab that is in a pool of the
// selected exams (keyed by lab id).
func (s *examSource) load(ids []string) ([]*exam.Definition, map[string]*labsv1.LabTemplate, error) {
	s.resolveDefaults()
	all, _, err := exam.LoadFile(s.exams)
	if err != nil && len(all) == 0 {
		return nil, nil, err
	}
	var defs []*exam.Definition
	for _, id := range ids {
		d, ferr := exam.Find(all, id)
		if ferr != nil {
			if err != nil {
				return nil, nil, errors.Join(ferr, err)
			}
			return nil, nil, ferr
		}
		defs = append(defs, d)
	}
	want := map[string]bool{}
	for _, d := range defs {
		for _, o := range d.Blueprint {
			for _, id := range o.Pool {
				want[id] = true
			}
		}
	}
	labs := map[string]*labsv1.LabTemplate{}
	paths := map[string]string{}
	var errs []error
	for _, dir := range strings.Split(s.labs, ",") {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			continue
		}
		werr := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || (d.Name() != "lab.yaml" && d.Name() != "lab.yml") {
				return nil
			}
			id, err := labID(p)
			if err != nil || !want[id] {
				return nil
			}
			lt, err := compile.CompileFile(p, compile.Options{})
			if err != nil {
				errs = append(errs, err)
				return nil
			}
			if prev, dup := paths[id]; dup {
				errs = append(errs, fmt.Errorf("lab %s found twice (%s and %s)", id, prev, p))
				return nil
			}
			paths[id] = p
			labs[id] = lt
			return nil
		})
		if werr != nil {
			return nil, nil, werr
		}
	}
	if len(errs) > 0 {
		return nil, nil, errors.Join(errs...)
	}
	return defs, labs, nil
}

func labID(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var doc struct {
		Metadata struct {
			ID string `json:"id"`
		} `json:"metadata"`
	}
	if err := yaml.Unmarshal(b, &doc); err != nil {
		return "", err
	}
	return doc.Metadata.ID, nil
}

func cmdExamCompile(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("exam compile", flag.ContinueOnError)
	fl.SetOutput(stderr)
	var src examSource
	src.bind(fl)
	namespace := fl.String("namespace", "", "namespace for the produced objects")
	all := fl.Bool("all", false, "compile every exam in the file (reports each exam's issues)")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	ids := fl.Args()
	if *all {
		src.resolveDefaults()
		defs, _, err := exam.LoadFile(src.exams)
		if err != nil && len(defs) == 0 {
			fmt.Fprintln(stderr, err)
			return 1
		}
		ids = nil
		for _, d := range defs {
			ids = append(ids, d.ID)
		}
	}
	if len(ids) == 0 {
		fmt.Fprintln(stderr, "usage: labctl exam compile [flags] <exam-id>... | --all")
		return 2
	}
	defs, labs, err := src.load(ids)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	failed := 0
	var docs [][]byte
	seen := map[string]bool{}
	for _, d := range defs {
		c, err := exam.Compile(d, labs, exam.CompileOptions{Namespace: *namespace, AllowMissing: src.allowMissing})
		if err != nil {
			failed++
			fmt.Fprintln(stderr, err)
			continue
		}
		if len(c.Missing) > 0 {
			fmt.Fprintf(stderr, "exam %s: %d pool task(s) without a lab dropped: %s\n", d.ID, len(c.Missing), strings.Join(c.Missing, ", "))
		}
		for _, t := range c.Tasks {
			if seen[t.Name] {
				continue
			}
			seen[t.Name] = true
			b, err := yaml.Marshal(t)
			if err != nil {
				fmt.Fprintln(stderr, err)
				return 1
			}
			docs = append(docs, b)
		}
		b, err := yaml.Marshal(c.Exam)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		docs = append(docs, b)
	}
	for i, d := range docs {
		if i > 0 {
			fmt.Fprintln(stdout, "---")
		}
		_, _ = stdout.Write(d)
	}
	if failed > 0 {
		fmt.Fprintf(stderr, "%d of %d exam(s) failed to compile\n", failed, len(defs))
		return 1
	}
	return 0
}

// DrawReport is the machine-readable result of `labctl exam draw`.
type DrawReport struct {
	Exam        string           `json:"exam"`
	Seed        int64            `json:"seed"`
	Avoid       []string         `json:"avoid,omitempty"`
	Environment string           `json:"environment"`
	Tasks       []DrawnTask      `json:"tasks"`
	Envs        []DrawEnvironent `json:"environments"`
}

// DrawnTask is one drawn task of a preview.
type DrawnTask struct {
	Index     int32             `json:"index"`
	Objective string            `json:"objective"`
	ID        string            `json:"id"`
	Title     string            `json:"title"`
	Weight    string            `json:"weight"`
	Seed      int64             `json:"seed"`
	Reused    bool              `json:"reused,omitempty"`
	Params    map[string]string `json:"params,omitempty"`
	Statement string            `json:"statement,omitempty"`
}

// DrawEnvironent is one environment of a preview.
type DrawEnvironent struct {
	Name     string   `json:"name"`
	Tasks    []int32  `json:"tasks"`
	Entry    string   `json:"entry"`
	Nodes    []string `json:"nodes"`
	Contexts []string `json:"contexts,omitempty"`
	Setup    int      `json:"setupActions"`
	Checks   int      `json:"checks"`
}

// preview draws and resolves one attempt offline.
func preview(c *exam.Compiled, seed int64, avoid []string, statements bool) (*DrawReport, []*exam.Resolved, map[string]*labsv1.LabTemplateSpec, error) {
	spec := &c.Exam.Spec
	drawn, err := exam.Draw(spec, seed, avoid)
	if err != nil {
		return nil, nil, nil, err
	}
	byName := map[string]*labsv1.LabTemplate{}
	for _, t := range c.Tasks {
		byName[t.Name] = t
	}
	rep := &DrawReport{Exam: spec.Source.ID, Seed: seed, Avoid: avoid, Environment: string(spec.Environment)}
	var resolved []*exam.Resolved
	for _, d := range drawn {
		rt, err := exam.Resolve(d, &byName[d.TemplateRef].Spec)
		if err != nil {
			return nil, nil, nil, err
		}
		resolved = append(resolved, rt)
		dt := DrawnTask{Index: d.Index, Objective: d.Objective, ID: d.ID, Title: rt.Spec.Source.Title,
			Weight: exam.FormatWeight(d.Weight), Seed: d.Seed, Reused: d.Reused, Params: rt.Params}
		if statements {
			dt.Statement = rt.Spec.Description
		}
		rep.Tasks = append(rep.Tasks, dt)
	}
	groups := map[string][]*exam.Resolved{}
	var names []string
	for _, rt := range resolved {
		name := "env"
		if spec.Environment == labsv1.ExamEnvironmentPerTask {
			name = fmt.Sprintf("t%d", rt.Index)
		}
		if _, ok := groups[name]; !ok {
			names = append(names, name)
		}
		groups[name] = append(groups[name], rt)
	}
	envs := map[string]*labsv1.LabTemplateSpec{}
	for _, name := range names {
		es, err := exam.Environment(exam.EnvironmentMeta{ExamID: spec.Source.ID, Title: spec.Source.Title, Duration: spec.DurationMinutes}, groups[name])
		if err != nil {
			return nil, nil, nil, err
		}
		envs[name] = es
		de := DrawEnvironent{Name: name, Entry: es.Topology.Entry, Setup: len(es.Setup), Checks: len(es.Checks)}
		for _, rt := range groups[name] {
			de.Tasks = append(de.Tasks, rt.Index)
		}
		for _, n := range es.Topology.Nodes {
			de.Nodes = append(de.Nodes, n.Name)
		}
		_, de.Contexts = exam.TaskNodes(es)
		rep.Envs = append(rep.Envs, de)
	}
	return rep, resolved, envs, nil
}

func splitList(s string) []string {
	var out []string
	for _, x := range strings.Split(s, ",") {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func cmdExamDraw(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("exam draw", flag.ContinueOnError)
	fl.SetOutput(stderr)
	var src examSource
	src.bind(fl)
	seed := fl.Int64("seed", 1, "attempt seed")
	avoid := fl.String("avoid", "", "task ids of earlier attempts, comma separated (fresh draw avoids them when the pool allows)")
	output := fl.String("o", "text", "output: text or json")
	statements := fl.Bool("statements", false, "include the resolved task statements")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	if fl.NArg() != 1 {
		fmt.Fprintln(stderr, "usage: labctl exam draw [flags] <exam-id>")
		return 2
	}
	defs, labs, err := src.load(fl.Args())
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	c, err := exam.Compile(defs[0], labs, exam.CompileOptions{AllowMissing: src.allowMissing})
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	rep, _, _, err := preview(c, *seed, splitList(*avoid), *statements)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if *output == "json" {
		b, _ := json.MarshalIndent(rep, "", "  ")
		fmt.Fprintln(stdout, string(b))
		return 0
	}
	fmt.Fprintf(stdout, "exam %s, seed %d, environment %s\n\n", rep.Exam, rep.Seed, rep.Environment)
	tw := tabwriter.NewWriter(stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "#\tOBJECTIVE\tTASK\tWEIGHT\tPARAMS")
	for _, t := range rep.Tasks {
		var ps []string
		for k, v := range t.Params {
			ps = append(ps, k+"="+v)
		}
		sort.Strings(ps)
		id := t.ID
		if t.Reused {
			id += " (reused)"
		}
		fmt.Fprintf(tw, "%d\t%s\t%s\t%s%%\t%s\n", t.Index, t.Objective, id, t.Weight, strings.Join(ps, " "))
	}
	_ = tw.Flush()
	for _, e := range rep.Envs {
		fmt.Fprintf(stdout, "\nenvironment %s: tasks %v, entry %s, nodes %s, contexts %s, %d setup action(s), %d check(s)\n",
			e.Name, e.Tasks, e.Entry, strings.Join(e.Nodes, ","), strings.Join(e.Contexts, ","), e.Setup, e.Checks)
	}
	if *statements {
		for _, t := range rep.Tasks {
			fmt.Fprintf(stdout, "\n--- task %d: %s\n%s", t.Index, t.Title, t.Statement)
		}
	}
	return 0
}
