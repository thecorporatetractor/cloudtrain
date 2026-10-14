package drivers

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

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
	// (default DefaultVMDiskSize); at least the image's virtual size.
	DiskSize string `json:"diskSize,omitempty"`
	// EtcdVersion and KubectlVersion are informational (written by tools/images).
	EtcdVersion    string `json:"etcdVersion,omitempty"`
	KubectlVersion string `json:"kubectlVersion,omitempty"`
	// UserNamespace marks a container image built to run in a Kubernetes user
	// namespace (tier A): the container driver sets pod hostUsers: false when
	// the cluster supports it (see userns.go).
	UserNamespace bool `json:"userNamespace,omitempty"`
	// Tier is the curriculum environment tier (A, B, C, K, V, N); informational.
	Tier string `json:"tier,omitempty"`
	// Mirrors lists the in-cluster mirror services the image is configured to
	// use (informational, e.g. [dnf, apt, pypi]; see deploy/mirrors).
	Mirrors []string `json:"mirrors,omitempty"`
	// Addons lists the add-ons /opt/cloudtrain/bin/addons-install can install
	// on a kubeadm image (informational).
	Addons []string `json:"addons,omitempty"`
}

// ImageCatalog maps the image refs used in lab.yaml (topology.nodes[].image)
// to runtime artifacts (deploy/images/catalog.yaml, kind ImageCatalog).
type ImageCatalog struct {
	APIVersion     string                  `json:"apiVersion,omitempty"`
	Kind           string                  `json:"kind,omitempty"`
	Images         map[string]CatalogImage `json:"images"`
	WorkloadImages []string                `json:"workloadImages,omitempty"`
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
	for ref, img := range c.Images {
		if img.Image == "" {
			return nil, fmt.Errorf("image catalog: %s has no image", ref)
		}
		if img.Kind != ImageKindContainer && img.Kind != ImageKindContainerDisk {
			return nil, fmt.Errorf("image catalog: %s has unknown kind %q", ref, img.Kind)
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
		b, err := os.ReadFile(f)
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

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
