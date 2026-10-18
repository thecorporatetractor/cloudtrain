package main

import (
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

func ds(name string, ready int32, args ...string) appsv1.DaemonSet {
	return appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "kube-system"},
		Spec: appsv1.DaemonSetSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: "install-cni", Command: args}},
		}}},
		Status: appsv1.DaemonSetStatus{DesiredNumberScheduled: 3, NumberReady: ready},
	}
}

func ovnController(nonPrimary bool) appsv1.Deployment {
	arg := "--non-primary-cni-mode=false"
	if nonPrimary {
		arg = "--non-primary-cni-mode=true"
	}
	return appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "kube-ovn-controller", Namespace: "kube-system"},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Name: "kube-ovn-controller", Image: "docker.io/kubeovn/kube-ovn:v1.16.13", Args: []string{"--foo", arg},
		}}}}},
		Status: appsv1.DeploymentStatus{AvailableReplicas: 1},
	}
}

func node(name, ip string, podCIDR string) corev1.Node {
	return corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: name},
		Spec:       corev1.NodeSpec{PodCIDRs: []string{podCIDR}},
		Status: corev1.NodeStatus{
			Addresses:  []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: ip}},
			Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
		},
	}
}

func managedCluster(prio string) *pfCluster {
	return &pfCluster{
		DaemonSets: []appsv1.DaemonSet{
			ds("kube-multus-ds", 3), ds("cilium", 3), ds("ovs-ovn", 3),
			ds("kube-ovn-cni", 3, "/kube-ovn/install-cni.sh", "--cni-conf-name="+prio+"-kube-ovn.conflist"),
		},
		Deployments:  []appsv1.Deployment{ovnController(true)},
		Nodes:        []corev1.Node{node("w1", "172.18.0.2", "10.32.1.0/24"), node("w2", "172.18.0.3", "10.32.2.0/24")},
		ServiceCIDRs: []string{"10.96.0.0/12"},
		Resources: map[string][]string{
			"k8s.cni.cncf.io/v1": {"network-attachment-definitions"},
			"kubeovn.io/v1":      {"vpcs", "subnets"},
		},
		Subnets: map[string]string{"ovn-default": "10.16.0.0/16", "join": "100.64.0.0/16"},
	}
}

func status(rep *pfReport, name string) string {
	for _, c := range rep.Checks {
		if c.Name == "network/"+name {
			return c.Status
		}
	}
	return ""
}

func TestPreflightManagedCluster(t *testing.T) {
	rep := &pfReport{}
	if mode := evaluateNetwork(managedCluster("90"), "auto", rep); mode != network.ModeSecondary {
		t.Fatalf("auto mode = %s", mode)
	}
	for _, name := range []string{"multus", "nad-api", "kube-ovn", "ovs-ovn", "kube-ovn-cni", "mode", "primary-cni", "cni-priority", "cidr-overlap"} {
		if got := status(rep, name); got != pfPass {
			t.Errorf("%s = %q (%+v)", name, got, rep.Checks)
		}
	}
	if rep.failed() {
		t.Error("report failed")
	}

	// Kube-OVN's default priority 01 would win over Cilium's 05 in Multus.
	rep = &pfReport{}
	evaluateNetwork(managedCluster("01"), "auto", rep)
	if status(rep, "cni-priority") != pfFail {
		t.Errorf("priority 01: %+v", rep.Checks)
	}

	// primary requested on a non-primary Kube-OVN: fail.
	rep = &pfReport{}
	if mode := evaluateNetwork(managedCluster("90"), "primary", rep); mode != network.ModePrimary || status(rep, "mode") != pfFail {
		t.Errorf("primary on non-primary Kube-OVN: %s %+v", mode, rep.Checks)
	}
}

func TestPreflightKubeOVNPrimary(t *testing.T) {
	cl := managedCluster("01")
	cl.Deployments = []appsv1.Deployment{ovnController(false)}
	cl.DaemonSets = cl.DaemonSets[:1] // Multus only (+ Kube-OVN DaemonSets below)
	cl.DaemonSets = append(cl.DaemonSets, ds("ovs-ovn", 3), ds("kube-ovn-cni", 3, "--cni-conf-name=01-kube-ovn.conflist"))
	rep := &pfReport{}
	if mode := evaluateNetwork(cl, "auto", rep); mode != network.ModePrimary {
		t.Fatalf("mode = %s", mode)
	}
	if status(rep, "cni-priority") != "" || status(rep, "primary-cni") != "" {
		t.Errorf("secondary-only checks ran in primary mode: %+v", rep.Checks)
	}
	rep = &pfReport{}
	evaluateNetwork(cl, "secondary", rep)
	if status(rep, "mode") != pfWarn {
		t.Errorf("secondary on Kube-OVN primary: %+v", rep.Checks)
	}
}

func TestPreflightMissingPieces(t *testing.T) {
	cl := &pfCluster{Resources: map[string][]string{}}
	rep := &pfReport{}
	evaluateNetwork(cl, "auto", rep)
	for _, name := range []string{"multus", "nad-api", "kube-ovn"} {
		if status(rep, name) != pfFail {
			t.Errorf("%s = %q", name, status(rep, name))
		}
	}
	old := managedCluster("90")
	old.Deployments[0].Spec.Template.Spec.Containers[0].Image = "kubeovn/kube-ovn:v1.15.4"
	rep = &pfReport{}
	evaluateNetwork(old, "auto", rep)
	if status(rep, "kube-ovn") != pfWarn {
		t.Errorf("Kube-OVN 1.15: %+v", rep.Checks)
	}
	// AWS VPC CNI without a policy engine.
	aws := managedCluster("90")
	aws.DaemonSets[1] = ds("aws-node", 3)
	rep = &pfReport{}
	evaluateNetwork(aws, "auto", rep)
	if status(rep, "primary-cni") != pfWarn {
		t.Errorf("aws-node: %+v", rep.Checks)
	}
}

func TestCIDROverlap(t *testing.T) {
	cl := managedCluster("90")
	cl.Nodes = append(cl.Nodes, node("w3", "192.168.100.7", "10.32.3.0/24"))
	cl.Subnets["legacy"] = "198.18.4.0/24"
	got := cidrOverlapChecks(cl)
	if len(got) != 1 || got[0].Status != pfFail || !strings.Contains(got[0].Message, "node w3 192.168.100.7/32 overlaps the lab subnet") ||
		!strings.Contains(got[0].Message, "Kube-OVN subnet legacy") {
		t.Errorf("overlap = %+v", got)
	}
	cl = managedCluster("90")
	cl.ServiceCIDRs = nil
	if got := cidrOverlapChecks(cl); got[0].Status != pfWarn {
		t.Errorf("no service CIDR: %+v", got)
	}
}

func TestModuleCheck(t *testing.T) {
	ok := moduleCheck("w1", "openvswitch loaded\ngeneve loaded\nvhost_net builtin\ntun loaded\nip_gre loaded\n")
	if ok.Status != pfPass || !strings.Contains(ok.Message, "5 ") {
		t.Errorf("ok = %+v", ok)
	}
	warn := moduleCheck("w1", "openvswitch loaded\ngeneve loaded\nvhost_net loaded\ntun loaded\nip_gre loadable\nsch_netem missing\n")
	if warn.Status != pfWarn || !strings.Contains(warn.Message, "lab modules not loaded: ip_gre") || !strings.Contains(warn.Message, "not in the node kernel: sch_netem") {
		t.Errorf("warn = %+v", warn)
	}
	fail := moduleCheck("w1", "openvswitch loadable\ngeneve missing\n")
	if fail.Status != pfFail || !strings.Contains(fail.Message, "openvswitch (not loaded)") {
		t.Errorf("fail = %+v", fail)
	}
	if s := moduleScript([]string{"ip_gre", "nf_conntrack"}); !strings.Contains(s, "for m in ip_gre nf_conntrack;") {
		t.Errorf("script = %s", s)
	}
}

func TestProbeNodes(t *testing.T) {
	cp := node("cp", "172.18.0.4", "10.32.0.0/24")
	cp.Spec.Taints = []corev1.Taint{{Key: "node-role.kubernetes.io/control-plane", Effect: corev1.TaintEffectNoSchedule}}
	notReady := node("w0", "172.18.0.5", "10.32.4.0/24")
	notReady.Status.Conditions[0].Status = corev1.ConditionFalse
	got := probeNodes([]corev1.Node{cp, node("w2", "a", "b"), notReady, node("w1", "a", "b"), node("w3", "a", "b")})
	if strings.Join(got, ",") != "w1,w2" {
		t.Errorf("probe nodes = %v", got)
	}
}

func TestProbeTopologyPlans(t *testing.T) {
	sess := network.Session{Namespace: "ct-preflight-x", Name: "preflight", UID: "u"}
	for _, m := range []network.Mode{network.ModePrimary, network.ModeSecondary} {
		p, err := network.BuildWith(sess, probeTopology(), network.Options{Mode: m, MTU: 1400})
		if err != nil {
			t.Fatal(err)
		}
		if len(p.Wired) != 2 || p.Links[0].Ends[1].Address.Addr().String() != "192.0.2.2" {
			t.Errorf("%s plan = %+v", m, p)
		}
	}
	if !versionAtLeast("v1.16.13", 1, 16) || versionAtLeast("v1.15.9", 1, 16) || !versionAtLeast("v2.0.0", 1, 16) || versionAtLeast("dev", 1, 16) {
		t.Error("versionAtLeast")
	}
}
