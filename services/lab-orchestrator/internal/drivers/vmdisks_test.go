package drivers

import (
	"errors"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func TestExtraDisksValidation(t *testing.T) {
	got, err := extraDisks(&labsv1.NodeResources{Disks: []string{"2Gi", "512Mi"}})
	if err != nil || len(got) != 2 || got[0] != "2Gi" || got[1] != "512Mi" {
		t.Fatalf("got %v, %v", got, err)
	}
	for _, bad := range [][]string{{"lots"}, {"1Ti"}, {"1Mi"}, {"1Gi", "1Gi", "1Gi", "1Gi", "1Gi", "1Gi", "1Gi"}} {
		if _, err := extraDisks(&labsv1.NodeResources{Disks: bad}); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("%v: want ErrUnsupported, got %v", bad, err)
		}
	}
	if got, err := extraDisks(nil); err != nil || got != nil {
		t.Fatalf("nil resources: %v %v", got, err)
	}
}

func TestBuildVMExtraDisks(t *testing.T) {
	s := &labsv1.LabSession{ObjectMeta: metav1.ObjectMeta{Name: "s", Namespace: "labs"}}
	disksOf := func(vm *unstructured.Unstructured) ([]any, []any, []any) {
		d, _, _ := unstructured.NestedSlice(vm.Object, "spec", "template", "spec", "domain", "devices", "disks")
		v, _, _ := unstructured.NestedSlice(vm.Object, "spec", "template", "spec", "volumes")
		dv, _, _ := unstructured.NestedSlice(vm.Object, "spec", "dataVolumeTemplates")
		return d, v, dv
	}
	eph := buildVM(s, NewLabNet(s), vmSpec{Name: "vm", Image: "img", CISecret: "ci", ExtraDisks: []string{"2Gi", "1Gi"}})
	d, v, dv := disksOf(eph)
	if len(d) != 4 || len(v) != 4 || len(dv) != 0 {
		t.Fatalf("ephemeral: disks %d volumes %d dvs %d", len(d), len(v), len(dv))
	}
	if d[2].(map[string]any)["serial"] != "ct-data1" {
		t.Fatalf("serial: %v", d[2])
	}
	if c := v[2].(map[string]any)["emptyDisk"].(map[string]any)["capacity"]; c != "2Gi" {
		t.Fatalf("emptyDisk capacity %v", c)
	}
	per := buildVM(s, NewLabNet(s), vmSpec{Name: "vm", Image: "img", CISecret: "ci", ExtraDisks: []string{"2Gi"},
		Disk: VMDiskOptions{Persistent: true, StorageClass: "fast"}})
	d, v, dv = disksOf(per)
	if len(d) != 3 || len(v) != 3 || len(dv) != 2 {
		t.Fatalf("persistent: disks %d volumes %d dvs %d", len(d), len(v), len(dv))
	}
	spec := dv[1].(map[string]any)["spec"].(map[string]any)
	if _, ok := spec["source"].(map[string]any)["blank"]; !ok || spec["storage"].(map[string]any)["storageClassName"] != "fast" {
		t.Fatalf("data disk DV spec %v", spec)
	}
	if v[2].(map[string]any)["dataVolume"].(map[string]any)["name"] != "vm-data1" {
		t.Fatalf("volume %v", v[2])
	}
}
