package compile

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/answer"
)

var (
	paramNameRe   = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	placeholderRe = regexp.MustCompile(`\{\{\s*([^{}\s]*)\s*\}\}`)
)

// literalPlaceholder reports whether the placeholder match m (name = its
// captured name) is literal text rather than a param reference: written with
// inner whitespace ("{{ name }}", the Jinja/Ansible style) and not naming a
// declared param. "{{name}}" without whitespace is always a param reference,
// so a typo there still fails validation; "{{ name }}" naming a declared
// param is substituted like before.
func literalPlaceholder(m, name string, declared func(string) bool) bool {
	return m != "{{"+name+"}}" && !declared(name)
}

// validateSemantics checks cross references the JSON schema cannot express.
func validateSemantics(s *labsv1.LabTemplateSpec) []Issue {
	var issues []Issue
	add := func(path, format string, args ...any) {
		issues = append(issues, Issue{Path: path, Message: fmt.Sprintf(format, args...)})
	}

	// Params.
	names := make([]string, 0, len(s.Params))
	for n := range s.Params {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		p := s.Params[n]
		path := "/spec/params/" + n
		if !paramNameRe.MatchString(n) {
			add(path, "param name must match %s", paramNameRe)
		}
		switch p.Type {
		case labsv1.ParamChoice:
			if len(p.Values) == 0 {
				add(path, "choice param needs at least one value")
			}
			if p.Default != nil && !slices.Contains(p.Values, *p.Default) {
				add(path+"/default", "default %q is not one of the values", *p.Default)
			}
		case labsv1.ParamInt:
			if p.Min == nil || p.Max == nil {
				add(path, "int param needs min and max")
			} else if *p.Min > *p.Max {
				add(path, "min (%d) > max (%d)", *p.Min, *p.Max)
			}
			if p.Default != nil {
				d, err := strconv.ParseInt(*p.Default, 10, 64)
				switch {
				case err != nil:
					add(path+"/default", "default %q is not an integer", *p.Default)
				case p.Min != nil && d < *p.Min, p.Max != nil && d > *p.Max:
					add(path+"/default", "default %d is outside [min, max]", d)
				}
			}
		case labsv1.ParamName:
			if p.Prefix != "" && !dnsLabelRe.MatchString(p.Prefix) {
				add(path, "name prefix %q must be a lowercase DNS label", p.Prefix)
			}
		}
	}

	// Nodes.
	nodes := map[string]*labsv1.Node{}
	for i := range s.Topology.Nodes {
		n := &s.Topology.Nodes[i]
		path := fmt.Sprintf("/spec/topology/nodes/%d", i)
		if _, dup := nodes[n.Name]; dup {
			add(path, "duplicate node name %q", n.Name)
		}
		nodes[n.Name] = n
		if n.Cluster != nil && n.Driver != labsv1.DriverK8sCluster {
			add(path, "cluster is only allowed for driver k8s-cluster")
		}
		if n.LearnerSudo && (n.Driver != labsv1.DriverContainer || n.Name != s.Topology.Entry) {
			add(path+"/learnerSudo", "learnerSudo is only allowed on the entry node (driver container)")
		}
		if n.Driver == labsv1.DriverK8sCluster {
			if n.Cluster == nil {
				add(path, "driver k8s-cluster requires cluster")
				continue
			}
			members := map[string]bool{}
			cps := 0
			for j, m := range n.Cluster.Nodes {
				mp := fmt.Sprintf("%s/cluster/nodes/%d", path, j)
				if members[m.Name] {
					add(mp, "duplicate cluster node %q", m.Name)
				}
				members[m.Name] = true
				if m.State == "unjoined" {
					if len(m.Taints) > 0 || len(m.Labels) > 0 {
						add(mp, "unjoined node %q is not registered at boot: it takes no taints or labels", m.Name)
					}
				} else if m.Role == "control-plane" {
					cps++
				}
			}
			if n.Cluster.Mode == labsv1.ClusterModeKubeadm && cps != 1 {
				add(path+"/cluster", "kubeadm cluster needs exactly one control-plane node that is not unjoined (it runs kubeadm init), has %d; a further control plane joins later: role control-plane, state unjoined", cps)
			}
			if n.Cluster.Mode == labsv1.ClusterModeVirtual && len(n.Cluster.Nodes) > 0 {
				add(path+"/cluster/nodes", "virtual clusters have no addressable nodes; use mode kubeadm")
			}
		} else if n.Image == "" {
			add(path, "image is required for driver %s", n.Driver)
		}
	}
	if s.Topology.Entry != "" && nodes[s.Topology.Entry] == nil {
		add("/spec/topology/entry", "unknown node %q", s.Topology.Entry)
	}

	// Links.
	usedIf := map[string]string{}
	for i, l := range s.Topology.Links {
		for _, side := range []struct{ key, ep string }{{"a", l.A}, {"b", l.B}} {
			path := fmt.Sprintf("/spec/topology/links/%d/%s", i, side.key)
			node, iface, ok := strings.Cut(side.ep, ":")
			if !ok || node == "" || iface == "" {
				add(path, "endpoint %q must be node:interface", side.ep)
				continue
			}
			if nodes[node] == nil {
				add(path, "unknown node %q", node)
			}
			if prev, dup := usedIf[side.ep]; dup {
				add(path, "interface %q already used by %s", side.ep, prev)
			}
			usedIf[side.ep] = fmt.Sprintf("link %d", i)
		}
	}

	// Actions.
	checkAction := func(path string, a labsv1.Action) {
		node, member, hasMember := strings.Cut(a.On, "/")
		n := nodes[node]
		if n == nil {
			add(path+"/on", "unknown node %q", a.On)
			return
		}
		if hasMember {
			if n.Cluster == nil || n.Cluster.Mode != labsv1.ClusterModeKubeadm || !hasClusterMember(n.Cluster, member) {
				add(path+"/on", "%q is not a member of kubeadm cluster %q", member, node)
			}
		}
		if a.Apply != nil && n.Driver != labsv1.DriverK8sCluster {
			add(path, "apply requires a k8s-cluster node, %q is %s", node, n.Driver)
		}
		if a.Config != nil && n.Driver != labsv1.DriverNetdev {
			add(path, "config requires a netdev node, %q is %s", node, n.Driver)
		}
	}
	for i, a := range s.Setup {
		checkAction(fmt.Sprintf("/spec/setup/%d", i), a)
	}
	for i, a := range s.Teardown {
		checkAction(fmt.Sprintf("/spec/teardown/%d", i), a)
	}
	for i, a := range s.Solution.Steps {
		checkAction(fmt.Sprintf("/spec/solution/steps/%d", i), a)
	}
	if s.Exam != nil {
		for i, a := range s.Exam.Rerun {
			checkAction(fmt.Sprintf("/spec/exam/rerun/%d", i), a)
		}
	}
	altIDs := map[string]bool{}
	for i, alt := range s.Solution.Alternatives {
		path := fmt.Sprintf("/spec/solution/alternatives/%d", i)
		if altIDs[alt.ID] {
			add(path, "duplicate alternative id %q", alt.ID)
		}
		altIDs[alt.ID] = true
		for j, a := range alt.Steps {
			checkAction(fmt.Sprintf("%s/steps/%d", path, j), a)
		}
	}
	mcIDs := map[string]bool{}
	for i, m := range s.Misconceptions {
		path := fmt.Sprintf("/spec/misconceptions/%d", i)
		if mcIDs[m.ID] {
			add(path, "duplicate misconception id %q", m.ID)
		}
		mcIDs[m.ID] = true
		if m.Mutation != nil {
			checkAction(path+"/mutation", *m.Mutation)
		}
	}

	// Checks.
	clusters := map[string]bool{}
	for _, n := range s.Topology.Nodes {
		if n.Driver == labsv1.DriverK8sCluster && n.Cluster != nil {
			clusters[n.Name] = true
			clusters[n.Cluster.Context] = true
		}
	}
	checkIDs := map[string]bool{}
	for i, c := range s.Checks {
		path := fmt.Sprintf("/spec/checks/%d", i)
		if checkIDs[c.ID] {
			add(path, "duplicate check id %q", c.ID)
		}
		checkIDs[c.ID] = true
		if c.On != "" {
			node, _, _ := strings.Cut(c.On, "/")
			if nodes[node] == nil {
				add(path+"/on", "unknown node %q", c.On)
			}
		}
		if c.Query != nil && c.Query.Cluster != "" && !clusters[c.Query.Cluster] {
			add(path+"/query/cluster", "unknown cluster or context %q", c.Query.Cluster)
		}
		switch c.Type {
		case "shell", "device-cmd":
			if c.Command == "" {
				add(path, "%s check requires command", c.Type)
			}
			if c.Type == "device-cmd" && c.On != "" && nodes[c.On] != nil && nodes[c.On].Driver != labsv1.DriverNetdev {
				add(path+"/on", "device-cmd check requires a netdev node")
			}
		case "k8s-query":
			if c.Query == nil || c.Query.Resource == "" {
				add(path, "k8s-query check requires query.resource")
			}
		case "k8s-can-i":
			if c.Query == nil || c.Query.Verb == "" || c.Query.Resource == "" {
				add(path, "k8s-can-i check requires query.verb and query.resource")
			}
		case "reachability", "http":
			if c.Target == "" {
				add(path, "%s check requires target", c.Type)
			}
		}
	}

	// Mutations must name the checks they are expected to fail.
	for i, m := range s.Misconceptions {
		for j, id := range m.ExpectFail {
			if !checkIDs[id] {
				add(fmt.Sprintf("/spec/misconceptions/%d/expectFail/%d", i, j), "unknown check id %q", id)
			}
		}
	}

	issues = append(issues, validateAnswers(s, nodes)...)

	// Placeholders must reference declared params ("{{ name }}" with inner
	// whitespace and an undeclared name is literal Jinja, see literalPlaceholder).
	declared := func(n string) bool { _, ok := s.Params[n]; return ok }
	for _, ref := range placeholderRefs(s) {
		if literalPlaceholder(ref.match, ref.name, declared) {
			continue
		}
		if !declared(ref.name) {
			add(ref.path, "undefined param {{%s}}", ref.name)
		}
	}
	return issues
}

// validateAnswers checks answer checks, the answers of the solution and of
// misconceptions, and that expected answers can neither leak to the learner
// nor be shared between learners.
func validateAnswers(s *labsv1.LabTemplateSpec, nodes map[string]*labsv1.Node) []Issue {
	var issues []Issue
	add := func(path, format string, args ...any) {
		issues = append(issues, Issue{Path: path, Message: fmt.Sprintf(format, args...)})
	}
	answerChecks := map[string]bool{}
	endState := 0
	for _, c := range s.Checks {
		if c.Type == labsv1.CheckTypeAnswer {
			answerChecks[c.ID] = true
		} else {
			endState++
		}
	}
	secret := func(n string) bool { p, ok := s.Params[n]; return ok && p.Secret }
	refs := func(v string) []string {
		var out []string
		for _, m := range placeholderRe.FindAllStringSubmatch(v, -1) {
			if _, ok := s.Params[m[1]]; ok {
				out = append(out, m[1])
			}
		}
		return out
	}
	nodeOK := func(path, on string) {
		if on == "" {
			return
		}
		node, _, _ := strings.Cut(on, "/")
		if nodes[node] == nil {
			add(path, "unknown node %q", on)
		}
	}

	for i, c := range s.Checks {
		path := fmt.Sprintf("/spec/checks/%d", i)
		if c.Type != labsv1.CheckTypeAnswer {
			if c.Answer != nil {
				add(path+"/answer", "answer is only allowed on checks of type answer")
			}
			continue
		}
		a := c.Answer
		if a == nil {
			add(path, "answer check requires answer")
			continue
		}
		sources := 0
		for _, set := range []bool{a.Value != nil, len(a.Values) > 0, a.Compute != nil} {
			if set {
				sources++
			}
		}
		if sources != 1 {
			add(path+"/answer", "exactly one of value, values and compute is required")
		}
		switch a.Match {
		case labsv1.AnswerAnyOf:
			if a.Value != nil {
				add(path+"/answer/value", "any-of takes values (or compute), not value")
			}
		case labsv1.AnswerExact, labsv1.AnswerNumber, labsv1.AnswerRegex:
			if len(a.Values) > 0 {
				add(path+"/answer/values", "%s takes value (or compute), not values", a.Match)
			}
		default:
			add(path+"/answer/match", "unknown match %q", a.Match)
		}
		if a.Tolerance != "" && a.Match != labsv1.AnswerNumber {
			add(path+"/answer/tolerance", "tolerance only applies to match number")
		}
		if a.Value != nil {
			probe := placeholderRe.ReplaceAllString(*a.Value, "0")
			switch a.Match {
			case labsv1.AnswerNumber:
				if _, ok := answer.ParseNumber(probe); !ok {
					add(path+"/answer/value", "value %q is not a decimal number", *a.Value)
				}
			case labsv1.AnswerRegex:
				if _, err := regexp.Compile(probe); err != nil {
					add(path+"/answer/value", "invalid regex: %v", err)
				}
			}
		}
		// The expected value must come from the session, so answers differ
		// between learners and cannot be shared.
		if a.Compute == nil {
			vals := append([]string{}, a.Values...)
			if a.Value != nil {
				vals = append(vals, *a.Value)
			}
			used := 0
			for _, v := range vals {
				for _, n := range refs(v) {
					used++
					if !secret(n) {
						add(path+"/answer", "param %q gives the expected answer away: declare it secret: true", n)
					}
				}
			}
			if used == 0 {
				add(path+"/answer", "the expected answer must come from the session: reference a secret {{param}} or use compute")
			}
		} else {
			if strings.TrimSpace(a.Compute.Command) == "" {
				add(path+"/answer/compute/command", "compute needs a command")
			}
			nodeOK(path+"/answer/compute/on", a.Compute.On)
		}
		if a.MaxAttempts < 0 || a.Penalty < 0 || a.Points < 0 {
			add(path+"/answer", "points, maxAttempts and penalty must not be negative")
		}
	}

	// Secret params never appear in what the learner sees.
	visible := []struct{ path, text string }{{"/spec/description", s.Description}}
	for i, o := range s.Objectives {
		visible = append(visible, struct{ path, text string }{fmt.Sprintf("/spec/objectives/%d", i), o})
	}
	for i, h := range s.Hints {
		p := fmt.Sprintf("/spec/hints/%d", i)
		visible = append(visible, struct{ path, text string }{p + "/title", h.Title}, struct{ path, text string }{p + "/body", h.Body}, struct{ path, text string }{p + "/command", h.Command})
	}
	for i, c := range s.Checks {
		p := fmt.Sprintf("/spec/checks/%d", i)
		visible = append(visible, struct{ path, text string }{p + "/description", c.Description})
		if c.Answer != nil {
			visible = append(visible, struct{ path, text string }{p + "/answer/placeholder", c.Answer.Placeholder})
			for j, h := range c.Answer.Hints {
				visible = append(visible, struct{ path, text string }{fmt.Sprintf("%s/answer/hints/%d/body", p, j), h.Body})
			}
		}
	}
	for _, v := range visible {
		for _, n := range refs(v.text) {
			if secret(n) {
				add(v.path, "secret param {{%s}} must not appear in learner-visible text", n)
			}
		}
	}

	checkInputs := func(path string, in map[string]labsv1.AnswerInput) {
		ids := make([]string, 0, len(in))
		for id := range in {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			a := in[id]
			p := path + "/" + id
			if !answerChecks[id] {
				add(p, "%q is not an answer check", id)
			}
			if (a.Value != nil) == (a.Command != "") {
				add(p, "give either a value or a command")
			}
			nodeOK(p+"/on", a.On)
		}
	}

	// The solution answers every question and solves every end-state check.
	if endState > 0 && len(s.Solution.Steps) == 0 {
		add("/spec/solution/steps", "the lab has end-state checks, so the solution needs steps")
	}
	if len(answerChecks) == 0 && len(s.Solution.Steps) == 0 {
		add("/spec/solution/steps", "solution needs steps")
	}
	checkInputs("/spec/solution/answers", s.Solution.Answers)
	for _, c := range s.Checks {
		if c.Type == labsv1.CheckTypeAnswer {
			if _, ok := s.Solution.Answers[c.ID]; !ok {
				add("/spec/solution/answers", "no answer for answer check %q", c.ID)
			}
		}
	}

	for i, m := range s.Misconceptions {
		path := fmt.Sprintf("/spec/misconceptions/%d", i)
		if len(m.Answers) > 0 && m.Mutation != nil {
			add(path, "use either mutation or answers, not both")
		}
		if len(m.Answers) > 0 {
			checkInputs(path+"/answers", m.Answers)
			for j, id := range m.ExpectFail {
				if _, ok := m.Answers[id]; !ok {
					add(fmt.Sprintf("%s/expectFail/%d", path, j), "check %q gets no answer in this misconception", id)
				}
			}
		}
		if m.Mutation != nil {
			for j, id := range m.ExpectFail {
				if answerChecks[id] {
					add(fmt.Sprintf("%s/expectFail/%d", path, j), "a mutation cannot make answer check %q fail; give a wrong answer in answers instead", id)
				}
			}
		}
	}
	return issues
}

var dnsLabelRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

func hasClusterMember(c *labsv1.ClusterSpec, name string) bool {
	for _, m := range c.Nodes {
		if m.Name == name {
			return true
		}
	}
	return false
}

type placeholderRef struct{ path, name, match string }

// placeholderRefs lists every {{name}} in the spec outside source and params.
func placeholderRefs(s *labsv1.LabTemplateSpec) []placeholderRef {
	var refs []placeholderRef
	_, _ = walkStrings(s, func(path, v string) string {
		for _, m := range placeholderRe.FindAllStringSubmatch(v, -1) {
			refs = append(refs, placeholderRef{path: path, name: m[1], match: m[0]})
		}
		return v
	})
	return refs
}

// walkStrings visits (and may rewrite) every string value of a spec, except
// in .source and .params, via its JSON form. It returns the rewritten spec.
func walkStrings(s *labsv1.LabTemplateSpec, fn func(path, v string) string) (*labsv1.LabTemplateSpec, error) {
	b, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	var doc map[string]any
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, err
	}
	var walk func(path string, v any) any
	walk = func(path string, v any) any {
		switch x := v.(type) {
		case string:
			return fn(path, x)
		case map[string]any:
			keys := make([]string, 0, len(x))
			for k := range x {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				x[k] = walk(path+"/"+k, x[k])
			}
			return x
		case []any:
			for i := range x {
				x[i] = walk(fmt.Sprintf("%s/%d", path, i), x[i])
			}
			return x
		default:
			return v
		}
	}
	keys := make([]string, 0, len(doc))
	for k := range doc {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if k == "source" || k == "params" {
			continue
		}
		doc[k] = walk("/spec/"+k, doc[k])
	}
	b, err = json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	out := &labsv1.LabTemplateSpec{}
	if err := json.Unmarshal(b, out); err != nil {
		return nil, err
	}
	return out, nil
}
