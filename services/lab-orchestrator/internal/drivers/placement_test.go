package drivers

import (
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/yaml"
)

func labPool(t *testing.T) LabPlacement {
	t.Helper()
	p, err := ParseLabPlacement("cloudtrain.dev/pool=labs", "cloudtrain.dev/labs=true:NoSchedule,kubernetes.azure.com/scalesetpriority=spot:NoSchedule,sandbox.example/kata")
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestParseLabPlacement(t *testing.T) {
	p := labPool(t)
	if p.NodeSelector["cloudtrain.dev/pool"] != "labs" || len(p.Tolerations) != 3 {
		t.Fatalf("placement = %+v", p)
	}
	want := []corev1.Toleration{
		{Key: "cloudtrain.dev/labs", Operator: corev1.TolerationOpEqual, Value: "true", Effect: corev1.TaintEffectNoSchedule},
		{Key: "kubernetes.azure.com/scalesetpriority", Operator: corev1.TolerationOpEqual, Value: "spot", Effect: corev1.TaintEffectNoSchedule},
		{Key: "sandbox.example/kata", Operator: corev1.TolerationOpExists},
	}
	for i, w := range want {
		if p.Tolerations[i] != w {
			t.Errorf("toleration %d = %+v, want %+v", i, p.Tolerations[i], w)
		}
	}
	if empty, err := ParseLabPlacement("", ""); err != nil || !empty.Empty() {
		t.Errorf("empty = %+v %v", empty, err)
	}
	for _, bad := range [][2]string{{"pool", ""}, {"=labs", ""}, {"", "k=v:Sometimes"}, {"", ":NoSchedule"}, {"bad key!=x", ""}} {
		if _, err := ParseLabPlacement(bad[0], bad[1]); err == nil {
			t.Errorf("%q must be rejected", bad)
		}
	}
}

func TestLabPlacementPods(t *testing.T) {
	d, _ := newContainerDriver(t)
	d.Placement = labPool(t)
	pod := d.BuildPod(jumphostRef())
	if pod.Spec.NodeSelector["cloudtrain.dev/pool"] != "labs" || len(pod.Spec.Tolerations) != 3 {
		t.Errorf("pod placement = %v %v", pod.Spec.NodeSelector, pod.Spec.Tolerations)
	}
	// Applying twice adds nothing; a pod's own selector key wins.
	pod.Spec.NodeSelector["cloudtrain.dev/pool"] = "special"
	d.Placement.ApplyToPod(&pod.Spec)
	if pod.Spec.NodeSelector["cloudtrain.dev/pool"] != "special" || len(pod.Spec.Tolerations) != 3 {
		t.Errorf("re-applied = %v %v", pod.Spec.NodeSelector, pod.Spec.Tolerations)
	}
	// Without a placement nothing changes.
	d.Placement = LabPlacement{}
	if p := d.BuildPod(jumphostRef()); p.Spec.NodeSelector != nil || p.Spec.Tolerations != nil {
		t.Errorf("no placement: %v %v", p.Spec.NodeSelector, p.Spec.Tolerations)
	}
}

func TestLabPlacementVMs(t *testing.T) {
	ref := jumphostRef()
	vm := buildVM(ref.Session, LabNet{}, vmSpec{Name: "vm", Hostname: "vm", Image: "img", Cores: 1, MemMiB: 512, CISecret: "ci", Placement: labPool(t)})
	spec := vm.Object["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)
	sel, _ := spec["nodeSelector"].(map[string]any)
	tols, _ := spec["tolerations"].([]any)
	if sel["cloudtrain.dev/pool"] != "labs" || len(tols) != 3 {
		t.Fatalf("vm template placement = %v %v", sel, tols)
	}
	first := tols[0].(map[string]any)
	if first["key"] != "cloudtrain.dev/labs" || first["operator"] != "Equal" || first["value"] != "true" || first["effect"] != "NoSchedule" {
		t.Errorf("toleration = %v", first)
	}
	// The domain is unchanged.
	if spec["domain"] == nil || spec["hostname"] != "vm" {
		t.Errorf("template spec = %v", spec)
	}
	none := buildVM(ref.Session, LabNet{}, vmSpec{Name: "vm", Hostname: "vm", Image: "img", Cores: 1, MemMiB: 512, CISecret: "ci"})
	ns := none.Object["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)
	if _, ok := ns["nodeSelector"]; ok {
		t.Error("no placement: nodeSelector set")
	}
	if _, ok := ns["tolerations"]; ok {
		t.Error("no placement: tolerations set")
	}
}

func TestLabPlacementVCluster(t *testing.T) {
	ref := vclusterRefForPlacement()
	d := &VClusterDriver{Container: &ContainerDriver{Placement: labPool(t)}}
	v, err := d.values(ref, VClusterRelease(ref.Session, ref.Node.Name))
	if err != nil {
		t.Fatal(err)
	}
	var vals struct {
		ControlPlane struct {
			StatefulSet struct {
				Scheduling struct {
					NodeSelector map[string]string   `json:"nodeSelector"`
					Tolerations  []corev1.Toleration `json:"tolerations"`
				} `json:"scheduling"`
			} `json:"statefulSet"`
		} `json:"controlPlane"`
		Sync struct {
			ToHost struct {
				Pods struct {
					EnforceTolerations []string `json:"enforceTolerations"`
				} `json:"pods"`
			} `json:"toHost"`
		} `json:"sync"`
	}
	if err := yaml.Unmarshal(v, &vals); err != nil {
		t.Fatal(err)
	}
	sch := vals.ControlPlane.StatefulSet.Scheduling
	if sch.NodeSelector["cloudtrain.dev/pool"] != "labs" || len(sch.Tolerations) != 3 {
		t.Errorf("control plane scheduling = %+v\n%s", sch, v)
	}
	got := strings.Join(vals.Sync.ToHost.Pods.EnforceTolerations, ",")
	if got != "cloudtrain.dev/labs=true:NoSchedule,kubernetes.azure.com/scalesetpriority=spot:NoSchedule,sandbox.example/kata" {
		t.Errorf("enforceTolerations = %q", got)
	}
	// No placement: no scheduling, no sync section.
	plain, err := (&VClusterDriver{}).values(ref, VClusterRelease(ref.Session, ref.Node.Name))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(plain), "scheduling") || strings.Contains(string(plain), "enforceTolerations") {
		t.Errorf("values without placement:\n%s", plain)
	}
}

func vclusterRefForPlacement() NodeRef {
	tpl := kubeadmTopology()
	return NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
}

// Tier V sandbox and lab pool together: synced pods keep both the
// RuntimeClass and the tolerations (one sync.toHost.pods map, not two writes).
func TestVClusterValuesSandboxAndPlacement(t *testing.T) {
	ref := vclusterRefForPlacement()
	d := &VClusterDriver{Container: &ContainerDriver{Placement: labPool(t)}}
	v, err := d.valuesFor(ref, VClusterRelease(ref.Session, ref.Node.Name), "kata-vm-isolation")
	if err != nil {
		t.Fatal(err)
	}
	var vals struct {
		Sync struct {
			ToHost struct {
				Pods struct {
					RuntimeClassName   string   `json:"runtimeClassName"`
					EnforceTolerations []string `json:"enforceTolerations"`
				} `json:"pods"`
			} `json:"toHost"`
		} `json:"sync"`
	}
	if err := yaml.Unmarshal(v, &vals); err != nil {
		t.Fatal(err)
	}
	p := vals.Sync.ToHost.Pods
	if p.RuntimeClassName != "kata-vm-isolation" || len(p.EnforceTolerations) != 3 {
		t.Errorf("synced pods = %+v\n%s", p, v)
	}
	var cp struct {
		ControlPlane struct {
			StatefulSet struct {
				RuntimeClassName string `json:"runtimeClassName"`
			} `json:"statefulSet"`
		} `json:"controlPlane"`
	}
	if err := yaml.Unmarshal(v, &cp); err != nil {
		t.Fatal(err)
	}
	if cp.ControlPlane.StatefulSet.RuntimeClassName != "kata-vm-isolation" {
		t.Errorf("control plane runtimeClassName = %q", cp.ControlPlane.StatefulSet.RuntimeClassName)
	}
}
