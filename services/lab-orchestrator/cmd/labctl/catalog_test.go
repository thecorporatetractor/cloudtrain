package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

const (
	repoCatalog = "../../../../deploy/images/catalog.yaml"
	repoTofu    = "../../../../deploy/images/overlays/iac-opentofu.yaml"
	repoImages  = "../../../../.github/workflows/images.yml"
)

func TestCatalogCheckRepo(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run([]string{"catalog", "check", "--catalog", repoCatalog + "," + repoTofu, "--workflow", repoImages}, &out, &errb); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	if !strings.Contains(out.String(), "iac-ws-tofu") {
		t.Fatalf("out: %s", out.String())
	}
}

func TestCatalogCheckRefusesTerraform(t *testing.T) {
	dir := t.TempDir()
	wf := filepath.Join(dir, "images.yml")
	if err := os.WriteFile(wf, []byte("jobs:\n  build-scan:\n    strategy:\n      matrix:\n        include:\n          - name: jumphost\n          - name: iac-ws\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	var out, errb bytes.Buffer
	if code := run([]string{"catalog", "check", "--catalog", repoCatalog + "," + repoTofu, "--workflow", wf}, &out, &errb); code != 1 {
		t.Fatalf("exit %d, want 1: %s", code, errb.String())
	}
	if !strings.Contains(errb.String(), "iac-ws is published, but catalog terraform-ws:1.15 is not publishable") {
		t.Fatalf("stderr: %s", errb.String())
	}
}

func TestCatalogOverlay(t *testing.T) {
	dir := t.TempDir()
	d := "sha256:" + strings.Repeat("c", 64)
	for _, n := range []string{"jumphost", "iac-ws-tofu"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte(d+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	args := []string{"catalog", "overlay", "--catalog", repoCatalog + "," + repoTofu, "--registry", "ghcr.io/acme/cloudtrain", "--digests", dir}
	var out, errb bytes.Buffer
	if code := run(args, &out, &errb); code != 1 || !strings.Contains(errb.String(), "without a digest") {
		t.Fatalf("missing digests must fail without --allow-missing: exit %d %s", code, errb.String())
	}
	out.Reset()
	errb.Reset()
	if code := run(append(args, "--allow-missing"), &out, &errb); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	f := filepath.Join(dir, "overlay.yaml")
	if err := os.WriteFile(f, out.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	o, err := drivers.LoadCatalog(repoCatalog, f)
	if err != nil {
		t.Fatalf("overlay does not load over the catalog: %v\n%s", err, out.String())
	}
	if got := o.Images["jumphost:1"].Image; got != "ghcr.io/acme/cloudtrain/jumphost@"+d {
		t.Errorf("jumphost:1 = %s", got)
	}
	// Terraform is never published: the public release runs the OpenTofu flavour.
	if got := o.Images["terraform-ws:1.15"].Image; got != "ghcr.io/acme/cloudtrain/iac-ws-tofu@"+d {
		t.Errorf("terraform-ws:1.15 = %s", got)
	}
	if got := o.Images["moto:5"].Image; !strings.HasPrefix(got, "motoserver/moto:") {
		t.Errorf("moto:5 (upstream) = %s", got)
	}
	if !strings.Contains(out.String(), "# Not published by CI") {
		t.Errorf("no missing list:\n%s", out.String())
	}
}
