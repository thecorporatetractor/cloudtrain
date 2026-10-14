package compile

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Native Go fuzz targets for the lab compiler: lab.yaml is the input authors
// (and later Scenario Studio) control. `go test ./internal/compile` runs the
// seed corpus as regular tests; .github/workflows/fuzz.yml fuzzes each target
// nightly with a time budget, e.g.
//
//	go test ./internal/compile -run '^$' -fuzz '^FuzzCompile$' -fuzztime 5m

// seedLabs adds the testdata labs and a sample of the content labs.
func seedLabs(f *testing.F) {
	f.Helper()
	f.Add([]byte(minimalLab))
	var paths []string
	for _, pat := range []string{
		"../../testdata/labs/*/lab.yaml",
		"../../../../content/packs/*/labs/*/lab.yaml",
	} {
		m, _ := filepath.Glob(pat)
		if len(m) > 12 {
			m = m[:12]
		}
		paths = append(paths, m...)
	}
	for _, p := range paths {
		if b, err := os.ReadFile(p); err == nil {
			f.Add(b)
		}
	}
	for _, s := range []string{"", "null", "a: &a [*a]", "{", "apiVersion: cloudtrain.dev/v3\nkind: Lab\n---\nx: 1", "n: 99999999999999999999999"} {
		f.Add([]byte(s))
	}
}

// FuzzYAMLToJSON: never panics; whatever it accepts is valid JSON.
func FuzzYAMLToJSON(f *testing.F) {
	seedLabs(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		js, err := YAMLToJSON(data)
		if err != nil {
			return
		}
		if !json.Valid(js) {
			t.Fatalf("YAMLToJSON returned invalid JSON %q for %q", js, data)
		}
	})
}

// FuzzCompile: never panics; a successful compile yields a template with a
// name and spec, assets never resolve outside the lab directory, and compiling
// the same bytes again gives the same template name (deterministic).
func FuzzCompile(f *testing.F) {
	seedLabs(f)
	f.Add([]byte(assetLab))
	f.Add([]byte(strings.Replace(assetLab, "assets/run.sh", "../outside.txt", 1)))
	f.Add([]byte(strings.Replace(assetLab, "assets/run.sh", "assets/link.sh", 1)))
	// <tmp>/outside.txt must never reach a template: neither by a relative
	// path nor through a symlink inside the lab directory.
	dir := f.TempDir()
	lab := filepath.Join(dir, "lab")
	if err := os.MkdirAll(filepath.Join(lab, "assets"), 0o755); err != nil {
		f.Fatal(err)
	}
	for name, content := range map[string]string{
		filepath.Join(lab, "assets", "run.sh"): "touch /tmp/ran\n",
		filepath.Join(dir, "outside.txt"):      "OUTSIDE-SECRET",
	} {
		if err := os.WriteFile(name, []byte(content), 0o644); err != nil {
			f.Fatal(err)
		}
	}
	if err := os.Symlink(filepath.Join("..", "..", "outside.txt"), filepath.Join(lab, "assets", "link.sh")); err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		tpl, err := Compile(data, Options{BaseDir: lab})
		if err != nil {
			return
		}
		if tpl == nil || tpl.Name == "" {
			t.Fatalf("Compile succeeded without a named template")
		}
		if b, _ := json.Marshal(tpl.Spec); bytes.Contains(b, []byte("OUTSIDE-SECRET")) {
			t.Fatalf("a file.source asset was read from outside the lab directory")
		}
		again, err := Compile(data, Options{BaseDir: lab})
		if err != nil || again.Name != tpl.Name {
			t.Fatalf("Compile is not deterministic: %v, %q vs %q", err, tpl.Name, again.Name)
		}
	})
}

// FuzzResolveIntParam: an int param always resolves inside [min, max], also at
// the int64 extremes, and the same seed gives the same value.
func FuzzResolveIntParam(f *testing.F) {
	f.Add(int64(0), int64(20), int64(60))
	f.Add(int64(-1), int64(7), int64(7))
	f.Add(int64(1<<62), int64(-1<<63), int64(1<<63-1))
	f.Add(int64(42), int64(-5), int64(5))
	f.Fuzz(func(t *testing.T, seed, lo, hi int64) {
		if lo > hi {
			lo, hi = hi, lo
		}
		params := map[string]labsv1.ParamSpec{"n": {Type: labsv1.ParamInt, Min: &lo, Max: &hi}}
		a, err := ResolveParams(params, seed, ResolveOptions{})
		if err != nil {
			t.Fatalf("ResolveParams(%d, [%d, %d]): %v", seed, lo, hi, err)
		}
		v, err := strconv.ParseInt(a["n"], 10, 64)
		if err != nil || v < lo || v > hi {
			t.Fatalf("value %q outside [%d, %d] (err %v)", a["n"], lo, hi, err)
		}
		b, _ := ResolveParams(params, seed, ResolveOptions{})
		if b["n"] != a["n"] {
			t.Fatalf("not deterministic: %q vs %q", a["n"], b["n"])
		}
	})
}
