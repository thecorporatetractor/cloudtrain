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
)

var (
	paramNameRe   = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	placeholderRe = regexp.MustCompile(`\{\{\s*([^{}\s]*)\s*\}\}`)
)

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
		if n.Driver == labsv1.DriverK8sCluster {
			if n.Cluster == nil {
				add(path, "driver k8s-cluster requires cluster")
				continue
			}
			members := map[string]bool{}
			cps := 0
			for j, m := range n.Cluster.Nodes {
				if members[m.Name] {
					add(fmt.Sprintf("%s/cluster/nodes/%d", path, j), "duplicate cluster node %q", m.Name)
				}
				members[m.Name] = true
				if m.Role == "control-plane" {
					cps++
				}
			}
			if n.Cluster.Mode == labsv1.ClusterModeKubeadm && cps == 0 {
				add(path+"/cluster", "kubeadm cluster needs at least one control-plane node")
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

	// Placeholders must reference declared params.
	for _, ref := range placeholderRefs(s) {
		if _, ok := s.Params[ref.name]; !ok {
			add(ref.path, "undefined param {{%s}}", ref.name)
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

type placeholderRef struct{ path, name string }

// placeholderRefs lists every {{name}} in the spec outside source and params.
func placeholderRefs(s *labsv1.LabTemplateSpec) []placeholderRef {
	var refs []placeholderRef
	_, _ = walkStrings(s, func(path, v string) string {
		for _, m := range placeholderRe.FindAllStringSubmatch(v, -1) {
			refs = append(refs, placeholderRef{path: path, name: m[1]})
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
