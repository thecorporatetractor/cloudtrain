package drivers

import (
	"context"
	"testing"

	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func scs(def bool, names ...string) *fake.ClientBuilder {
	s := runtime.NewScheme()
	_ = storagev1.AddToScheme(s)
	b := fake.NewClientBuilder().WithScheme(s)
	for i, n := range names {
		sc := &storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: n}, Provisioner: "x"}
		if def && i == 0 {
			sc.Annotations = map[string]string{"storageclass.kubernetes.io/is-default-class": "true"}
		}
		b = b.WithObjects(sc)
	}
	return b
}

func TestCheckStorage(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name       string
		def        bool
		classes    []string
		cfg        map[string]string
		fatal, any int
	}{
		{"default exists, none configured", true, []string{"standard"}, map[string]string{"cluster": ""}, 0, 0},
		{"no default, none configured warns", false, []string{"standard"}, map[string]string{"cluster": ""}, 0, 1},
		{"configured exists", false, []string{"gp3"}, map[string]string{"cluster": "gp3"}, 0, 0},
		{"configured missing is fatal", true, []string{"standard"}, map[string]string{"vm disks": "managed-csi"}, 1, 1},
		{"vm disks named, homes on missing default", false, []string{"fast"}, map[string]string{"vm disks": "fast", "homes": ""}, 0, 1},
	}
	for _, c := range cases {
		got := CheckStorage(ctx, scs(c.def, c.classes...).Build(), c.cfg)
		fatal := 0
		for _, f := range got {
			if f.Fatal {
				fatal++
			}
		}
		if fatal != c.fatal || len(got) != c.any {
			t.Errorf("%s: fatal %d total %d, want %d/%d: %v", c.name, fatal, len(got), c.fatal, c.any, got)
		}
	}
}

func TestStorageHelpers(t *testing.T) {
	if !ValidVolumeMode("") || !ValidVolumeMode("Block") || ValidVolumeMode("block") {
		t.Fatal("volume mode validation")
	}
	if !ValidAccessModes(SplitList("ReadWriteOnce, ReadWriteMany")) || ValidAccessModes([]string{"RWO"}) {
		t.Fatal("access mode validation")
	}
}

func TestDVStorageDefaultsFollowCluster(t *testing.T) {
	d := VMDiskOptions{}.dvStorage("11Gi")
	if _, ok := d["storageClassName"]; ok {
		t.Fatal("empty class must be omitted (cluster default)")
	}
	if _, ok := d["volumeMode"]; ok {
		t.Fatal("empty volume mode must be omitted (CDI StorageProfile decides)")
	}
	if m := d["accessModes"].([]any); len(m) != 1 || m[0] != "ReadWriteOnce" {
		t.Fatalf("access modes %v", m)
	}
	d = VMDiskOptions{StorageClass: "gp3", VolumeMode: "Block", AccessModes: []string{"ReadWriteMany"}}.dvStorage("5Gi")
	if d["storageClassName"] != "gp3" || d["volumeMode"] != "Block" || d["accessModes"].([]any)[0] != "ReadWriteMany" {
		t.Fatalf("explicit settings lost: %v", d)
	}
}

func TestRuntimeStorageClassPrecedence(t *testing.T) {
	rt, err := NewRuntime(RuntimeOptions{StorageClass: "base", HomeStorageClass: "homes",
		VMDisks: VMDiskOptions{Persistent: true}})
	if err != nil {
		t.Fatal(err)
	}
	if rt.Container.HomeStorageClass != "homes" {
		t.Fatalf("home class %q", rt.Container.HomeStorageClass)
	}
	vmd, _ := rt.Registry.Get(labsv1.DriverVM)
	if c := vmd.(*VMDriver).Disks.StorageClass; c != "base" {
		t.Fatalf("VM disks fall back to --storage-class, got %q", c)
	}
	cd, _ := rt.Registry.Get(labsv1.DriverK8sCluster)
	if c := cd.(*ClusterDriver).Virtual.(*VClusterDriver).StorageClass; c != "homes" {
		t.Fatalf("vcluster class follows the home class, got %q", c)
	}
	rt, _ = NewRuntime(RuntimeOptions{StorageClass: "base", VMDisks: VMDiskOptions{StorageClass: "disks"}})
	if rt.Container.HomeStorageClass != "base" {
		t.Fatalf("home class falls back to the default, got %q", rt.Container.HomeStorageClass)
	}
	vmd, _ = rt.Registry.Get(labsv1.DriverVM)
	if c := vmd.(*VMDriver).Disks.StorageClass; c != "disks" {
		t.Fatalf("--vm-disk-storage-class overrides --storage-class, got %q", c)
	}
}

// The persistent root and data disk DataVolumes leave volumeMode and class to
// the cluster unless configured (they used to force Filesystem).
func TestBuildVMDiskStorageFollowsCluster(t *testing.T) {
	s := &labsv1.LabSession{ObjectMeta: metav1.ObjectMeta{Name: "s", Namespace: "labs"}}
	vm := buildVM(s, NewLabNet(s), vmSpec{Name: "vm", Image: "img", CISecret: "ci", ExtraDisks: []string{"2Gi"},
		Disk: VMDiskOptions{Persistent: true}})
	dvs, _, _ := unstructured.NestedSlice(vm.Object, "spec", "dataVolumeTemplates")
	if len(dvs) != 2 {
		t.Fatalf("dvs %d", len(dvs))
	}
	for _, dv := range dvs {
		st := dv.(map[string]any)["spec"].(map[string]any)["storage"].(map[string]any)
		if _, ok := st["volumeMode"]; ok {
			t.Fatalf("volumeMode set: %v", st)
		}
		if _, ok := st["storageClassName"]; ok {
			t.Fatalf("storageClassName set: %v", st)
		}
	}
}
