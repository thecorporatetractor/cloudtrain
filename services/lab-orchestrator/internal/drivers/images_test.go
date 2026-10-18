package drivers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

const ghcr = "ghcr.io/acme/cloudtrain"

func TestResolveImage(t *testing.T) {
	mirrors := []RegistryMirror{
		{From: ghcr, To: "acme.azurecr.io/cloudtrain"},
		{From: "docker.io", To: "mirror.gcr.io"},
		{From: "docker.io/library/busybox", To: "harbor.example.com/hub/busybox"},
	}
	for _, tc := range []struct {
		registry string
		mirrors  []RegistryMirror
		in, want string
	}{
		{"", nil, "cloudtrain/jumphost:1", "cloudtrain/jumphost:1"},
		{"reg.example/images/", nil, "jumphost:1", "reg.example/images/jumphost:1"},
		{"reg.example/images", nil, "ghcr.io/x/y:1", "ghcr.io/x/y:1"},
		{"reg.example/images", nil, "localhost/y:1", "localhost/y:1"},
		// Release overlay refs by digest move to the cluster's registry, digest kept.
		{"", mirrors, ghcr + "/jumphost@sha256:" + strings.Repeat("a", 64), "acme.azurecr.io/cloudtrain/jumphost@sha256:" + strings.Repeat("a", 64)},
		// A path boundary: ghcr.io/acme/cloudtrain-other is not under the mirror.
		{"", mirrors, "ghcr.io/acme/cloudtrain-other/x:1", "ghcr.io/acme/cloudtrain-other/x:1"},
		// Unqualified refs are docker.io refs for mirroring; the longest From wins.
		{"", mirrors, "motoserver/moto:5.2.3", "mirror.gcr.io/motoserver/moto:5.2.3"},
		{"", mirrors, "redis:7.4-alpine", "mirror.gcr.io/library/redis:7.4-alpine"},
		{"", mirrors, "busybox:1.37", "harbor.example.com/hub/busybox:1.37"},
		{"", mirrors, "docker.io/library/busybox:1.37", "harbor.example.com/hub/busybox:1.37"},
		// The registry prefix applies first; the prefixed ref can be mirrored too.
		{"ghcr.io/acme/cloudtrain", mirrors, "jumphost:1", "acme.azurecr.io/cloudtrain/jumphost:1"},
	} {
		if got := ResolveImage(tc.registry, tc.mirrors, tc.in); got != tc.want {
			t.Errorf("ResolveImage(%q, %v, %q) = %q, want %q", tc.registry, tc.mirrors, tc.in, got, tc.want)
		}
	}
}

func TestParseRegistryMirrors(t *testing.T) {
	got, err := ParseRegistryMirrors(" ghcr.io/acme/cloudtrain=acme.azurecr.io/cloudtrain , docker.io=mirror.gcr.io ")
	if err != nil || len(got) != 2 || got[1] != (RegistryMirror{From: "docker.io", To: "mirror.gcr.io"}) {
		t.Fatalf("got %v, %v", got, err)
	}
	if got, err := ParseRegistryMirrors(""); err != nil || got != nil {
		t.Fatalf("empty: %v %v", got, err)
	}
	for _, bad := range []string{"ghcr.io", "a=", "https://ghcr.io=x.io", "ghcr.io/x:1=y.io", "ghcr.io/x@sha256:1=y.io"} {
		if _, err := ParseRegistryMirrors(bad); err == nil {
			t.Errorf("%q: want an error", bad)
		}
	}
}

func TestCatalogMergeRegistrySettings(t *testing.T) {
	base, err := ParseCatalog([]byte(`
registry: reg.a
mirrors: [{from: docker.io, to: mirror.gcr.io}]
imagePullSecrets: [ghcr-pull]
images:
  x:1: {kind: container, image: x:1}
`))
	if err != nil {
		t.Fatal(err)
	}
	over, err := ParseCatalog([]byte(`
registry: reg.b
mirrors: [{from: docker.io, to: hub.example.com}, {from: ghcr.io/acme, to: acr.example.com/acme}]
imagePullSecrets: [ghcr-pull, harbor-pull]
images: {}
`))
	if err != nil {
		t.Fatal(err)
	}
	base.Merge(over)
	if base.Registry != "reg.b" || len(base.Mirrors) != 2 || base.Mirrors[0].To != "hub.example.com" || strings.Join(base.ImagePullSecrets, ",") != "ghcr-pull,harbor-pull" {
		t.Fatalf("merged: %+v", base)
	}
	if _, err := ParseCatalog([]byte("mirrors: [{from: 'https://x', to: y}]\nimages: {}\n")); err == nil {
		t.Fatal("invalid mirror accepted")
	}
}

func TestPublishName(t *testing.T) {
	for in, want := range map[CatalogImage]string{
		{Image: "cloudtrain/jumphost:1"}:                            "jumphost",
		{Image: "cloudtrain/kubeadm-node:v1.37.1"}:                  "kubeadm-node",
		{Image: "ghcr.io/a/b/c@sha256:00"}:                          "c",
		{Image: "cloudtrain/iac-ws:1.15", PublishAs: "iac-ws-tofu"}: "iac-ws-tofu",
		{Image: "busybox"}:                                          "busybox",
	} {
		if got := in.PublishName(); got != want {
			t.Errorf("%+v: %q, want %q", in, got, want)
		}
	}
}

func TestReleaseOverlay(t *testing.T) {
	c := &ImageCatalog{Images: map[string]CatalogImage{
		"jumphost:1":   {Kind: ImageKindContainer, Image: "cloudtrain/jumphost:1", Publishable: true, KubectlVersion: "v1.37.1"},
		"terraform-ws": {Kind: ImageKindContainer, Image: "cloudtrain/iac-ws:1.15-terraform"},
		"kubeadm:1.37": {Kind: ImageKindContainerDisk, Image: "cloudtrain/kubeadm-node:v1.37.1", Publishable: true, PublishAs: "kubeadm-node-v1.37"},
	}}
	d := "sha256:" + strings.Repeat("b", 64)
	o, missing, err := ReleaseOverlay(c, ghcr+"/", map[string]string{"jumphost": d})
	if err != nil {
		t.Fatal(err)
	}
	if got := o.Images["jumphost:1"]; got.Image != ghcr+"/jumphost@"+d || got.KubectlVersion != "v1.37.1" {
		t.Fatalf("jumphost: %+v", got)
	}
	if _, ok := o.Images["terraform-ws"]; ok {
		t.Fatal("a non-publishable entry is in the overlay")
	}
	if len(missing) != 1 || missing[0] != "kubeadm:1.37" {
		t.Fatalf("missing: %v", missing)
	}
	if _, _, err := ReleaseOverlay(c, ghcr, map[string]string{"jumphost": "latest"}); err == nil {
		t.Fatal("a non-digest was accepted")
	}
	if _, _, err := ReleaseOverlay(c, "", nil); err == nil {
		t.Fatal("no registry was accepted")
	}
}

// The repository's catalog and images workflow: everything CI publishes is
// publishable, and the Terraform workstation is not.
func TestRepoCatalogPublishing(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	base, err := LoadCatalog(filepath.Join(root, "deploy", "images", "catalog.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	tofu, err := LoadCatalog(filepath.Join(root, "deploy", "images", "overlays", "iac-opentofu.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if base.Images["terraform-ws:1.15"].Publishable {
		t.Fatal("terraform-ws:1.15 (BUSL-1.1) must not be publishable")
	}
	if !tofu.Images["terraform-ws:1.15"].Publishable || tofu.Images["terraform-ws:1.15"].PublishName() != "iac-ws-tofu" {
		t.Fatal("the OpenTofu flavour must be publishable as iac-ws-tofu")
	}
	cats := []*ImageCatalog{base, tofu}
	platform := []string{"lab-orchestrator", "gateway", "web"}
	if errs := CheckPublished(cats, []string{"jumphost", "iac-ws-tofu", "gateway"}, platform); len(errs) != 0 {
		t.Fatalf("unexpected: %v", errs)
	}
	errs := CheckPublished(cats, []string{"iac-ws", "unknown-image"}, platform)
	if len(errs) != 2 || !strings.Contains(errs[0], "iac-ws is published, but catalog terraform-ws:1.15 is not publishable") || !strings.Contains(errs[1], "unknown-image") {
		t.Fatalf("errs: %v", errs)
	}
	if _, err := os.Stat(filepath.Join(root, ".github", "workflows", "images.yml")); err != nil {
		t.Fatal(err)
	}
}

func TestPullSecretsOnPodsAndVMs(t *testing.T) {
	d := &ContainerDriver{ImagePullSecrets: []string{"ghcr-pull", "harbor-pull"}, ImageMirrors: []RegistryMirror{{From: "docker.io", To: "mirror.gcr.io"}}}
	s := testSession()
	pod := d.BuildPod(NodeRef{Session: s, Node: labsv1.Node{Name: "ws", Image: "busybox:1.37"}, Template: &labsv1.LabTemplateSpec{}})
	if len(pod.Spec.ImagePullSecrets) != 2 || pod.Spec.ImagePullSecrets[0].Name != "ghcr-pull" {
		t.Fatalf("pull secrets: %v", pod.Spec.ImagePullSecrets)
	}
	if got := pod.Spec.Containers[0].Image; got != "mirror.gcr.io/library/busybox:1.37" {
		t.Fatalf("image: %s", got)
	}
	vm := buildVM(s, NewLabNet(s), vmSpec{Name: "vm", Image: "x/y:1", CISecret: "ci", PullSecret: d.vmPullSecret()})
	vols, _, _ := unstructured.NestedSlice(vm.Object, "spec", "template", "spec", "volumes")
	if ps, _, _ := unstructured.NestedString(vols[0].(map[string]any), "containerDisk", "imagePullSecret"); ps != "ghcr-pull" {
		t.Fatalf("containerDisk: %v", vols[0])
	}
	plain := buildVM(s, NewLabNet(s), vmSpec{Name: "vm", Image: "x/y:1", CISecret: "ci"})
	vols, _, _ = unstructured.NestedSlice(plain.Object, "spec", "template", "spec", "volumes")
	if _, ok, _ := unstructured.NestedString(vols[0].(map[string]any), "containerDisk", "imagePullSecret"); ok {
		t.Fatalf("containerDisk without a secret: %v", vols[0])
	}
	if (&ContainerDriver{}).vmPullSecret() != "" || (*ContainerDriver)(nil).vmPullSecret() != "" {
		t.Fatal("no secret configured: want none")
	}
}
