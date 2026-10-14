package drivers

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func usernsCatalog(t *testing.T) *ImageCatalog {
	t.Helper()
	c, err := ParseCatalog([]byte(`
images:
  el-lab:10: { kind: container, image: cloudtrain/el-lab:10, userNamespace: true, tier: A }
  jumphost:1: { kind: container, image: cloudtrain/jumphost:1 }
`))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func tierARef(image string) NodeRef {
	ref := jumphostRef()
	ref.Node = labsv1.Node{Name: "host", Driver: labsv1.DriverContainer, Image: image}
	return ref
}

func TestUserNamespaceApplied(t *testing.T) {
	ctx := context.Background()
	d, c := newContainerDriver(t)
	d.Catalog, d.UserNamespaces = usernsCatalog(t), true
	ref := tierARef("el-lab:10")
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	pod := &corev1.Pod{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, pod); err != nil {
		t.Fatal(err)
	}
	if pod.Spec.HostUsers == nil || *pod.Spec.HostUsers {
		t.Fatalf("hostUsers = %v, want false", pod.Spec.HostUsers)
	}
	if pod.Annotations[AnnotationUserNamespace] != "true" {
		t.Fatalf("annotation = %q", pod.Annotations[AnnotationUserNamespace])
	}
}

func TestUserNamespaceFallbacks(t *testing.T) {
	cases := []struct {
		name, image string
		supported   bool
		privileged  bool
		wantNS      bool
		wantReason  string
	}{
		{"unsupported cluster", "el-lab:10", false, false, false, "does not support"},
		{"privileged init container", "el-lab:10", true, true, false, "privileged"},
		{"image not marked", "jumphost:1", true, false, false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := &ContainerDriver{Catalog: usernsCatalog(t), UserNamespaces: tc.supported}
			ref := tierARef(tc.image)
			pod := d.BuildPod(ref)
			if tc.privileged {
				pod.Spec.InitContainers = []corev1.Container{{Name: "i", SecurityContext: &corev1.SecurityContext{Privileged: ptr.To(true)}}}
			}
			d.applyUserNamespace(ref, pod)
			if got := pod.Spec.HostUsers != nil && !*pod.Spec.HostUsers; got != tc.wantNS {
				t.Fatalf("user namespace = %v, want %v", got, tc.wantNS)
			}
			if a := pod.Annotations[AnnotationUserNamespace]; !strings.Contains(a, tc.wantReason) || (tc.wantReason == "" && a != "") {
				t.Fatalf("annotation %q, want reason %q", a, tc.wantReason)
			}
		})
	}
}

func node(name, handler string, userns bool) *corev1.Node {
	return &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: name},
		Status: corev1.NodeStatus{RuntimeHandlers: []corev1.NodeRuntimeHandler{
			{Name: handler, Features: &corev1.NodeRuntimeHandlerFeatures{UserNamespaces: ptr.To(userns)}},
		}},
	}
}

func TestDetectUserNamespaces(t *testing.T) {
	ctx := context.Background()
	s := testScheme(t)
	kata := &nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: "kata"}, Handler: "kata-qemu"}
	cases := []struct {
		name string
		objs []client.Object
		rc   string
		want bool
	}{
		{"all nodes support default handler", []client.Object{node("a", "", true), node("b", "", true)}, "", true},
		{"one node lacks support", []client.Object{node("a", "", true), node("b", "", false)}, "", false},
		{"runtime class handler unsupported", []client.Object{node("a", "", true), kata}, "kata", false},
		{"runtime class handler supported", []client.Object{node("a", "kata-qemu", true), kata}, "kata", true},
		{"missing runtime class", []client.Object{node("a", "", true)}, "kata", false},
		{"no nodes", nil, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := fake.NewClientBuilder().WithScheme(s).WithObjects(tc.objs...).Build()
			got, why := DetectUserNamespaces(ctx, c, tc.rc)
			if got != tc.want {
				t.Fatalf("got %v (%s), want %v", got, why, tc.want)
			}
		})
	}
}
