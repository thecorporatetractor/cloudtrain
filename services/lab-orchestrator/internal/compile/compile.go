// Package compile turns a cloudtrain.dev/v3 lab.yaml into a LabTemplate.
//
// Compilation is: YAML -> JSON, JSON-schema validation against the embedded
// lab schema, semantic validation (cross references the schema cannot
// express), conversion into api/v1alpha1 types with defaults applied.
// Params stay as {{placeholders}} in the template and are resolved per
// session from a seed by Resolve.
package compile

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/labschema"
)

// Defaults from lab.schema.json.
const (
	DefaultActionTimeoutSec = 60
	DefaultCheckTimeoutSec  = 5
	// DefaultShellCheckTimeoutSec: shell checks usually make several calls
	// (kubectl against a vcluster, ssh hops) and timed out at 5s under load.
	DefaultShellCheckTimeoutSec = 30
	// DefaultK8sCheckTimeoutSec: k8s-query, k8s-can-i and k8s-context checks
	// (one kubectl call) timed out at 5s under load; 20s passed.
	DefaultK8sCheckTimeoutSec = 20
	DefaultCheckWeight        = "1"
	DefaultHintCost           = 1
	DefaultLabVersion         = 1
	// Answer check defaults (lab.schema.json $defs/answer).
	DefaultAnswerPoints          = 100
	DefaultAnswerHintCost        = 10
	DefaultAnswerWhitespace      = labsv1.WhitespaceCollapse
	DefaultComputeTimeoutSec     = 30
	DefaultAnswerInputTimeoutSec = 60
	DefaultQuestionOrder         = "free"
)

// Options tune compilation.
type Options struct {
	// Schema overrides the embedded lab schema.
	Schema *jsonschema.Schema
	// Namespace for the produced LabTemplate (optional).
	Namespace string
	// BaseDir is the lab directory that file.source assets resolve against.
	// CompileFile sets it to the directory of lab.yaml.
	BaseDir string
}

// Issue is one validation problem.
type Issue struct {
	// Path is a JSON pointer-ish location, e.g. "/spec/topology/nodes/1".
	Path    string
	Message string
}

func (i Issue) String() string {
	if i.Path == "" {
		return i.Message
	}
	return i.Path + ": " + i.Message
}

// ValidationError aggregates schema and semantic issues.
type ValidationError struct {
	Issues []Issue
}

func (e *ValidationError) Error() string {
	parts := make([]string, len(e.Issues))
	for i, is := range e.Issues {
		parts[i] = is.String()
	}
	return fmt.Sprintf("invalid lab (%d issue(s)):\n  - %s", len(e.Issues), strings.Join(parts, "\n  - "))
}

// TemplateName is the LabTemplate name for a lab id and version.
func TemplateName(id string, version int32) string {
	return fmt.Sprintf("%s-v%d", id, version)
}

// CompileFile reads and compiles a lab.yaml.
func CompileFile(path string, opts Options) (*labsv1.LabTemplate, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if opts.BaseDir == "" {
		opts.BaseDir = filepath.Dir(path)
	}
	t, err := Compile(b, opts)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return t, nil
}

// Validate parses and validates a lab.yaml without producing a template.
func Validate(data []byte, opts Options) error {
	_, err := Compile(data, opts)
	return err
}

// Compile parses, validates and converts a lab.yaml into a LabTemplate.
func Compile(data []byte, opts Options) (*labsv1.LabTemplate, error) {
	js, err := yamlToJSON(data)
	if err != nil {
		return nil, fmt.Errorf("parse yaml: %w", err)
	}
	if bytes.Equal(bytes.TrimSpace(js), []byte("null")) {
		return nil, &ValidationError{Issues: []Issue{{Message: "empty document"}}}
	}

	schema := opts.Schema
	if schema == nil {
		if schema, err = labschema.Default(); err != nil {
			return nil, err
		}
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(js))
	if err != nil {
		return nil, fmt.Errorf("parse json: %w", err)
	}
	if err := schema.Validate(inst); err != nil {
		var ve *jsonschema.ValidationError
		if errors.As(err, &ve) {
			return nil, &ValidationError{Issues: schemaIssues(ve)}
		}
		return nil, err
	}

	var src sourceLab
	dec := json.NewDecoder(bytes.NewReader(js))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&src); err != nil {
		// The schema accepted the document, so this is a field the compiler
		// does not know; report it like any other validation issue.
		return nil, &ValidationError{Issues: []Issue{{Message: "decode lab: " + err.Error()}}}
	}

	if issues := inlineSources(&src, opts.BaseDir); len(issues) > 0 {
		return nil, &ValidationError{Issues: issues}
	}
	spec := convert(&src)
	if issues := validateSemantics(spec); len(issues) > 0 {
		return nil, &ValidationError{Issues: issues}
	}

	canon, err := json.Marshal(inst)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(canon)
	spec.Source.Digest = "sha256:" + hex.EncodeToString(sum[:])

	return &labsv1.LabTemplate{
		TypeMeta: metav1.TypeMeta{APIVersion: labsv1.GroupVersion.String(), Kind: "LabTemplate"},
		ObjectMeta: metav1.ObjectMeta{
			Name:      TemplateName(spec.Source.ID, spec.Source.Version),
			Namespace: opts.Namespace,
			Labels: map[string]string{
				"labs.cloudtrain.dev/lab-id":  spec.Source.ID,
				"labs.cloudtrain.dev/version": strconv.Itoa(int(spec.Source.Version)),
				"labs.cloudtrain.dev/domain":  string(spec.Source.Domain),
			},
		},
		Spec: *spec,
	}, nil
}

// schemaIssues flattens a jsonschema error tree into leaf issues.
func schemaIssues(ve *jsonschema.ValidationError) []Issue {
	p := message.NewPrinter(language.English)
	var out []Issue
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) == 0 {
			out = append(out, Issue{Path: "/" + strings.Join(e.InstanceLocation, "/"), Message: e.ErrorKind.LocalizedString(p)})
			return
		}
		for _, c := range e.Causes {
			walk(c)
		}
	}
	walk(ve)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func formatFloat(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func convert(src *sourceLab) *labsv1.LabTemplateSpec {
	m := src.Metadata
	version := int32(DefaultLabVersion)
	if m.Version != nil {
		version = *m.Version
	}
	s := src.Spec
	out := &labsv1.LabTemplateSpec{
		Source: labsv1.LabSource{
			ID: m.ID, Version: version, Title: m.Title, Domain: labsv1.Domain(m.Domain),
			Frameworks: m.Frameworks, Difficulty: labsv1.Difficulty(m.Difficulty),
			EstimatedMinutes: m.EstimatedMinutes, Tags: m.Tags,
		},
		Description: s.Description,
		Objectives:  s.Objectives,
		Topology:    convertTopology(s.Topology),
		Setup:       convertActions(s.Setup),
		Teardown:    convertActions(s.Teardown),
		Solution:    labsv1.Solution{Explanation: s.Solution.Explanation, Steps: convertActions(s.Solution.Steps), Answers: convertAnswerInputs(s.Solution.Answers)},
	}
	if s.Exam != nil {
		out.Exam = &labsv1.ExamTaskSpec{Rerun: convertActions(s.Exam.Rerun)}
	}
	for _, alt := range s.Solution.Alternatives {
		out.Solution.Alternatives = append(out.Solution.Alternatives, labsv1.SolutionAlternative{
			ID: alt.ID, Description: alt.Description, Steps: convertActions(alt.Steps),
		})
	}
	if len(s.Params) > 0 {
		out.Params = make(map[string]labsv1.ParamSpec, len(s.Params))
		for name, p := range s.Params {
			ps := labsv1.ParamSpec{Type: labsv1.ParamType(p.Type), Min: p.Min, Max: p.Max, Prefix: p.Prefix, Secret: p.Secret}
			for _, v := range p.Values {
				ps.Values = append(ps.Values, stringify(v))
			}
			if p.Default != nil {
				d := stringify(p.Default)
				ps.Default = &d
			}
			out.Params[name] = ps
		}
	}
	for _, c := range s.Checks {
		out.Checks = append(out.Checks, convertCheck(c))
	}
	if HasAnswerChecks(out) {
		out.QuestionOrder = s.QuestionOrder
		if out.QuestionOrder == "" {
			out.QuestionOrder = DefaultQuestionOrder
		}
	} else if s.QuestionOrder != "" {
		out.QuestionOrder = s.QuestionOrder
	}
	for _, h := range s.Hints {
		cost := int32(DefaultHintCost)
		if h.Cost != nil {
			cost = *h.Cost
		}
		out.Hints = append(out.Hints, labsv1.Hint{Title: h.Title, Body: h.Body, Command: h.Command, Cost: cost})
	}
	for _, mc := range s.Misconceptions {
		o := labsv1.Misconception{ID: mc.ID, Description: mc.Description, ExpectFail: mc.ExpectFail, Feedback: mc.Feedback, Answers: convertAnswerInputs(mc.Answers)}
		if mc.Mutation != nil {
			a := convertAction(*mc.Mutation)
			o.Mutation = &a
		}
		out.Misconceptions = append(out.Misconceptions, o)
	}
	return out
}

func stringify(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	case float64:
		return formatFloat(x)
	case bool:
		return strconv.FormatBool(x)
	case nil:
		return ""
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

func convertTopology(t sourceTopology) labsv1.Topology {
	out := labsv1.Topology{Entry: t.Entry}
	for _, n := range t.Nodes {
		node := labsv1.Node{Name: n.Name, Driver: labsv1.DriverName(n.Driver), Image: n.Image, LearnerSudo: n.LearnerSudo}
		for _, a := range n.Access {
			node.Access = append(node.Access, labsv1.AccessType(a))
		}
		if r := n.Resources; r != nil {
			nr := &labsv1.NodeResources{MemoryMiB: r.MemoryMiB, Disks: r.Disks}
			if r.CPU != nil {
				q := resource.NewMilliQuantity(int64(math.Round(*r.CPU*1000)), resource.DecimalSI)
				nr.CPU = q
			}
			node.Resources = nr
		}
		if c := n.Cluster; c != nil {
			cs := &labsv1.ClusterSpec{Mode: labsv1.ClusterMode(c.Mode), Version: c.Version, Context: c.Context}
			if cs.Mode == "" {
				cs.Mode = labsv1.ClusterModeVirtual
			}
			if cs.Context == "" {
				cs.Context = n.Name
			}
			for _, cn := range c.Nodes {
				state := labsv1.ClusterNodeState(cn.State)
				if state == "" {
					state = "ready"
				}
				cs.Nodes = append(cs.Nodes, labsv1.ClusterNode{
					Name: cn.Name, Role: labsv1.ClusterNodeRole(cn.Role), Taints: cn.Taints, Labels: cn.Labels, State: state,
				})
			}
			node.Cluster = cs
		}
		out.Nodes = append(out.Nodes, node)
	}
	if out.Entry == "" {
		out.Entry = defaultEntry(out.Nodes)
	}
	for _, l := range t.Links {
		link := labsv1.Link{A: l.A, B: l.B, Subnet: l.Subnet}
		if im := l.Impair; im != nil {
			li := &labsv1.LinkImpairment{LatencyMs: im.LatencyMs, MTU: im.MTU}
			if im.LossPct != nil {
				li.LossPct = formatFloat(*im.LossPct)
			}
			link.Impair = li
		}
		out.Links = append(out.Links, link)
	}
	return out
}

// defaultEntry picks the first container node, else the first node.
func defaultEntry(nodes []labsv1.Node) string {
	for _, n := range nodes {
		if n.Driver == labsv1.DriverContainer {
			return n.Name
		}
	}
	if len(nodes) > 0 {
		return nodes[0].Name
	}
	return ""
}

// inlineSources replaces every file.source with the asset's content, read
// from baseDir. Assets must stay inside the lab directory.
func inlineSources(src *sourceLab, baseDir string) []Issue {
	var issues []Issue
	visit := func(path string, actions []sourceAction) {
		for i := range actions {
			f := actions[i].File
			if f == nil || f.Source == "" {
				continue
			}
			p := fmt.Sprintf("%s/%d/file/source", path, i)
			if baseDir == "" {
				issues = append(issues, Issue{Path: p, Message: "file.source needs the lab directory; compile the lab from its file"})
				continue
			}
			if !filepath.IsLocal(f.Source) {
				issues = append(issues, Issue{Path: p, Message: fmt.Sprintf("asset %q escapes the lab directory", f.Source)})
				continue
			}
			// os.Root also refuses symlinks (and ..) that resolve outside baseDir.
			b, err := readInRoot(baseDir, f.Source)
			if err != nil {
				issues = append(issues, Issue{Path: p, Message: "read asset: " + err.Error()})
				continue
			}
			f.Content, f.Source = string(b), ""
		}
	}
	s := &src.Spec
	visit("/spec/setup", s.Setup)
	visit("/spec/teardown", s.Teardown)
	visit("/spec/solution/steps", s.Solution.Steps)
	if s.Exam != nil {
		visit("/spec/exam/rerun", s.Exam.Rerun)
	}
	for i := range s.Solution.Alternatives {
		visit(fmt.Sprintf("/spec/solution/alternatives/%d/steps", i), s.Solution.Alternatives[i].Steps)
	}
	for i := range s.Misconceptions {
		if m := s.Misconceptions[i].Mutation; m != nil {
			visit(fmt.Sprintf("/spec/misconceptions/%d", i), []sourceAction{*m}) // File is a pointer, so the copy shares it
		}
	}
	return issues
}

// readInRoot reads name below dir without following anything out of dir.
func readInRoot(dir, name string) ([]byte, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.ReadFile(name)
}

func convertActions(in []sourceAction) []labsv1.Action {
	var out []labsv1.Action
	for _, a := range in {
		out = append(out, convertAction(a))
	}
	return out
}

func convertAction(a sourceAction) labsv1.Action {
	out := labsv1.Action{On: a.On, As: labsv1.ActionUser(a.As), Run: a.Run, Apply: a.Apply, Config: a.Config, TimeoutSec: DefaultActionTimeoutSec}
	if out.As == "" {
		out.As = labsv1.ActionAsAdmin
	}
	if a.TimeoutSec != nil {
		out.TimeoutSec = *a.TimeoutSec
	}
	if a.File != nil {
		out.File = &labsv1.FileAction{Path: a.File.Path, Content: a.File.Content, Mode: a.File.Mode}
	}
	return out
}

func convertCheck(c sourceCheck) labsv1.Check {
	out := labsv1.Check{
		ID: c.ID, Description: c.Description, Skills: c.Skills, Weight: DefaultCheckWeight,
		Type: labsv1.CheckType(c.Type), On: c.On, Command: c.Command, Target: c.Target, Port: c.Port,
		TimeoutSec: DefaultCheckTimeoutSec,
	}
	if c.Weight != nil {
		out.Weight = formatFloat(*c.Weight)
	}
	switch out.Type {
	case "shell":
		out.TimeoutSec = DefaultShellCheckTimeoutSec
	case "k8s-query", "k8s-can-i", "k8s-context":
		out.TimeoutSec = DefaultK8sCheckTimeoutSec
	}
	if c.TimeoutSec != nil {
		out.TimeoutSec = *c.TimeoutSec
	}
	if q := c.Query; q != nil {
		out.Query = &labsv1.CheckQuery{Cluster: q.Cluster, Resource: q.Resource, Name: q.Name, Namespace: q.Namespace, JSONPath: q.JSONPath, Verb: q.Verb, As: q.As}
	}
	if e := c.Expect; e != nil {
		out.Expect = &labsv1.Expectation{Match: labsv1.MatchType(e.Match), Value: e.Value}
	}
	if a := c.Answer; a != nil {
		out.Answer = convertAnswer(a)
		// Answer checks never run on a node through the grader.
		out.TimeoutSec = 0
	}
	return out
}

func convertAnswer(a *sourceAnswer) *labsv1.AnswerSpec {
	out := &labsv1.AnswerSpec{
		Match: labsv1.AnswerMatch(a.Match), Value: a.Value, Values: a.Values,
		CaseSensitive: a.CaseSensitive, Whitespace: labsv1.AnswerWhitespace(a.Whitespace),
		Points: DefaultAnswerPoints, Placeholder: a.Placeholder,
	}
	if out.Whitespace == "" {
		out.Whitespace = DefaultAnswerWhitespace
	}
	if a.Tolerance != nil && *a.Tolerance > 0 {
		out.Tolerance = formatFloat(*a.Tolerance)
	}
	if a.Points != nil {
		out.Points = *a.Points
	}
	if a.MaxAttempts != nil {
		out.MaxAttempts = *a.MaxAttempts
	}
	if a.Penalty != nil {
		out.Penalty = *a.Penalty
	}
	if c := a.Compute; c != nil {
		out.Compute = &labsv1.AnswerCompute{On: c.On, Command: c.Command, TimeoutSec: DefaultComputeTimeoutSec}
		if c.TimeoutSec != nil {
			out.Compute.TimeoutSec = *c.TimeoutSec
		}
	}
	for _, h := range a.Hints {
		cost := int32(DefaultAnswerHintCost)
		if h.Cost != nil {
			cost = *h.Cost
		}
		out.Hints = append(out.Hints, labsv1.AnswerHint{Body: h.Body, Cost: cost})
	}
	return out
}

func convertAnswerInputs(in map[string]sourceAnswerInput) map[string]labsv1.AnswerInput {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]labsv1.AnswerInput, len(in))
	for id, a := range in {
		if a.Value != nil {
			v := *a.Value
			out[id] = labsv1.AnswerInput{Value: &v}
			continue
		}
		ai := labsv1.AnswerInput{On: a.On, As: labsv1.ActionUser(a.As), Command: a.Command, TimeoutSec: DefaultAnswerInputTimeoutSec}
		if ai.As == "" {
			ai.As = labsv1.ActionAsLearner
		}
		if a.TimeoutSec != nil {
			ai.TimeoutSec = *a.TimeoutSec
		}
		out[id] = ai
	}
	return out
}

// HasAnswerChecks reports whether a lab has at least one answer check.
func HasAnswerChecks(s *labsv1.LabTemplateSpec) bool {
	for _, c := range s.Checks {
		if c.Type == labsv1.CheckTypeAnswer {
			return true
		}
	}
	return false
}
