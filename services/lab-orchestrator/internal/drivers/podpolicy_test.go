package drivers

import (
	"context"
	"strings"
	"testing"

	admissionv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestCheckPodPolicy(t *testing.T) {
	ctx := context.Background()
	const name = "lab-orchestrator-pods-x"
	pol := func(sandboxes string) *admissionv1.ValidatingAdmissionPolicy {
		return &admissionv1.ValidatingAdmissionPolicy{ObjectMeta: metav1.ObjectMeta{Name: name},
			Spec: admissionv1.ValidatingAdmissionPolicySpec{Variables: []admissionv1.Variable{{Name: PodPolicySandboxesVariable, Expression: sandboxes}}}}
	}
	bind := func(actions ...admissionv1.ValidationAction) *admissionv1.ValidatingAdmissionPolicyBinding {
		return &admissionv1.ValidatingAdmissionPolicyBinding{ObjectMeta: metav1.ObjectMeta{Name: name},
			Spec: admissionv1.ValidatingAdmissionPolicyBindingSpec{PolicyName: name, ValidationActions: actions}}
	}
	reader := func(objs ...client.Object) client.Reader {
		return fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(objs...).Build()
	}
	cases := []struct {
		name     string
		r        client.Reader
		served   bool
		policy   string
		classes  []string
		wantErr  string
		wantWarn string
	}{
		{name: "API missing: fail open with a warning", r: reader(), served: false, policy: name, wantWarn: "Kubernetes < 1.30"},
		{name: "not configured: warning", r: reader(), served: true, wantWarn: "no lab pod admission policy configured"},
		{name: "policy missing: fail closed", r: reader(), served: true, policy: name, wantErr: "is not installed"},
		{name: "binding missing", r: reader(pol("[]")), served: true, policy: name, wantErr: "no binding"},
		{name: "binding only warns", r: reader(pol("[]"), bind(admissionv1.Warn)), served: true, policy: name, wantErr: "Deny"},
		{name: "enforced", r: reader(pol("['kata-clh-runtime-rs']"), bind(admissionv1.Deny)), served: true, policy: name, classes: []string{"kata-clh-runtime-rs"}},
		{name: "sandbox class not in the policy", r: reader(pol("[]"), bind(admissionv1.Deny)), served: true, policy: name, classes: []string{"kata-clh-runtime-rs"}, wantWarn: "does not list the sandbox RuntimeClasses kata-clh-runtime-rs"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := CheckPodPolicy(ctx, tc.r, tc.served, tc.policy, tc.classes)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			warn := strings.Join(res.Warnings, "\n")
			if (tc.wantWarn == "") != (warn == "") || !strings.Contains(warn, tc.wantWarn) {
				t.Errorf("warnings = %q, want %q", warn, tc.wantWarn)
			}
		})
	}
	s := &Sandboxes{Tiers: map[string]SandboxTier{"B": {RuntimeClass: "kata-b"}, "C": {RuntimeClass: "kata-b"}, "A": {RuntimeClass: "gvisor-a"}}}
	if got := strings.Join(s.SandboxRuntimeClasses(), ","); got != "gvisor-a,kata-b" {
		t.Errorf("SandboxRuntimeClasses = %s", got)
	}
	if (*Sandboxes)(nil).SandboxRuntimeClasses() != nil {
		t.Error("nil Sandboxes")
	}
}
