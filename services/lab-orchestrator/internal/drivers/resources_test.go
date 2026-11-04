package drivers

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/utils/ptr"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func qty(l corev1.ResourceList, n corev1.ResourceName) string {
	q, ok := l[n]
	if !ok {
		return ""
	}
	return q.String()
}

func TestNodeResourceDefaults(t *testing.T) {
	cpu := resource.MustParse("500m")
	cases := []struct {
		name   string
		driver labsv1.DriverName
		res    *labsv1.NodeResources
		reqCPU string
		limCPU string
		reqMem string
		limMem string
		reqEph string
		limEph string
	}{
		{"container without resources: Burstable defaults", labsv1.DriverContainer, nil, "100m", "", "256Mi", "2Gi", "256Mi", "8Gi"},
		{"netdev without resources", labsv1.DriverNetdev, nil, "50m", "", "128Mi", "512Mi", "64Mi", "1Gi"},
		{"declared cpu and memory: request = limit", labsv1.DriverContainer, &labsv1.NodeResources{CPU: &cpu, MemoryMiB: ptr.To[int64](512)}, "500m", "500m", "512Mi", "512Mi", "256Mi", "8Gi"},
		{"declared memory only: default cpu request", labsv1.DriverContainer, &labsv1.NodeResources{MemoryMiB: ptr.To[int64](128)}, "100m", "", "128Mi", "128Mi", "256Mi", "8Gi"},
		{"declared cpu only: default memory", labsv1.DriverNetdev, &labsv1.NodeResources{CPU: &cpu}, "500m", "500m", "128Mi", "512Mi", "64Mi", "1Gi"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := nodeResources(tc.driver, tc.res)
			got := []string{qty(r.Requests, corev1.ResourceCPU), qty(r.Limits, corev1.ResourceCPU), qty(r.Requests, corev1.ResourceMemory), qty(r.Limits, corev1.ResourceMemory),
				qty(r.Requests, corev1.ResourceEphemeralStorage), qty(r.Limits, corev1.ResourceEphemeralStorage)}
			want := []string{tc.reqCPU, tc.limCPU, tc.reqMem, tc.limMem, tc.reqEph, tc.limEph}
			for i := range want {
				if got[i] != want[i] {
					t.Errorf("got %v, want %v", got, want)
					break
				}
			}
		})
	}
}

// No lab pod is BestEffort, whatever its lab declares.
func TestLabPodsNeverBestEffort(t *testing.T) {
	d, _ := newContainerDriver(t)
	ref := jumphostRef()
	ref.Node.Resources = nil
	pod := d.BuildPod(ref)
	r := pod.Spec.Containers[0].Resources
	if len(r.Requests) == 0 || len(r.Limits) == 0 {
		t.Fatalf("resources = %+v", r)
	}
	if _, ok := r.Limits[corev1.ResourceMemory]; !ok {
		t.Error("no memory limit")
	}
}

func TestVMCPULimit(t *testing.T) {
	ref := jumphostRef()
	vm := buildVM(ref.Session, LabNet{}, vmSpec{Name: "vm", Hostname: "vm", Image: "img", Cores: 2, MemMiB: 2048, CISecret: "ci"})
	res := vm.Object["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)["domain"].(map[string]any)["resources"].(map[string]any)
	req := res["requests"].(map[string]any)
	lim := res["limits"].(map[string]any)
	if req["memory"] != "2048Mi" || req["cpu"] != "200m" || lim["cpu"] != "2" {
		t.Errorf("vm resources = %v", res)
	}
	if _, ok := lim["memory"]; ok {
		t.Error("no memory limit on VMs: KubeVirt adds its overhead to the request only")
	}
}
