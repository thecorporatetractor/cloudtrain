package drivers

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/api/resource"
	"sigs.k8s.io/yaml"
)

// Image kinds in the image catalog.
const (
	ImageKindContainer     = "container"
	ImageKindContainerDisk = "containerDisk"
)

// CatalogImage is one entry of deploy/images/catalog.yaml.
type CatalogImage struct {
	Kind              string   `json:"kind"`
	Image             string   `json:"image"`
	KubernetesVersion string   `json:"kubernetesVersion,omitempty"`
	StagedUpgrades    []string `json:"stagedUpgrades,omitempty"`
	// Netdev names the device family of a network-OS image (e.g. "frr");
	// informational, families match by ref (see DeviceFamily).
	Netdev string `json:"netdev,omitempty"`
	// DiskSize of a persistent root disk imported from a containerDisk
	// (default DefaultVMDiskSize); at least the image's virtual size plus
	// CDI's filesystem overhead, else the import fails with "A larger PVC is
	// required" (the catalog uses virtual size x 1.15, checked by build.sh).
	DiskSize string `json:"diskSize,omitempty"`
	// EtcdVersion and KubectlVersion are informational (written by tools/images).
	EtcdVersion    string `json:"etcdVersion,omitempty"`
	KubectlVersion string `json:"kubectlVersion,omitempty"`
	// UserNamespace marks a container image built to run in a Kubernetes user
	// namespace (tier A): the container driver sets pod hostUsers: false when
	// the cluster supports it (see userns.go).
	UserNamespace bool `json:"userNamespace,omitempty"`
	// Tier is the curriculum environment tier (A, B, C, K, V, N). With the
	// manager's sandboxes (--sandboxes, Helm orchestrator.sandboxes) it picks
	// the sandbox RuntimeClass of container nodes (see sandbox.go); otherwise
	// informational.
	Tier string `json:"tier,omitempty"`
	// Systemd marks a container image whose entrypoint is systemd (PID 1). It
	// runs privileged, and only inside a tier sandbox RuntimeClass (Kata);
	// readiness waits for systemd's boot.
	Systemd bool `json:"systemd,omitempty"`
	// Privileged marks a container image that needs a privileged container
	// (e.g. rootful dockerd). Like systemd images it runs only inside a tier
	// sandbox RuntimeClass, never privileged on the host.
	Privileged bool `json:"privileged,omitempty"`
	// VMFallback is the catalog ref of the image's KubeVirt VM twin
	// (containerDisk), e.g. ubuntu-vm:24.04 for deb-sys:24.04: with a tier
	// sandbox configured but unavailable (fallback kubevirt), the manager
	// runs the image's container nodes as that VM instead (sandbox.go).
	VMFallback string `json:"vmFallback,omitempty"`
	// Mirrors lists the in-cluster mirror services the image is configured to
	// use (informational, e.g. [dnf, apt, pypi]; see deploy/mirrors).
	Mirrors []string `json:"mirrors,omitempty"`
	// Addons lists the add-ons /opt/cloudtrain/bin/addons-install can install
	// on a kubeadm image (informational).
	Addons []string `json:"addons,omitempty"`
	// Publishable allows CI to publish the image to the public registry
	// (GHCR, .github/workflows/images.yml) and a release overlay to point at
	// it. Omitted = never published: license-restricted images (the
	// Terraform workstation, BUSL-1.1) and upstream images stay false.
	// `labctl catalog check` fails CI when the workflow publishes a name that
	// is not publishable here.
	Publishable bool `json:"publishable,omitempty"`
	// PublishAs is the published repository name when it differs from the
	// image's last path component (see PublishName).
	PublishAs string `json:"publishName,omitempty"`
}

// ImageCatalog maps the image refs used in lab.yaml (topology.nodes[].image)
// to runtime artifacts (deploy/images/catalog.yaml, kind ImageCatalog).
type ImageCatalog struct {
	APIVersion string `json:"apiVersion,omitempty"`
	Kind       string `json:"kind,omitempty"`
	// Registry prefixes unqualified catalog images (the manager's
	// --image-registry overrides it); a later file's non-empty value wins.
	Registry string `json:"registry,omitempty"`
	// Mirrors rewrite image registries (see RegistryMirror); the manager's
	// --image-mirror entries are added. Merged by From, later files win.
	Mirrors []RegistryMirror `json:"mirrors,omitempty"`
	// ImagePullSecrets are Secrets in the session namespace that lab pods and
	// VMs pull with (the manager's --image-pull-secrets are added).
	ImagePullSecrets []string                `json:"imagePullSecrets,omitempty"`
	Images           map[string]CatalogImage `json:"images"`
	WorkloadImages   []string                `json:"workloadImages,omitempty"`
}

// ParseCatalog parses one catalog document.
func ParseCatalog(data []byte) (*ImageCatalog, error) {
	c := &ImageCatalog{}
	if err := yaml.UnmarshalStrict(data, c); err != nil {
		return nil, fmt.Errorf("parse image catalog: %w", err)
	}
	if c.Kind != "" && c.Kind != "ImageCatalog" {
		return nil, fmt.Errorf("parse image catalog: kind %q, want ImageCatalog", c.Kind)
	}
	for _, m := range c.Mirrors {
		if err := m.validate(); err != nil {
			return nil, fmt.Errorf("image catalog: %w", err)
		}
	}
	for ref, img := range c.Images {
		if img.Image == "" {
			return nil, fmt.Errorf("image catalog: %s has no image", ref)
		}
		if img.Kind != ImageKindContainer && img.Kind != ImageKindContainerDisk {
			return nil, fmt.Errorf("image catalog: %s has unknown kind %q", ref, img.Kind)
		}
		if img.VMFallback != "" && img.Kind != ImageKindContainer {
			return nil, fmt.Errorf("image catalog: %s: vmFallback applies to container images only", ref)
		}
		if img.DiskSize != "" {
			q, err := resource.ParseQuantity(img.DiskSize)
			if err != nil || q.Sign() <= 0 {
				return nil, fmt.Errorf("image catalog: %s has invalid diskSize %q", ref, img.DiskSize)
			}
			if img.Kind != ImageKindContainerDisk {
				return nil, fmt.Errorf("image catalog: %s: diskSize applies to containerDisk images only", ref)
			}
		}
	}
	return c, nil
}

// LoadCatalog reads one or more catalog files (or directories) and merges
// them in order: a later file overrides entries of an earlier one, so a local
// overlay can alias or replace refs without editing the shared catalog. A
// directory contributes catalog.yaml first, then every other *.yaml in
// lexical order.
func LoadCatalog(paths ...string) (*ImageCatalog, error) {
	out := &ImageCatalog{Images: map[string]CatalogImage{}}
	var files []string
	for _, p := range paths {
		if p == "" {
			continue
		}
		st, err := os.Stat(p)
		if err != nil {
			return nil, err
		}
		if !st.IsDir() {
			files = append(files, p)
			continue
		}
		matches, err := filepath.Glob(filepath.Join(p, "*.yaml"))
		if err != nil {
			return nil, err
		}
		sort.SliceStable(matches, func(i, j int) bool {
			bi, bj := filepath.Base(matches[i]) == "catalog.yaml", filepath.Base(matches[j]) == "catalog.yaml"
			if bi != bj {
				return bi
			}
			return matches[i] < matches[j]
		})
		files = append(files, matches...)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("image catalog: no catalog file given")
	}
	for _, f := range files {
		b, err := os.ReadFile(filepath.Clean(f))
		if err != nil {
			return nil, err
		}
		c, err := ParseCatalog(b)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		out.Merge(c)
	}
	return out, nil
}

// Merge overlays o onto c.
func (c *ImageCatalog) Merge(o *ImageCatalog) {
	if c.Images == nil {
		c.Images = map[string]CatalogImage{}
	}
	for k, v := range o.Images {
		c.Images[k] = v
	}
	for _, w := range o.WorkloadImages {
		if !containsString(c.WorkloadImages, w) {
			c.WorkloadImages = append(c.WorkloadImages, w)
		}
	}
	if o.Registry != "" {
		c.Registry = o.Registry
	}
	c.Mirrors = MergeMirrors(c.Mirrors, o.Mirrors)
	for _, s := range o.ImagePullSecrets {
		if !containsString(c.ImagePullSecrets, s) {
			c.ImagePullSecrets = append(c.ImagePullSecrets, s)
		}
	}
}

// MergeMirrors adds the mirrors of b to a; an entry of b replaces the one of
// a with the same From.
func MergeMirrors(a, b []RegistryMirror) []RegistryMirror {
	out := append([]RegistryMirror(nil), a...)
	for _, m := range b {
		replaced := false
		for i := range out {
			if strings.TrimSuffix(out[i].From, "/") == strings.TrimSuffix(m.From, "/") {
				out[i], replaced = m, true
			}
		}
		if !replaced {
			out = append(out, m)
		}
	}
	return out
}

// Resolve returns the catalog entry for ref and checks its kind. An unknown
// ref or a kind mismatch is permanent (ErrUnsupported): the lab cannot run.
func (c *ImageCatalog) Resolve(ref, kind string) (CatalogImage, error) {
	if c == nil {
		return CatalogImage{}, fmt.Errorf("image %q: no image catalog loaded: %w", ref, ErrUnsupported)
	}
	img, ok := c.Images[ref]
	if !ok {
		known := make([]string, 0, len(c.Images))
		for k := range c.Images {
			known = append(known, k)
		}
		sort.Strings(known)
		return CatalogImage{}, fmt.Errorf("image %q is not in the image catalog (known: %s): %w",
			ref, strings.Join(known, ", "), ErrUnsupported)
	}
	if kind != "" && img.Kind != kind {
		return CatalogImage{}, fmt.Errorf("image %q is a %s, this node needs a %s: %w", ref, img.Kind, kind, ErrUnsupported)
	}
	return img, nil
}

// CheckVMFallbacks reports vmFallback refs that are not containerDisk entries
// of the (merged) catalog.
func (c *ImageCatalog) CheckVMFallbacks() error {
	var bad []string
	for ref, img := range c.Images {
		if img.VMFallback == "" {
			continue
		}
		if t, ok := c.Images[img.VMFallback]; !ok || t.Kind != ImageKindContainerDisk {
			bad = append(bad, fmt.Sprintf("%s: vmFallback %s is not a containerDisk in the catalog", ref, img.VMFallback))
		}
	}
	if len(bad) > 0 {
		sort.Strings(bad)
		return fmt.Errorf("image catalog: %s", strings.Join(bad, "; "))
	}
	return nil
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
