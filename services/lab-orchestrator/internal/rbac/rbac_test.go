package rbac

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/util/yaml"
	sigsyaml "sigs.k8s.io/yaml"
)

// The generated and static RBAC of config/rbac, evaluated the way the API
// server's RBAC authorizer does (rule matching, no aggregation), against the
// operations each driver performs. TestEnvtest* checks the same against a
// real API server with the admission policy.

const configDir = "../../config/rbac"

// grants is the manager's RBAC: the cluster-wide ClusterRole, the session
// ClusterRole in lab namespaces, the leader-election Role in its own
// namespace and the ovn-central Role.
type grants struct {
	cluster, session, leader, ovn []rbacv1.PolicyRule
}

const (
	managerNS = "cloudtrain-system"
	ovnNS     = "kube-system"
)

func loadDocs(t *testing.T, file string) [][]byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(configDir, file))
	if err != nil {
		t.Fatal(err)
	}
	var out [][]byte
	r := yaml.NewYAMLReader(bufio.NewReader(bytes.NewReader(b)))
	for {
		doc, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if len(bytes.TrimSpace(doc)) > 0 && !onlyComments(doc) {
			out = append(out, doc)
		}
	}
	return out
}

func onlyComments(doc []byte) bool {
	for _, l := range strings.Split(string(doc), "\n") {
		if l = strings.TrimSpace(l); l != "" && !strings.HasPrefix(l, "#") && l != "---" {
			return false
		}
	}
	return true
}

func loadRules(t *testing.T, file, kind, name string) []rbacv1.PolicyRule {
	t.Helper()
	for _, doc := range loadDocs(t, file) {
		var obj struct {
			Kind     string `json:"kind"`
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
			Rules []rbacv1.PolicyRule `json:"rules"`
		}
		if err := sigsyaml.Unmarshal(doc, &obj); err != nil {
			t.Fatal(err)
		}
		if obj.Kind == kind && obj.Metadata.Name == name {
			return obj.Rules
		}
	}
	t.Fatalf("%s %s not in %s", kind, name, file)
	return nil
}

func load(t *testing.T) grants {
	return grants{
		cluster: loadRules(t, "role.yaml", "ClusterRole", "lab-orchestrator"),
		session: loadRules(t, "session_role.yaml", "ClusterRole", DefaultSessionClusterRole),
		leader:  loadRules(t, "leader_election_role.yaml", "Role", "lab-orchestrator-leader-election"),
		ovn:     loadRules(t, "ovn_central_role.yaml", "Role", "lab-orchestrator-ovn-central"),
	}
}

// op is one API request: ns "" = cluster-scoped or all namespaces.
type op struct {
	verb, group, resource, name, ns string
}

func (o op) String() string {
	s := o.verb + " " + o.resource
	if o.group != "" {
		s += "." + o.group
	}
	if o.name != "" {
		s += "/" + o.name
	}
	if o.ns != "" {
		s += " in " + o.ns
	} else {
		s += " (cluster)"
	}
	return s
}

func ruleAllows(r rbacv1.PolicyRule, o op) bool {
	match := func(list []string, v string) bool { return slices.Contains(list, v) || slices.Contains(list, "*") }
	if !match(r.Verbs, o.verb) || !match(r.APIGroups, o.group) || !match(r.Resources, o.resource) {
		return false
	}
	return len(r.ResourceNames) == 0 || (o.name != "" && slices.Contains(r.ResourceNames, o.name))
}

func anyAllows(rules []rbacv1.PolicyRule, o op) bool {
	for _, r := range rules {
		if ruleAllows(r, o) {
			return true
		}
	}
	return false
}

// labNamespaces are the namespaces with the lab label in these tests.
var labNamespaces = map[string]bool{"ctv-lab": true, "ct-vc-0123456789": true}

func (g grants) allows(o op) bool {
	if anyAllows(g.cluster, o) {
		return true
	}
	switch {
	case labNamespaces[o.ns]:
		return anyAllows(g.session, o)
	case o.ns == managerNS:
		return anyAllows(g.leader, o)
	case o.ns == ovnNS:
		return anyAllows(g.ovn, o)
	}
	return false
}

const (
	lab   = "ctv-lab"          // a session namespace (labctl verify, cloudtrain-sessions)
	vcNS  = "ct-vc-0123456789" // a vcluster host namespace
	other = "default"          // any namespace without the lab label
)

func crud(group, resource, ns string, verbs ...string) []op {
	if len(verbs) == 0 {
		verbs = []string{"get", "list", "watch", "create", "update", "patch", "delete"}
	}
	var out []op
	for _, v := range verbs {
		out = append(out, op{verb: v, group: group, resource: resource, ns: ns})
	}
	return out
}

// required is the inventory of what the manager does (docs/deploy.md, RBAC).
func required() map[string][]op {
	join := func(lists ...[]op) []op { return slices.Concat(lists...) }
	return map[string][]op{
		"controllers (LabSession, WarmPool, ExamSession)": join(
			crud("labs.cloudtrain.dev", "labsessions", ""),
			crud("labs.cloudtrain.dev", "labsessions/status", "", "get", "update", "patch"),
			crud("labs.cloudtrain.dev", "labsessions/finalizers", "", "update"),
			crud("labs.cloudtrain.dev", "labtemplates", "", "get", "list", "watch", "create", "delete"),
			crud("labs.cloudtrain.dev", "warmpools", "", "get", "list", "watch", "update", "patch"),
			crud("labs.cloudtrain.dev", "examsessions", "", "get", "list", "watch", "update", "patch"),
			crud("labs.cloudtrain.dev", "examtemplates", "", "get", "list", "watch"),
			// informers of Owns(Pod), Owns(Service)
			crud("", "pods", "", "list", "watch"), crud("", "services", "", "list", "watch"),
			crud("", "events", lab, "create", "patch"), crud("events.k8s.io", "events", lab, "create", "patch"),
		),
		"leader election": join(crud("coordination.k8s.io", "leases", managerNS), crud("", "events", managerNS, "create", "patch")),
		"metrics authn/authz": join(crud("authentication.k8s.io", "tokenreviews", "", "create"),
			crud("authorization.k8s.io", "subjectaccessreviews", "", "create")),
		"startup (storage preflight, user namespaces, runtime class, pod admission policy)": join(crud("storage.k8s.io", "storageclasses", "", "list"),
			crud("", "nodes", "", "get", "list"), crud("node.k8s.io", "runtimeclasses", "", "get"),
			crud("admissionregistration.k8s.io", "validatingadmissionpolicies", "", "get"),
			crud("admissionregistration.k8s.io", "validatingadmissionpolicybindings", "", "get")),
		"session access (bind the session ClusterRole)": join(crud("", "namespaces", "", "get"),
			crud("rbac.authorization.k8s.io", "rolebindings", lab, "get", "create", "update", "delete"),
			[]op{{verb: "bind", group: "rbac.authorization.k8s.io", resource: "clusterroles", name: DefaultSessionClusterRole}}),
		"container driver (entry, pods, homes)": join(
			crud("", "pods", lab, "get", "list", "create", "update", "patch", "delete", "deletecollection"),
			crud("", "pods/exec", lab, "create"), crud("", "services", lab), crud("", "secrets", lab),
			crud("", "persistentvolumeclaims", lab), crud("networking.k8s.io", "networkpolicies", lab)),
		"vm driver (KubeVirt, CDI)": join(crud("kubevirt.io", "virtualmachines", lab), crud("kubevirt.io", "virtualmachineinstances", lab),
			crud("cdi.kubevirt.io", "datavolumes", lab), crud("", "persistentvolumeclaims", lab), crud("", "secrets", lab)),
		"k8s-cluster kubeadm (VMs, PKI and kubeconfig Secrets)": join(crud("kubevirt.io", "virtualmachines", lab),
			crud("", "secrets", lab), crud("", "pods/exec", lab, "create")),
		"k8s-cluster vcluster (host namespace, Helm release, synced objects)": join(
			crud("", "namespaces", "", "get", "create", "patch", "delete"),
			crud("rbac.authorization.k8s.io", "rolebindings", vcNS, "get", "create", "update", "delete"),
			crud("", "secrets", vcNS), crud("", "configmaps", vcNS), crud("", "services", vcNS), crud("", "serviceaccounts", vcNS),
			crud("apps", "statefulsets", vcNS), crud("apps", "deployments", vcNS), crud("rbac.authorization.k8s.io", "roles", vcNS),
			crud("rbac.authorization.k8s.io", "rolebindings", vcNS), crud("networking.k8s.io", "networkpolicies", vcNS),
			crud("", "pods", vcNS, "list", "delete", "deletecollection"), crud("", "persistentvolumeclaims", vcNS),
			crud("", "endpoints", vcNS, "deletecollection"), crud("", "secrets", lab)),
		"netdev driver (FRR pods)": join(crud("", "pods", lab, "create", "delete"), crud("", "pods/exec", lab, "create")),
		"session network (Kube-OVN, Multus)": join(crud("kubeovn.io", "vpcs", "", "get", "list", "create", "update", "patch", "delete"),
			crud("kubeovn.io", "subnets", "", "get", "list", "create", "update", "patch", "delete"),
			crud("k8s.cni.cncf.io", "network-attachment-definitions", lab)),
		"vlan-passthru (ovn-central)": join(crud("", "pods", ovnNS, "list"), crud("", "pods/exec", ovnNS, "create", "get")),
	}
}

func TestRequiredOperationsAllowed(t *testing.T) {
	g := load(t)
	for what, ops := range required() {
		for _, o := range ops {
			if !g.allows(o) {
				t.Errorf("%s: %s is not allowed", what, o)
			}
		}
	}
}

func TestForbiddenOperationsDenied(t *testing.T) {
	g := load(t)
	for _, o := range []op{
		// Secrets only in lab namespaces.
		{verb: "get", resource: "secrets", ns: "kube-system"},
		{verb: "list", resource: "secrets", ns: "kube-system"},
		{verb: "list", resource: "secrets"},
		{verb: "get", resource: "secrets", ns: other},
		{verb: "get", resource: "secrets", ns: managerNS},
		// exec only in lab namespaces (and ovn-central's namespace).
		{verb: "create", resource: "pods/exec", ns: other},
		{verb: "create", resource: "pods/exec", ns: managerNS},
		{verb: "create", resource: "pods/exec"},
		{verb: "create", resource: "pods/attach", ns: "kube-system"},
		// No writes to namespaced objects outside lab namespaces.
		{verb: "create", resource: "pods", ns: other},
		{verb: "delete", resource: "pods", ns: "kube-system"},
		{verb: "create", resource: "configmaps", ns: other},
		{verb: "get", resource: "configmaps", ns: "kube-system"},
		{verb: "create", group: "apps", resource: "daemonsets", ns: lab},
		{verb: "create", group: "kubevirt.io", resource: "virtualmachines", ns: other},
		{verb: "create", group: "coordination.k8s.io", resource: "leases", ns: "kube-system"},
		{verb: "update", group: "coordination.k8s.io", resource: "leases", ns: "kube-node-lease"},
		// The admission policies are read-only to the manager: it cannot
		// loosen its own limits or the lab pod backstop.
		{verb: "update", group: "admissionregistration.k8s.io", resource: "validatingadmissionpolicies"},
		{verb: "delete", group: "admissionregistration.k8s.io", resource: "validatingadmissionpolicybindings"},
		{verb: "list", group: "admissionregistration.k8s.io", resource: "validatingadmissionpolicies"},
		// No RBAC escalation.
		{verb: "escalate", group: "rbac.authorization.k8s.io", resource: "clusterroles"},
		{verb: "escalate", group: "rbac.authorization.k8s.io", resource: "roles", ns: lab},
		{verb: "bind", group: "rbac.authorization.k8s.io", resource: "clusterroles", name: "cluster-admin"},
		{verb: "bind", group: "rbac.authorization.k8s.io", resource: "clusterroles"},
		{verb: "create", group: "rbac.authorization.k8s.io", resource: "clusterroles"},
		{verb: "create", group: "rbac.authorization.k8s.io", resource: "clusterrolebindings"},
		{verb: "create", group: "rbac.authorization.k8s.io", resource: "roles", ns: other},
		{verb: "impersonate", resource: "serviceaccounts"},
		{verb: "create", resource: "serviceaccounts/token", ns: other},
		// Cluster objects it only reads (or never touches).
		{verb: "patch", resource: "nodes"},
		{verb: "delete", resource: "nodes"},
		{verb: "update", resource: "namespaces"},
		{verb: "list", resource: "namespaces"},
		{verb: "create", group: "apiextensions.k8s.io", resource: "customresourcedefinitions"},
		{verb: "create", group: "admissionregistration.k8s.io", resource: "validatingadmissionpolicies"},
		{verb: "delete", group: "admissionregistration.k8s.io", resource: "validatingadmissionpolicybindings"},
		{verb: "create", resource: "persistentvolumes"},
		{verb: "create", group: "k8s.cni.cncf.io", resource: "network-attachment-definitions", ns: other},
	} {
		if g.allows(o) {
			t.Errorf("%s is allowed", o)
		}
	}
}

// TestNoWildcardsOrEscalation: no rule uses "*", and only the bind rule on
// the session ClusterRole names RBAC verbs beyond CRUD.
func TestNoWildcardsOrEscalation(t *testing.T) {
	g := load(t)
	for name, rules := range map[string][]rbacv1.PolicyRule{"cluster": g.cluster, "session": g.session, "leader": g.leader, "ovn": g.ovn} {
		for _, r := range rules {
			for _, l := range [][]string{r.Verbs, r.APIGroups, r.Resources} {
				if slices.Contains(l, "*") {
					t.Errorf("%s: wildcard in %+v", name, r)
				}
			}
			if slices.Contains(r.Verbs, "escalate") || slices.Contains(r.Verbs, "impersonate") {
				t.Errorf("%s: %+v", name, r)
			}
			if slices.Contains(r.Verbs, "bind") && (name != "cluster" || !slices.Equal(r.ResourceNames, []string{DefaultSessionClusterRole})) {
				t.Errorf("%s: bind must be limited to %s: %+v", name, DefaultSessionClusterRole, r)
			}
		}
	}
	for _, r := range g.cluster {
		for _, res := range r.Resources {
			if res == "secrets" || strings.HasPrefix(res, "pods/") {
				t.Errorf("cluster-wide %s: %+v", res, r)
			}
			if (res == "pods" || res == "services") && slices.ContainsFunc(r.Verbs, func(v string) bool { return v != "get" && v != "list" && v != "watch" }) {
				t.Errorf("cluster-wide writes to %s: %+v", res, r)
			}
		}
	}
}

// TestSessionRoleCoversVClusterRole: Helm creates the vcluster chart's Role
// as the manager, which without escalate must hold every rule it grants.
func TestSessionRoleCoversVClusterRole(t *testing.T) {
	g := load(t)
	b, err := os.ReadFile("testdata/vcluster-role.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var role rbacv1.Role
	if err := sigsyaml.Unmarshal(b, &role); err != nil {
		t.Fatal(err)
	}
	if len(role.Rules) == 0 {
		t.Fatal("no rules in testdata/vcluster-role.yaml")
	}
	for _, r := range role.Rules {
		for _, grp := range r.APIGroups {
			for _, res := range r.Resources {
				for _, v := range r.Verbs {
					if o := (op{verb: v, group: grp, resource: res, ns: vcNS}); !g.allows(o) {
						t.Errorf("vcluster Role grants %s, the session ClusterRole does not", o)
					}
				}
			}
		}
	}
}
