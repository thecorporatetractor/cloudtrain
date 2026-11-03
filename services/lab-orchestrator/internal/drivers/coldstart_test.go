package drivers

import (
	"context"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func waitingPod(reason, msg string) *corev1.Pod {
	return waitingPodSince(reason, msg, podNow().Add(-5*time.Minute))
}

// waitingPodSince: a pod scheduled at the given time, its container waiting.
func waitingPodSince(reason, msg string, scheduled time.Time) *corev1.Pod {
	return &corev1.Pod{Status: corev1.PodStatus{
		Phase:      corev1.PodPending,
		Conditions: []corev1.PodCondition{{Type: corev1.PodScheduled, Status: corev1.ConditionTrue, LastTransitionTime: metav1.NewTime(scheduled)}},
		ContainerStatuses: []corev1.ContainerStatus{{Name: ContainerName, Image: "registry.example/lab/jumphost:9",
			State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: reason, Message: msg}}}},
	}}
}

// Image pulls that cannot heal fail the node at once; registry hiccups stay
// transient (bounded by the provision timeout).
func TestPodStateImageErrors(t *testing.T) {
	cases := []struct {
		reason, msg string
		failed      bool
	}{
		{"InvalidImageName", "couldn't parse image reference", true},
		{"ErrImageNeverPull", "image not present with pull policy Never", true},
		{"ErrImagePull", `failed to pull and unpack image "x": failed to resolve reference "x": registry.example/lab/jumphost:9: not found`, true},
		{"ImagePullBackOff", `Back-off pulling image "x": manifest unknown`, true},
		{"ErrImagePull", "failed to authorize: 401 Unauthorized", true},
		{"ErrImagePull", "dial tcp 10.0.0.1:443: i/o timeout", false},
		{"ImagePullBackOff", `Back-off pulling image "x"`, false},
		{"ContainerCreating", "", false},
	}
	for _, tc := range cases {
		st, _ := podState(waitingPod(tc.reason, tc.msg))
		if got := st.Phase == labsv1.NodeFailed; got != tc.failed {
			t.Errorf("%s %q: phase %s, want failed=%v", tc.reason, tc.msg, st.Phase, tc.failed)
		}
		if tc.failed && !strings.Contains(st.Message, "jumphost:9") {
			t.Errorf("%s: message %q does not name the image", tc.reason, st.Message)
		}
	}
}

// A permanent-looking pull error on a pod that just got its node (registry
// credentials not working yet on a node the autoscaler just added, a mirror
// briefly answering 404) stays transient until it persisted; an invalid
// reference fails at once.
func TestPodStateImageErrorsPersist(t *testing.T) {
	fresh := podNow().Add(-30 * time.Second)
	for _, msg := range []string{"failed to authorize: 401 Unauthorized", "registry.example/lab/jumphost:9: not found"} {
		if st, _ := podState(waitingPodSince("ErrImagePull", msg, fresh)); st.Phase != labsv1.NodeProvisioning {
			t.Errorf("fresh pod %q: phase %s, want provisioning", msg, st.Phase)
		}
		if st, _ := podState(waitingPodSince("ErrImagePull", msg, podNow().Add(-imageErrorPersistence-time.Second))); st.Phase != labsv1.NodeFailed {
			t.Errorf("persisting %q: phase %s, want failed", msg, st.Phase)
		}
	}
	if st, _ := podState(waitingPodSince("InvalidImageName", "couldn't parse image reference", fresh)); st.Phase != labsv1.NodeFailed {
		t.Errorf("invalid image name on a fresh pod: phase %s, want failed", st.Phase)
	}
}

// A pending pod the scheduler cannot place yet is reported as waiting for
// capacity (the node autoscaler scales a lab pool up from zero).
func TestPodStateUnschedulable(t *testing.T) {
	pod := &corev1.Pod{Status: corev1.PodStatus{Phase: corev1.PodPending, Conditions: []corev1.PodCondition{{
		Type: corev1.PodScheduled, Status: corev1.ConditionFalse, Reason: corev1.PodReasonUnschedulable,
		Message: "0/3 nodes are available: 3 node(s) didn't match Pod's node affinity/selector",
	}}}}
	st, _ := podState(pod)
	if st.Phase != labsv1.NodeProvisioning || !st.Unscheduled {
		t.Fatalf("state = %+v, want provisioning and unscheduled", st)
	}
	pod.Spec.NodeName = "aks-labs-0"
	pod.Status.Conditions = nil
	if st, _ := podState(pod); st.Unscheduled {
		t.Errorf("scheduled pod reported unscheduled: %+v", st)
	}
}

// VMs whose launcher pod is unschedulable, or whose VM reports
// ErrorUnschedulable before it has an instance, wait for capacity.
func TestObserveVMIsUnschedulable(t *testing.T) {
	ctx := context.Background()
	s := testSession()
	pending := newObj(GVKVMI, s.Namespace, "a")
	_ = unstructured.SetNestedField(pending.Object, "Scheduling", "status", "phase")
	_ = unstructured.SetNestedSlice(pending.Object, []any{map[string]any{"type": "PodScheduled", "status": "False", "reason": "Unschedulable"}}, "status", "conditions")
	noVMI := vmObj(s, "b", "vm-b")
	_ = unstructured.SetNestedField(noVMI.Object, "ErrorUnschedulable", "status", "printableStatus")
	running := newObj(GVKVMI, s.Namespace, "c")
	_ = unstructured.SetNestedField(running.Object, "Running", "status", "phase")
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(pending, noVMI, running).Build()

	st, err := observeVMIs(ctx, c, s.Namespace, []string{"a", "b", "c"})
	if err != nil {
		t.Fatal(err)
	}
	if st.unscheduled != 2 || st.running != 1 {
		t.Fatalf("unscheduled %d running %d, want 2 and 1 (%v)", st.unscheduled, st.running, st.waiting)
	}
	if !strings.Contains(strings.Join(st.waiting, ","), "ErrorUnschedulable") {
		t.Errorf("waiting = %v, want the VM's printableStatus", st.waiting)
	}
}

// launcherPod: the virt-launcher pod of vmi, its compute container waiting.
func launcherPod(vmi *unstructured.Unstructured, reason, msg string, scheduled time.Time) *corev1.Pod {
	p := waitingPodSince(reason, msg, scheduled)
	p.Name, p.Namespace = "virt-launcher-"+vmi.GetName()+"-abcde", vmi.GetNamespace()
	p.Labels = map[string]string{"kubevirt.io": "virt-launcher", "kubevirt.io/created-by": string(vmi.GetUID())}
	p.Status.ContainerStatuses[0].Name = "volumecontainerdisk"
	p.Status.ContainerStatuses[0].Image = "registry.example/lab/vm-ubuntu:missing"
	return p
}

// An ephemeral VM whose containerDisk tag does not exist fails fast: its VMI
// exists (so printableStatus only says ErrImagePull), the launcher pod's
// pull error persisted. A pull error that just started, or a plain
// registry hiccup, keeps it booting.
func TestObserveVMIsContainerDiskBadTag(t *testing.T) {
	ctx := context.Background()
	s := testSession()
	vmiFor := func(name string) *unstructured.Unstructured {
		vmi := newObj(GVKVMI, s.Namespace, name)
		vmi.SetUID(types.UID("uid-" + name))
		_ = unstructured.SetNestedField(vmi.Object, "Scheduled", "status", "phase")
		return vmi
	}
	old := podNow().Add(-imageErrorPersistence - time.Minute)
	bad, fresh, flaky := vmiFor("bad"), vmiFor("fresh"), vmiFor("flaky")
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(bad, fresh, flaky,
		launcherPod(bad, "ImagePullBackOff", `Back-off pulling image "registry.example/lab/vm-ubuntu:missing": manifest unknown`, old),
		launcherPod(fresh, "ErrImagePull", "registry.example/lab/vm-ubuntu:missing: not found", podNow().Add(-10*time.Second)),
		launcherPod(flaky, "ErrImagePull", "dial tcp 10.0.0.1:443: i/o timeout", old),
	).Build()

	st, err := observeVMIs(ctx, c, s.Namespace, []string{"bad"})
	if err != nil {
		t.Fatal(err)
	}
	if f := st.failure(); !strings.Contains(f, "vm-ubuntu:missing") || !strings.Contains(f, "manifest unknown") {
		t.Fatalf("failure = %q, want the image and the registry's answer", f)
	}
	for _, name := range []string{"fresh", "flaky"} {
		st, err := observeVMIs(ctx, c, s.Namespace, []string{name})
		if err != nil {
			t.Fatal(err)
		}
		if f := st.failure(); f != "" {
			t.Errorf("%s: failure = %q, want still booting", name, f)
		}
	}
}

// A persistent VM whose root disk import from the registry names a missing
// tag (persisting) or that CDI marked Failed fails fast, with or without a
// VMI; a fresh import error does not.
func TestObserveVMIsRootDiskImportFailure(t *testing.T) {
	ctx := context.Background()
	s := testSession()
	dv := func(vm, phase, msg string, created time.Time) *unstructured.Unstructured {
		o := newObj(GVKDataVolume, s.Namespace, RootDiskName(vm))
		o.SetCreationTimestamp(metav1.NewTime(created))
		_ = unstructured.SetNestedField(o.Object, phase, "status", "phase")
		_ = unstructured.SetNestedSlice(o.Object, []any{map[string]any{"type": "Running", "status": "False", "reason": "Error", "message": msg}}, "status", "conditions")
		return o
	}
	old, recent := podNow().Add(-imageErrorPersistence-time.Minute), podNow().Add(-20*time.Second)
	tagMsg := "Unable to process data: Failed to read registry image: manifest unknown: manifest unknown"
	withVMI := newObj(GVKVMI, s.Namespace, "pending")
	_ = unstructured.SetNestedField(withVMI.Object, "Pending", "status", "phase")
	vmTag := vmObj(s, "tag", "vm-tag")
	_ = unstructured.SetNestedField(vmTag.Object, "DataVolumeError", "status", "printableStatus")
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(withVMI, vmTag,
		dv("tag", "ImportInProgress", tagMsg, old),
		dv("failed", dataVolumeFailedPhase, "Unable to connect to registry", recent),
		dv("fresh", "ImportInProgress", tagMsg, recent),
		dv("pending", "ImportInProgress", "unauthorized: authentication required", old),
	).Build()
	for name, want := range map[string]bool{"tag": true, "failed": true, "fresh": false, "pending": true} {
		st, err := observeVMIs(ctx, c, s.Namespace, []string{name})
		if err != nil {
			t.Fatal(err)
		}
		if got := st.failure() != ""; got != want {
			t.Errorf("%s: failure %q, want failed=%v", name, st.failure(), want)
		}
		if want && !strings.Contains(st.failure(), RootDiskName(name)) {
			t.Errorf("%s: failure %q does not name the disk", name, st.failure())
		}
	}
}

// A vcluster whose image will never pull fails instead of provisioning
// until the timeout; a plain back-off keeps it provisioning.
func TestVClusterObserveBadImage(t *testing.T) {
	ctx := context.Background()
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
	rel := VClusterRelease(ref.Session, ref.Node.Name)
	pod := func(msg string) *corev1.Pod {
		p := waitingPodSince("ErrImagePull", msg, podNow().Add(-imageErrorPersistence-time.Second))
		p.Name, p.Namespace = rel+"-0", VClusterNamespace(ref.Session, ref.Node.Name)
		p.Labels = map[string]string{"app": "vcluster", "release": rel}
		return p
	}
	for msg, want := range map[string]labsv1.NodePhase{
		"registry.example/vcluster:nope: not found": labsv1.NodeFailed,
		"dial tcp 10.0.0.1:443: i/o timeout":        labsv1.NodeProvisioning,
	} {
		c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(pod(msg)).Build()
		st, err := (&VClusterDriver{Client: c}).observe(ctx, ref, rel, false)
		if err != nil {
			t.Fatal(err)
		}
		if st.Phase != want {
			t.Errorf("%q: phase %s (%s), want %s", msg, st.Phase, st.Message, want)
		}
	}
}

// A container that already ran and now fails a re-pull (a :latest image on
// restart, an image removed by GC) while credentials are briefly refused is
// not failed by the hints, however long ago the pod was scheduled.
func TestPodStateImageErrorAfterRunIsTransient(t *testing.T) {
	old := podNow().Add(-time.Hour)
	for _, mut := range []func(*corev1.ContainerStatus){
		func(cs *corev1.ContainerStatus) { cs.RestartCount = 1 },
		func(cs *corev1.ContainerStatus) {
			cs.LastTerminationState.Terminated = &corev1.ContainerStateTerminated{ExitCode: 137}
		},
	} {
		p := waitingPodSince("ErrImagePull", "failed to authorize: 401 Unauthorized", old)
		p.Status.Phase = corev1.PodRunning
		mut(&p.Status.ContainerStatuses[0])
		if st, _ := podState(p); st.Phase == labsv1.NodeFailed {
			t.Errorf("re-pull after a run failed the node: %s", st.Message)
		}
	}
}

// "denied:" alone matched local "permission denied:" errors; only the
// registry's refusal counts.
func TestPodStateDeniedHint(t *testing.T) {
	old := podNow().Add(-imageErrorPersistence - time.Minute)
	if st, _ := podState(waitingPodSince("ErrImagePull", `failed to pull image "x": open /var/lib/containerd/x: permission denied: unknown`, old)); st.Phase == labsv1.NodeFailed {
		t.Errorf("permission denied failed the node: %s", st.Message)
	}
	if st, _ := podState(waitingPodSince("ErrImagePull", `pull access denied for x, repository does not exist or may require 'docker login': denied: requested access to the resource is denied`, old)); st.Phase != labsv1.NodeFailed {
		t.Errorf("registry refusal: phase %s, want failed", st.Phase)
	}
}

// A root disk import error counts from when its condition last changed,
// not from the DataVolume's creation.
func TestRootDiskFailurePersistsFromCondition(t *testing.T) {
	ctx := context.Background()
	s := testSession()
	o := newObj(GVKDataVolume, s.Namespace, RootDiskName("vm1"))
	o.SetCreationTimestamp(metav1.NewTime(podNow().Add(-time.Hour)))
	_ = unstructured.SetNestedField(o.Object, "ImportInProgress", "status", "phase")
	cond := func(ltt time.Time) {
		_ = unstructured.SetNestedSlice(o.Object, []any{map[string]any{"type": "Running", "status": "False", "reason": "Error",
			"message": "Unable to process data: unauthorized: authentication required", "lastTransitionTime": ltt.UTC().Format(time.RFC3339)}}, "status", "conditions")
	}
	cond(podNow().Add(-20 * time.Second))
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(o).Build()
	if msg, ok := rootDiskFailure(ctx, c, s.Namespace, "vm1"); ok {
		t.Errorf("fresh import error failed the disk: %s", msg)
	}
	cond(podNow().Add(-imageErrorPersistence - time.Minute))
	c = fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(o).Build()
	if _, ok := rootDiskFailure(ctx, c, s.Namespace, "vm1"); !ok {
		t.Error("persisting import error did not fail the disk")
	}
}
