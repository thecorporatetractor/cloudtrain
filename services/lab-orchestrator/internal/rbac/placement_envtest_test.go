package rbac

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
	sigsyaml "sigs.k8s.io/yaml"
)

// TestEnvtestVClusterPlacementPolicy renders the chart's vcluster placement
// policy with the AKS example (lab pool cloudtrain.dev/pool=labs, taint
// cloudtrain.dev/labs, tier V kata-vm-isolation) and applies it to a real API
// server: a learner's pod synced into ct-vc-* cannot select or tolerate its
// way onto the system pool.
func TestEnvtestVClusterPlacementPolicy(t *testing.T) {
	if os.Getenv("KUBEBUILDER_ASSETS") == "" {
		t.Skip("KUBEBUILDER_ASSETS not set (make test-rbac)")
	}
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm not on PATH")
	}
	env := &envtest.Environment{}
	cfg, err := env.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = env.Stop() })
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	admin, err := client.New(cfg, client.Options{Scheme: scheme})
	if err != nil {
		t.Fatal(err)
	}
	if err := admin.Create(ctx, &nodev1.RuntimeClass{ObjectMeta: metav1.ObjectMeta{Name: "kata-vm-isolation"}, Handler: "kata"}); err != nil {
		t.Fatal(err)
	}
	labTol := corev1.Toleration{Key: "cloudtrain.dev/labs", Operator: corev1.TolerationOpEqual, Value: "true", Effect: corev1.TaintEffectNoSchedule}
	kata := func(s *corev1.PodSpec) { s.RuntimeClassName = ptrString("kata-vm-isolation") }
	labSel := func(s *corev1.PodSpec) { s.NodeSelector = map[string]string{"cloudtrain.dev/pool": "labs"} }

	// production: the AKS example; dev: the same pools under the dev profile.
	for _, profile := range []string{"production", "dev"} {
		t.Run(profile, func(t *testing.T) {
			ns := "ct-vc-" + profile
			for _, n := range []string{ns, "plain-" + profile} {
				if err := admin.Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: n}}); err != nil {
					t.Fatal(err)
				}
				_ = admin.Create(ctx, &corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Namespace: n, Name: "default"}})
			}
			for _, d := range renderPlacementPolicy(t, profile) {
				u := &unstructured.Unstructured{}
				if err := sigsyaml.Unmarshal(d, &u.Object); err != nil {
					t.Fatal(err)
				}
				u.SetName(u.GetName() + "-" + profile)
				if u.GetKind() == "ValidatingAdmissionPolicyBinding" {
					_ = unstructured.SetNestedField(u.Object, u.GetName(), "spec", "policyName")
				}
				if u.GetKind() == "ValidatingAdmissionPolicy" {
					// Only this subtest's namespace.
					conds, _, _ := unstructured.NestedSlice(u.Object, "spec", "matchConditions")
					conds[0].(map[string]any)["expression"] = "request.namespace == '" + ns + "'"
					_ = unstructured.SetNestedSlice(u.Object, conds, "spec", "matchConditions")
				}
				if err := admin.Create(ctx, u); err != nil {
					t.Fatal(err)
				}
			}
			pod := func(name string, muts ...func(*corev1.PodSpec)) *corev1.Pod {
				p := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name},
					Spec: corev1.PodSpec{AutomountServiceAccountToken: ptrFalse(), Containers: []corev1.Container{{Name: "c", Image: "nginx"}}}}
				for _, m := range muts {
					m(&p.Spec)
				}
				return p
			}
			eventually(t, func() error {
				err := admin.Create(ctx, pod("probe"))
				if err != nil && strings.Contains(err.Error(), "ValidatingAdmissionPolicy") {
					return nil
				}
				if err == nil {
					_ = admin.Delete(ctx, pod("probe"))
				}
				return errNotYet(err)
			})
			denied := map[string]*corev1.Pod{
				"no lab selector, no sandbox": pod("plain-pod"),
				"system pool selector + system toleration": pod("sys", kata, func(s *corev1.PodSpec) {
					s.NodeSelector = map[string]string{"kubernetes.azure.com/mode": "system"}
					s.Tolerations = []corev1.Toleration{{Key: "CriticalAddonsOnly", Operator: corev1.TolerationOpExists}}
				}),
				"tolerate everything": pod("all", kata, func(s *corev1.PodSpec) { s.Tolerations = []corev1.Toleration{{Operator: corev1.TolerationOpExists}} }),
				"wrong pool value":    pod("wrong", func(s *corev1.PodSpec) { s.NodeSelector = map[string]string{"cloudtrain.dev/pool": "system"} }),
				// spec.nodeName skips the scheduler: never, even in the sandbox.
				"nodeName on a system node": pod("pinned", kata, func(s *corev1.PodSpec) { s.NodeName = "aks-system-0" }),
			}
			allowed := map[string]*corev1.Pod{
				"synced pod in the tier V sandbox":             pod("synced", kata, func(s *corev1.PodSpec) { s.Tolerations = []corev1.Toleration{labTol} }),
				"control plane in the sandbox on the lab pool": pod("cp", kata, labSel, func(s *corev1.PodSpec) { s.Tolerations = []corev1.Toleration{labTol} }),
			}
			// The lab selector alone (runc on the lab pool, host users): only
			// outside the production profile.
			selectorOnly := pod("selector-only", labSel, func(s *corev1.PodSpec) { s.Tolerations = []corev1.Toleration{labTol} })
			if profile == "production" {
				denied["lab selector without the sandbox"] = selectorOnly
			} else {
				allowed["lab selector without the sandbox"] = selectorOnly
			}
			for name, p := range denied {
				if err := admin.Create(ctx, p); err == nil || !strings.Contains(err.Error(), "ValidatingAdmissionPolicy") {
					t.Errorf("%s: want denied by the policy, got %v", name, err)
				}
			}
			for name, p := range allowed {
				if err := admin.Create(ctx, p); err != nil {
					t.Errorf("%s: %v", name, err)
				}
			}
			free := pod("free", func(s *corev1.PodSpec) { s.Tolerations = []corev1.Toleration{{Operator: corev1.TolerationOpExists}} })
			free.Namespace = "plain-" + profile
			if err := admin.Create(ctx, free); err != nil {
				t.Errorf("outside ct-vc-*: %v", err)
			}
		})
	}
}

// renderPlacementPolicy renders the chart's vcluster placement policy and
// binding from the AKS example (lab pool cloudtrain.dev/pool=labs, taint
// cloudtrain.dev/labs, tier V kata-vm-isolation) under the given profile.
func renderPlacementPolicy(t *testing.T, profile string) [][]byte {
	t.Helper()
	chart := filepath.Join("..", "..", "..", "..", "deploy", "charts", "cloudtrain")
	out, err := exec.Command("helm", "template", "ct", chart, "-n", "cloudtrain", "-f", filepath.Join(chart, "examples", "values-aks-app-routing.yaml"),
		// An immutable image tag, as tools/charts/test.sh's ci-tag: the
		// gateway migrate Job refuses a mutable one.
		"--set", "global.imageTag=0.0.0-test",
		"--set", "orchestrator.isolation.profile="+profile).Output()
	if err != nil {
		var stderr []byte
		if ee, ok := err.(*exec.ExitError); ok {
			stderr = ee.Stderr
		}
		t.Fatalf("helm template: %v: %s", err, stderr)
	}
	var docs [][]byte
	for _, d := range bytes.Split(out, []byte("\n---\n")) {
		if bytes.Contains(d, []byte("-vcluster-placement")) {
			docs = append(docs, d)
		}
	}
	if len(docs) != 2 {
		t.Fatalf("want the policy and its binding, got %d documents", len(docs))
	}
	return docs
}

func ptrString(s string) *string { return &s }

type notYet struct{ err error }

func (e notYet) Error() string { return "placement policy not active yet: " + errString(e.err) }

func errNotYet(err error) error { return notYet{err} }

func errString(err error) string {
	if err == nil {
		return "<nil>"
	}
	return err.Error()
}
