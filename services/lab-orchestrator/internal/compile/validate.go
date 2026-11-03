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

// inputNameRe is a check input's environment variable name.
var inputNameRe = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,31}$`)

// inputNamePrefixes: an input name is one of these words, or starts with one
// of them and an underscore (ANSWER_POD, IN_TOKEN). An allowlist, not a
// denylist: the variable is set for root, with the cluster-admin kubeconfig,
// in the admin sidecar, and a name a tool reads (HTTPS_PROXY, NO_PROXY,
// KUBERC, PYTHONPATH, NODE_OPTIONS, SHELLOPTS, ...) would hand it
// learner-written content. No tool reads variables with these prefixes.
var inputNamePrefixes = []string{"ANSWER", "REPORT", "MANIFEST", "IN"}

// reservedInputName: names outside the allowlist above, the _PRESENT suffix
// the grader sets itself, and the _PROXY suffix (ANSWER_HTTPS_PROXY would
// still be only an answer, but no name should look like a proxy setting).
func reservedInputName(n string) bool {
	if strings.HasSuffix(n, "_PRESENT") || strings.HasSuffix(n, "_PROXY") {
		return true
	}
	for _, p := range inputNamePrefixes {
		if n == p && p != "IN" || strings.HasPrefix(n, p+"_") && len(n) > len(p)+1 {
			return false
		}
	}
	return true
}

// learnerKubeconfigRe matches a reference to a kubeconfig the learner owns.
var learnerKubeconfigRe = regexp.MustCompile(`(/home/learner|~learner)/\.kube(/|\b)`)

// learnerHomeRe matches any way of naming the learner's home directory
// (literally, ~learner, or looked up: getent passwd learner, eval echo ~learner).
var learnerHomeRe = regexp.MustCompile(`/home/learner\b|~learner\b|getent\s+passwd\s+learner\b`)

// kubeDirRe matches a .kube directory or file path, relative or absolute
// (`.kube/config`, `$h/.kube`), but not a word that merely contains it.
var kubeDirRe = regexp.MustCompile(`(^|[\s/"'=:])\.kube(/|\b)`)

// The lint covers kubeconfigs only. Other tools that load config or plugins
// from the directory they run in (git hooks and fsmonitor, terraform/tofu
// providers, ansible.cfg and plugins, compose files) appear in about a
// hundred admin checks of the catalog that read learner projects; they run
// through the sandbox wrappers (ct-ansible run, ct-iac run: unprivileged,
// no learner-writable code paths) or read files only, so they are left to
// review rather than refused here. Exam tasks may not run checks as the
// learner at all (internal/exam taskIssues).

// kubeClientRe matches a command that can run a kubeconfig's credential
// plugin: kubectl and its kin, and the other common clients that load a
// kubeconfig (GitOps, mesh, backup, IaC and cluster tools). A command that
// only reads the file (yq, grep, cat) is not a client. kind and kn are left
// out (they are YAML keys and a common word); kubeadm loads a kubeconfig only
// with --kubeconfig, which learnerKubeconfigEnvRe catches.
var kubeClientRe = regexp.MustCompile(`\b(kubectl|kubectl-[a-z0-9-]+|kubecolor|helm|helmfile|k9s|kubens|kubectx|kubie|oc|stern|flux|argocd|istioctl|linkerd|cilium|hubble|velero|kustomize|kpt|kapp|skaffold|tilt|terraform|tofu|pulumi|clusterctl|vcluster|minikube|k3d|k3s|k0s|tkn|kubeseal|crossplane|krew|popeye|kubescape|kube-bench|trivy|telepresence)\b`)

// learnerKubeconfigEnvRe matches handing a kubeconfig under the learner's home
// to whatever runs next (KUBECONFIG=..., --kubeconfig ...), whichever client
// that is: only a Kubernetes client reads either.
var learnerKubeconfigEnvRe = regexp.MustCompile(`(KUBECONFIG\s*=|--kubeconfig[=\s])\s*["']?(/home/learner|~learner)/`)

// learnerKubeconfigUse returns the line of an admin (root) command that
// names the learner's kubeconfig when the command also runs a Kubernetes
// client anywhere ("" if not). The whole command counts, not one line:
// `export KUBECONFIG=/home/learner/.kube/config` (or `k=/home/learner/...`)
// followed by `kubectl get ns` (or `kubectl --kubeconfig $k`) loads it too.
//
// The path may also be built in pieces: `cd /home/learner && kubectl
// --kubeconfig .kube/config`, or `h=$(getent passwd learner | cut -d: -f6)`
// then `$h/.kube/config`. So a command that names the learner's home in any
// way and a .kube path anywhere counts too.
func learnerKubeconfigUse(cmd string) string {
	lines := strings.Split(cmd, "\n")
	for _, line := range lines {
		if learnerKubeconfigEnvRe.MatchString(line) {
			return strings.TrimSpace(line)
		}
	}
	if !kubeClientRe.MatchString(cmd) {
		return ""
	}
	for _, line := range lines {
		if learnerKubeconfigRe.MatchString(line) {
			return strings.TrimSpace(line)
		}
	}
	if learnerHomeRe.MatchString(cmd) {
		for _, line := range lines {
			if kubeDirRe.MatchString(line) {
				return strings.TrimSpace(line)
			}
		}
	}
	return ""
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
		if n.LearnerSudo && n.Driver != labsv1.DriverNetdev && (n.Driver != labsv1.DriverContainer || n.Name != s.Topology.Entry) {
			add(path+"/learnerSudo", "learnerSudo is only allowed on the entry node (driver container) and on netdev nodes")
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
			// A missing object reads as empty output: an expectation that
			// passes on "" for a named object is earned by deleting it.
			if c.Query != nil && c.Query.Name != "" && passesOnEmpty(c.Expect) {
				add(path+"/expect", "k8s-query on %s %q passes on empty output, so deleting the object earns it; put the name in the jsonpath ('{.metadata.name}:...') and expect it", c.Query.Resource, c.Query.Name)
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
		if c.Type != "shell" {
			if c.As != "" {
				add(path+"/as", "as is only allowed on shell checks")
			}
			if len(c.Inputs) > 0 {
				add(path+"/inputs", "inputs are only allowed on shell checks")
			}
		}
		inNames := map[string]bool{}
		for j, in := range c.Inputs {
			ip := fmt.Sprintf("%s/inputs/%d", path, j)
			switch {
			case !inputNameRe.MatchString(in.Name):
				add(ip+"/name", "input name %q must match %s", in.Name, inputNameRe)
			case reservedInputName(in.Name):
				add(ip+"/name", "input name %q is reserved", in.Name)
			case inNames[in.Name]:
				add(ip+"/name", "duplicate input name %q", in.Name)
			}
			inNames[in.Name] = true
			if !strings.HasPrefix(in.File, "/") {
				add(ip+"/file", "input file %q must be an absolute path", in.File)
			}
			on := in.On
			if on == "" {
				on = s.Topology.Entry
			}
			node, _, _ := strings.Cut(on, "/")
			switch n := nodes[node]; {
			case n == nil:
				add(ip+"/on", "unknown node %q", on)
			case n.Driver == labsv1.DriverK8sCluster && !strings.Contains(on, "/"):
				add(ip+"/on", "input files are read from a host or container, %q is a cluster API", on)
			case n.Driver != labsv1.DriverContainer || strings.Contains(on, "/"):
				// Reading as the learner anywhere else goes through the
				// learner's own ssh or kubectl config and a login shell on the
				// far side (~/.ssh/config ProxyCommand, ~/.bashrc): code the
				// learner controls, run while grading (after an exam freeze).
				// In a container the read is runuser with a clean environment
				// and /bin/sh, which runs nothing of theirs.
				add(ip+"/on", "input files are read from a container node; %q is a %s node, where reading as the learner would run the learner's own ssh or shell config", on, n.Driver)
			}
		}
		if c.Type == "shell" && c.As != labsv1.ActionAsLearner {
			if line := learnerKubeconfigUse(c.Command); line != "" {
				add(path+"/command", "runs as root with the learner's kubeconfig (%q): a credential plugin in it would run as root and forge the result. "+
					"Query the cluster from its admin sidecar (on: <cluster node>, plain kubectl) and read the learner's files with inputs, or set as: learner", line)
			}
		}
	}

	// Admin actions that can run after the learner had access (setup again
	// on reset, teardown, the exam's idempotency rerun) must not load the
	// learner's kubeconfig either.
	actionLists := []struct {
		path string
		as   []labsv1.Action
	}{{"/spec/setup", s.Setup}, {"/spec/teardown", s.Teardown}}
	if s.Exam != nil {
		actionLists = append(actionLists, struct {
			path string
			as   []labsv1.Action
		}{"/spec/exam/rerun", s.Exam.Rerun})
	}
	for _, l := range actionLists {
		for i, a := range l.as {
			if a.Run == nil || a.As == labsv1.ActionAsLearner {
				continue
			}
			if line := learnerKubeconfigUse(*a.Run); line != "" {
				add(fmt.Sprintf("%s/%d/run", l.path, i), "runs as root with the learner's kubeconfig (%q): a credential plugin in it would run as root. "+
					"Use the admin kubeconfig, or run the step as: learner", line)
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

// passesOnEmpty reports whether an expectation is met by empty output
// (grader.Match on ""). A regex that does not compile (placeholders) is
// reported elsewhere.
func passesOnEmpty(e *labsv1.Expectation) bool {
	if e == nil {
		return false
	}
	switch e.Match {
	case "exact", "", "contains":
		return e.Value == ""
	case "not_exact", "not_contains":
		return e.Value != ""
	case "regex":
		re, err := regexp.Compile(e.Value)
		return err == nil && re.MatchString("")
	}
	return false
}

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
