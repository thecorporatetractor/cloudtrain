package compile

import (
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func ptr[T any](v T) *T { return &v }

func TestResolveParams(t *testing.T) {
	params := map[string]labsv1.ParamSpec{
		"site":  {Type: labsv1.ParamChoice, Values: []string{"a", "b", "c"}},
		"octet": {Type: labsv1.ParamInt, Min: ptr[int64](20), Max: ptr[int64](60)},
		"ns":    {Type: labsv1.ParamName, Prefix: "ledger"},
		"anon":  {Type: labsv1.ParamName},
		"fixed": {Type: labsv1.ParamInt, Min: ptr[int64](7), Max: ptr[int64](7), Default: ptr("9")},
	}
	nameRe := regexp.MustCompile(`^ledger-[a-z0-9]{5}$`)
	anonRe := regexp.MustCompile(`^[a-z][a-z0-9]{5}$`)

	tests := []struct {
		name string
		seed int64
		opts ResolveOptions
	}{
		{"seed 0", 0, ResolveOptions{}},
		{"seed 1", 1, ResolveOptions{}},
		{"negative seed", -42, ResolveOptions{}},
		{"large seed", 1 << 62, ResolveOptions{}},
		{"defaults", 5, ResolveOptions{UseDefaults: true}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a, err := ResolveParams(params, tt.seed, tt.opts)
			if err != nil {
				t.Fatal(err)
			}
			b, _ := ResolveParams(params, tt.seed, tt.opts)
			if !reflect.DeepEqual(a, b) {
				t.Fatalf("not deterministic: %v vs %v", a, b)
			}
			if !strings.Contains("abc", a["site"]) || len(a["site"]) != 1 {
				t.Errorf("site = %q", a["site"])
			}
			if n, err := strconv.Atoi(a["octet"]); err != nil || n < 20 || n > 60 {
				t.Errorf("octet = %q", a["octet"])
			}
			if !nameRe.MatchString(a["ns"]) || !anonRe.MatchString(a["anon"]) {
				t.Errorf("names = %q %q", a["ns"], a["anon"])
			}
			wantFixed := "7"
			if tt.opts.UseDefaults {
				wantFixed = "9"
			}
			if a["fixed"] != wantFixed {
				t.Errorf("fixed = %q, want %q", a["fixed"], wantFixed)
			}
		})
	}
}

func TestResolveParamsStableAcrossParamSets(t *testing.T) {
	one := map[string]labsv1.ParamSpec{"ns": {Type: labsv1.ParamName, Prefix: "x"}}
	two := map[string]labsv1.ParamSpec{"ns": one["ns"], "other": {Type: labsv1.ParamChoice, Values: []string{"q"}}}
	a, _ := ResolveParams(one, 99, ResolveOptions{})
	b, _ := ResolveParams(two, 99, ResolveOptions{})
	if a["ns"] != b["ns"] {
		t.Fatalf("adding a param changed ns: %q vs %q", a["ns"], b["ns"])
	}
}

func TestResolveParamsSpread(t *testing.T) {
	params := map[string]labsv1.ParamSpec{"v": {Type: labsv1.ParamInt, Min: ptr[int64](1), Max: ptr[int64](4)}}
	seen := map[string]bool{}
	for seed := int64(0); seed < 64; seed++ {
		v, _ := ResolveParams(params, seed, ResolveOptions{})
		seen[v["v"]] = true
	}
	if len(seen) != 4 {
		t.Fatalf("expected all 4 values over 64 seeds, got %v", seen)
	}
}

// Golden values pin the derivation: changing them re-randomises every
// existing session, so treat a failure here as a breaking change.
func TestResolveGolden(t *testing.T) {
	lt, err := Compile(readLab(t, "net-ospf-two-routers"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	got, err := ResolveParams(lt.Spec.Params, 1234, ResolveOptions{})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("golden: %v", got)
	want := goldenOSPF1234
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestResolveSubstitutesEverywhere(t *testing.T) {
	tests := []struct {
		lab string
	}{{"net-ospf-two-routers"}, {"k8s-kubeadm-worker-notready"}}
	for _, tt := range tests {
		t.Run(tt.lab, func(t *testing.T) {
			lt, err := Compile(readLab(t, tt.lab), Options{})
			if err != nil {
				t.Fatal(err)
			}
			r, values, err := Resolve(&lt.Spec, 7, ResolveOptions{})
			if err != nil {
				t.Fatal(err)
			}
			if len(values) != len(lt.Spec.Params) {
				t.Errorf("values = %v", values)
			}
			if refs := placeholderRefs(r); len(refs) != 0 {
				t.Errorf("unresolved placeholders: %v", refs)
			}
			if !reflect.DeepEqual(r.Source, lt.Spec.Source) || !reflect.DeepEqual(r.Params, lt.Spec.Params) {
				t.Errorf("source/params must be preserved")
			}
			// The template itself is untouched.
			if len(placeholderRefs(&lt.Spec)) == 0 {
				t.Errorf("template was mutated")
			}
		})
	}
}

func TestSubstituteUnknown(t *testing.T) {
	spec := &labsv1.LabTemplateSpec{Description: "hi {{who}}"}
	if _, err := Substitute(spec, map[string]string{}); err == nil || !strings.Contains(err.Error(), "{{who}}") {
		t.Fatalf("err = %v", err)
	}
	out, err := Substitute(spec, map[string]string{"who": "there"})
	if err != nil || out.Description != "hi there" {
		t.Fatalf("out = %v, err = %v", out, err)
	}
}
