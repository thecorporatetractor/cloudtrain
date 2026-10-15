package drivers

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestOVNCentralSetVLANPassthru(t *testing.T) {
	ctx := context.Background()
	o, err := ParseOVNCentral("kube-system/app=ovn-central")
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"kube-system", "kube-system/app", "/app=x", "ns/=x"} {
		if _, err := ParseOVNCentral(bad); err == nil {
			t.Errorf("ParseOVNCentral(%q) accepted", bad)
		}
	}
	pending := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "ovn-central-a", Namespace: "kube-system", Labels: map[string]string{"app": "ovn-central"}},
		Status: corev1.PodStatus{Phase: corev1.PodPending}}
	running := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "ovn-central-b", Namespace: "kube-system", Labels: map[string]string{"app": "ovn-central"}},
		Status: corev1.PodStatus{Phase: corev1.PodRunning}}
	ex := &recordingExecutor{}
	o.Reader = fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(pending, running).Build()
	o.Executor = ex
	if err := o.SetVLANPassthru(ctx, []string{"ls-a", "ls-b"}); err != nil {
		t.Fatal(err)
	}
	want := "kube-system ovn-central-b ovn-central ovn-nbctl --no-leader-only set Logical_Switch ls-a other_config:vlan-passthru=true -- set Logical_Switch ls-b other_config:vlan-passthru=true"
	if got := strings.Join(ex.cmd, " "); got != want {
		t.Errorf("exec = %q\nwant  %q", got, want)
	}

	o.Reader = fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(pending).Build()
	if err := o.SetVLANPassthru(ctx, []string{"ls-a"}); err == nil || !strings.Contains(err.Error(), "no running ovn-central") {
		t.Errorf("without a running pod: %v", err)
	}
}
