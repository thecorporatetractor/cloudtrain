package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"sigs.k8s.io/yaml"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

const catalogUsage = `labctl catalog - image catalog release tooling

Usage:
  labctl catalog check --catalog F[,F] --workflow FILE [--platform a,b]
      fail when the workflow publishes an image the catalog does not mark publishable
  labctl catalog publishable --catalog F[,F] [--kind container|containerDisk]
      print the publish names of publishable entries, one per line
  labctl catalog overlay --catalog F[,F] --registry R --digests DIR [--allow-missing]
      print the release overlay: every publishable entry as R/<name>@<digest>
      (DIR holds one file per publish name with the pushed digest)
`

func cmdCatalog(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, catalogUsage)
		return 2
	}
	switch args[0] {
	case "check":
		return catalogCheck(args[1:], stdout, stderr)
	case "publishable":
		return catalogPublishable(args[1:], stdout, stderr)
	case "overlay":
		return catalogOverlay(args[1:], stdout, stderr)
	case "-h", "--help", "help":
		fmt.Fprint(stdout, catalogUsage)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown catalog command %q\n\n%s", args[0], catalogUsage)
		return 2
	}
}

func loadCatalogFlag(v string) (*drivers.ImageCatalog, error) {
	if v == "" {
		return nil, fmt.Errorf("--catalog is required")
	}
	return drivers.LoadCatalog(strings.Split(v, ",")...)
}

// workflowImages lists the image names of the images workflow's build matrix
// (jobs.build-scan.strategy.matrix.include[].name).
func workflowImages(file string) ([]string, error) {
	b, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	var wf struct {
		Jobs map[string]struct {
			Strategy struct {
				Matrix struct {
					Include []struct {
						Name string `json:"name"`
					} `json:"include"`
				} `json:"matrix"`
			} `json:"strategy"`
		} `json:"jobs"`
	}
	if err := yaml.Unmarshal(b, &wf); err != nil {
		return nil, fmt.Errorf("%s: %w", file, err)
	}
	seen := map[string]bool{}
	var out []string
	for _, j := range wf.Jobs {
		for _, inc := range j.Strategy.Matrix.Include {
			if inc.Name != "" && !seen[inc.Name] {
				seen[inc.Name] = true
				out = append(out, inc.Name)
			}
		}
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil, fmt.Errorf("%s: no matrix include names found", file)
	}
	return out, nil
}

func catalogCheck(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("catalog check", flag.ContinueOnError)
	fl.SetOutput(stderr)
	cat := fl.String("catalog", "", "catalog files, comma separated (each checked on its own)")
	wf := fl.String("workflow", "", "images workflow (.github/workflows/images.yml)")
	platform := fl.String("platform", "lab-orchestrator,gateway,web", "published platform images that are not catalog entries")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	if *cat == "" {
		fmt.Fprintln(stderr, "--catalog is required")
		return 2
	}
	var cats []*drivers.ImageCatalog
	for _, f := range strings.Split(*cat, ",") {
		c, err := drivers.LoadCatalog(f)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		cats = append(cats, c)
	}
	names, err := workflowImages(*wf)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	errs := drivers.CheckPublished(cats, names, strings.Split(*platform, ","))
	for _, e := range errs {
		fmt.Fprintln(stderr, "error:", e)
	}
	if len(errs) > 0 {
		return 1
	}
	fmt.Fprintf(stdout, "ok: %d published images, all publishable (%s)\n", len(names), strings.Join(names, ", "))
	return 0
}

func catalogPublishable(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("catalog publishable", flag.ContinueOnError)
	fl.SetOutput(stderr)
	cat := fl.String("catalog", "", "catalog files, comma separated")
	kind := fl.String("kind", "", "only this image kind (container or containerDisk)")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	c, err := loadCatalogFlag(*cat)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	seen := map[string]bool{}
	var names []string
	for _, img := range c.Images {
		if !img.Publishable || (*kind != "" && img.Kind != *kind) || seen[img.PublishName()] {
			continue
		}
		seen[img.PublishName()] = true
		names = append(names, img.PublishName())
	}
	sort.Strings(names)
	for _, n := range names {
		fmt.Fprintln(stdout, n)
	}
	return 0
}

// readDigests reads DIR/<publish name> files holding sha256 digests.
func readDigests(dir string) (map[string]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		out[e.Name()] = strings.TrimSpace(string(b))
	}
	return out, nil
}

func catalogOverlay(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("catalog overlay", flag.ContinueOnError)
	fl.SetOutput(stderr)
	cat := fl.String("catalog", "", "catalog files, comma separated (e.g. catalog.yaml plus the OpenTofu overlay for a public release)")
	registry := fl.String("registry", "", "registry the images were pushed to (e.g. ghcr.io/acme/cloudtrain)")
	digestDir := fl.String("digests", "", "directory with one file per publish name holding its digest")
	allowMissing := fl.Bool("allow-missing", false, "list publishable entries without a digest in a comment instead of failing")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	c, err := loadCatalogFlag(*cat)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if *digestDir == "" {
		fmt.Fprintln(stderr, "--digests is required")
		return 2
	}
	digests, err := readDigests(*digestDir)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	o, missing, err := drivers.ReleaseOverlay(c, *registry, digests)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(missing) > 0 && !*allowMissing {
		fmt.Fprintf(stderr, "publishable entries without a digest: %s (pass --allow-missing to keep their catalog images)\n", strings.Join(missing, ", "))
		return 1
	}
	b, err := yaml.Marshal(o)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "# Release catalog overlay (labctl catalog overlay): publishable images by digest in %s.\n", strings.TrimSuffix(*registry, "/"))
	fmt.Fprintln(stdout, "# Merged over deploy/images/catalog.yaml; a cluster pulling from its own registry keeps the")
	fmt.Fprintln(stdout, "# digests and rewrites the registry with the manager's --image-mirror (docs/deploy.md).")
	if len(missing) > 0 {
		fmt.Fprintf(stdout, "# Not published by CI (catalog image kept): %s\n", strings.Join(missing, ", "))
	}
	_, _ = stdout.Write(b)
	return 0
}
