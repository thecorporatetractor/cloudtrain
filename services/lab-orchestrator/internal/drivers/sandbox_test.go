package drivers

import (
	"context"
	"errors"
	"testing"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func sandboxCatalog(t *testing.T) *ImageCatalog {
	t.Helper()
	c, err := ParseCatalog([]byte(`
images:
  deb-sys:24.04: { kind: container, image: cloudtrain/deb-sys:24.04, tier: B, systemd: true }
  deb-tools:1: { kind: container, image: cloudtrain/deb-tools:1, tier: B }
  el-lab:10: { kind: container, image: cloudtrain/el-lab:10, tier: A, userNamespace: true }
`))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestParseTierRuntimeClasses(t *testing.T) {
	m, err := ParseTierRuntimeClasses(" B=kata-clh , A=gvisor")
	if err != nil || m["B"] != "kata-clh" || m["A"] != "gvisor" || len(m) != 2 {
		t.Fatalf("got %v, %v", m, err)
	}
	if m, err := ParseTierRuntimeClasses(""); err != nil || len(m) != 0 {
		t.Fatalf("empty: %v, %v", m, err)
	}
	for _, bad := range []string{"B", "B=", "=kata", "B=a,B=b"} {
		if _, err := ParseTierRuntimeClasses(bad); err == nil {
			t.Errorf("%q: want error", bad)
		}
	}
}

func TestApplySandbox(t *testing.T) {
	cases := []struct {
		name, image string
		tiers       map[string]string
		wantRC      string
		wantPriv    bool
		wantErr     bool
	}{
		{"off: plain image unchanged", "deb-tools:1", nil, "", false, false},
		{"off: systemd image refused", "deb-sys:24.04", nil, "", false, true},
		{"tier B plain image", "deb-tools:1", map[string]string{"B": "kata-clh"}, "kata-clh", false, false},
		{"tier B systemd image privileged in the sandbox", "deb-sys:24.04", map[string]string{"B": "kata-clh"}, "kata-clh", true, false},
		{"tier A not mapped", "el-lab:10", map[string]string{"B": "kata-clh"}, "", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &ContainerDriver{Catalog: sandboxCatalog(t), TierRuntimeClasses: tc.tiers}
			ref := tierARef(tc.image)
			pod := d.BuildPod(ref)
			err := d.applySandbox(ref, pod)
			if tc.wantErr {
				if !errors.Is(err, ErrUnsupported) {
					t.Fatalf("err = %v, want ErrUnsupported", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			got := ""
			if pod.Spec.RuntimeClassName != nil {
				got = *pod.Spec.RuntimeClassName
			}
			if got != tc.wantRC {
				t.Fatalf("runtimeClassName = %q, want %q", got, tc.wantRC)
			}
			if podHasPrivileged(pod) != tc.wantPriv {
				t.Fatalf("privileged = %v, want %v", podHasPrivileged(pod), tc.wantPriv)
			}
		})
	}
}

func TestDetectTierRuntimeClasses(t *testing.T) {
	kata := &nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: "kata-clh"}, Handler: "kata-clh",
		Scheduling: &nodev1.Scheduling{NodeSelector: map[string]string{"katacontainers.io/kata-runtime": "true"}}}
	gvisor := &nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: "gvisor"}, Handler: "runsc",
		Scheduling: &nodev1.Scheduling{NodeSelector: map[string]string{"sandbox.gke.io/runtime": "gvisor"}}}
	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "w1", Labels: map[string]string{"katacontainers.io/kata-runtime": "true"}}}
	c := fake.NewClientBuilder().WithScheme(scheme.Scheme).WithObjects(kata, gvisor, node).Build()
	ok, dropped := DetectTierRuntimeClasses(context.Background(), c, map[string]string{"B": "kata-clh", "A": "gvisor", "C": "missing"})
	if ok["B"] != "kata-clh" || len(ok) != 1 {
		t.Fatalf("ok = %v", ok)
	}
	if dropped["A"] == "" || dropped["C"] == "" || len(dropped) != 2 {
		t.Fatalf("dropped = %v", dropped)
	}
	if FormatTiers(ok) != "B=kata-clh" {
		t.Fatalf("FormatTiers = %q", FormatTiers(ok))
	}
}
