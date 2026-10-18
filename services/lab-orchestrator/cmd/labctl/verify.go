package main

// labctl verify: the verifier cycle of docs/k8s-readiness.md against a live
// cluster. Every run uses a fresh namespace with the compiled LabTemplate and
// one LabSession, so provisioning, setup and grading go through the
// in-cluster controller exactly as for a learner. Solution, alternative and
// mutation steps are executed with the same driver Exec code the controller
// uses for setup actions (internal/controller.NodeExecutor).

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"
	ctrllog "sigs.k8s.io/controller-runtime/pkg/log"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/controller"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// Run kinds.
const (
	runBase        = "base"
	runMutation    = "mutation"
	runAlternative = "alternative"
	verifyLabel    = "labs.cloudtrain.dev/verify"
)

type verifyOpts struct {
	kubeContext, kubeconfig string
	parallel                int
	only                    map[string]bool
	keep, quick             bool
	outDir                  string
	catalog                 *drivers.ImageCatalog
	readyTimeout            time.Duration
	gradeTimeout            time.Duration
	teardownTimeout         time.Duration
	// sessionLabels are set on every LabSession (managers can select them
	// with --session-selector).
	sessionLabels map[string]string
}

// GradeReport is one grading round.
type GradeReport struct {
	Score  int32                `json:"score"`
	Phase  string               `json:"phase"`
	Checks []labsv1.CheckResult `json:"checks"`
}

// RunReport is one fresh session of the cycle.
type RunReport struct {
	Kind      string `json:"kind"`
	ID        string `json:"id,omitempty"`
	Seed      int64  `json:"seed"`
	Namespace string `json:"namespace"`
	OK        bool   `json:"ok"`
	// Params are the resolved param values.
	Params      map[string]string `json:"params,omitempty"`
	ReadySec    float64           `json:"readySeconds,omitempty"`
	Before      *GradeReport      `json:"gradeBefore,omitempty"`
	After       *GradeReport      `json:"gradeAfter,omitempty"`
	ExpectFail  []string          `json:"expectFail,omitempty"`
	// Answers are the answers submitted to answer checks (base runs).
	Answers     []AnswerReport    `json:"answers,omitempty"`
	Teardown    string            `json:"teardown"` // clean, leftovers, skipped (--keep), failed
	Leftovers   []string          `json:"leftovers,omitempty"`
	Errors      []string          `json:"errors,omitempty"`
	DurationSec float64           `json:"durationSeconds"`
	// answerDigests: per answer check, a digest of its expected values.
	answerDigests map[string]string
}

// LabReport is written to <out>/<lab>.json.
type LabReport struct {
	Lab         string      `json:"lab"`
	Path        string      `json:"path"`
	OK          bool        `json:"ok"`
	StartedAt   time.Time   `json:"startedAt"`
	DurationSec float64     `json:"durationSeconds"`
	Errors      []string    `json:"errors,omitempty"`
	// Warnings do not fail the lab (e.g. an answer the same for two seeds).
	Warnings []string    `json:"warnings,omitempty"`
	Runs     []RunReport `json:"runs"`
}

type labUnderTest struct {
	path string
	tpl  *labsv1.LabTemplate
}

type runSpec struct {
	lab        *labUnderTest
	kind, id   string
	seed       int64
	steps      []labsv1.Action
	expectFail []string
}

func cmdVerify(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("verify", flag.ContinueOnError)
	fl.SetOutput(stderr)
	o := verifyOpts{only: map[string]bool{}}
	var only, catalogs, repoRoot string
	fl.StringVar(&o.kubeContext, "context", "", "kubeconfig context (default: current context; never changed)")
	fl.StringVar(&o.kubeconfig, "kubeconfig", "", "kubeconfig file (default: $KUBECONFIG or ~/.kube/config)")
	fl.IntVar(&o.parallel, "parallel", 2, "sessions verified at the same time")
	fl.StringVar(&only, "only", "", "comma-separated lab ids to verify")
	fl.BoolVar(&o.keep, "keep", false, "keep sessions and namespaces for debugging (skips the teardown check)")
	fl.BoolVar(&o.quick, "quick", false, "only the first-seed base run (steps 1-3), for debugging")
	fl.StringVar(&repoRoot, "repo-root", "", "repository root (default: found from the working directory)")
	fl.StringVar(&o.outDir, "out", "", "report directory (default: <repo>/deploy/.results/verify)")
	fl.StringVar(&catalogs, "catalog", "", "image catalog files, comma separated, later override earlier (default: <repo>/deploy/images/catalog.yaml)")
	fl.DurationVar(&o.readyTimeout, "ready-timeout", 25*time.Minute, "max time for a session to become Ready")
	fl.DurationVar(&o.gradeTimeout, "grade-timeout", 5*time.Minute, "max time for one grading round")
	sessionLabel := fl.String("session-label", verifyLabel+"=true", "label key=value put on every verifier LabSession (match it with the manager's --session-selector)")
	fl.DurationVar(&o.teardownTimeout, "teardown-timeout", 10*time.Minute, "max time for session teardown")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	if fl.NArg() == 0 {
		fmt.Fprintln(stderr, "usage: labctl verify [flags] <lab dir|lab.yaml>...")
		return 2
	}
	k, val, ok := strings.Cut(*sessionLabel, "=")
	if !ok || k == "" {
		fmt.Fprintln(stderr, "--session-label must be key=value")
		return 2
	}
	o.sessionLabels = map[string]string{k: val}
	if o.parallel < 1 {
		o.parallel = 1
	}
	for _, id := range strings.Split(only, ",") {
		if id = strings.TrimSpace(id); id != "" {
			o.only[id] = true
		}
	}
	if repoRoot == "" {
		repoRoot = findRepoRoot()
	}
	if o.outDir == "" {
		o.outDir = filepath.Join(repoRoot, "deploy", ".results", "verify")
	}
	if catalogs == "" {
		catalogs = filepath.Join(repoRoot, "deploy", "images", "catalog.yaml")
	}
	cat, err := drivers.LoadCatalog(strings.Split(catalogs, ",")...)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	o.catalog = cat

	labs, err := collectLabs(fl.Args(), o.only)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(labs) == 0 {
		fmt.Fprintln(stderr, "no labs selected")
		return 1
	}

	cfg, err := restConfig(o.kubeconfig, o.kubeContext)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	v, err := newVerifier(cfg, o, stderr)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	reports := v.verifyAll(ctx, labs)

	if err := os.MkdirAll(o.outDir, 0o755); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	failed := 0
	for _, r := range reports {
		b, _ := json.MarshalIndent(r, "", "  ")
		p := filepath.Join(o.outDir, r.Lab+".json")
		if err := os.WriteFile(p, append(b, '\n'), 0o644); err != nil {
			fmt.Fprintln(stderr, err)
		}
		if !r.OK {
			failed++
		}
	}
	printSummary(stdout, reports)
	fmt.Fprintf(stdout, "\n%d lab(s), %d failed; reports in %s\n", len(reports), failed, o.outDir)
	if failed > 0 {
		return 1
	}
	return 0
}

func findRepoRoot() string {
	dir, _ := os.Getwd()
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "deploy", "images", "catalog.yaml")); err == nil {
			return d
		}
		if filepath.Dir(d) == d {
			return dir
		}
	}
}

func restConfig(kubeconfig, context string) (*rest.Config, error) {
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	if kubeconfig != "" {
		rules.ExplicitPath = kubeconfig
	}
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, &clientcmd.ConfigOverrides{CurrentContext: context}).ClientConfig()
	if err != nil {
		return nil, err
	}
	cfg.QPS, cfg.Burst = 50, 100
	// Deprecation warnings (e.g. KubeVirt presets during discovery) are noise here.
	cfg.WarningHandler = rest.NoWarnings{}
	ctrllog.SetLogger(logr.Discard())
	return cfg, nil
}

// collectLabs finds lab.yaml files (a file, a lab dir, or a tree of labs).
func collectLabs(args []string, only map[string]bool) ([]*labUnderTest, error) {
	var files []string
	for _, a := range args {
		st, err := os.Stat(a)
		if err != nil {
			return nil, err
		}
		if !st.IsDir() {
			files = append(files, a)
			continue
		}
		err = filepath.WalkDir(a, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() && (d.Name() == "lab.yaml" || d.Name() == "lab.yml") {
				files = append(files, p)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	sort.Strings(files)
	var out []*labUnderTest
	for _, f := range files {
		lt, err := compile.CompileFile(f, compile.Options{})
		if err != nil {
			return nil, err
		}
		if len(only) > 0 && !only[lt.Spec.Source.ID] {
			continue
		}
		out = append(out, &labUnderTest{path: f, tpl: lt})
	}
	return out, nil
}

// catalogErrors lists node images the catalog does not know.
func catalogErrors(cat *drivers.ImageCatalog, spec *labsv1.LabTemplateSpec) []string {
	var errs []string
	for _, n := range spec.Topology.Nodes {
		kind := ""
		switch {
		case n.Driver == labsv1.DriverContainer:
			kind = drivers.ImageKindContainer
		case n.Driver == labsv1.DriverVM:
			kind = drivers.ImageKindContainerDisk
		case n.Driver == labsv1.DriverK8sCluster && n.Cluster != nil && n.Cluster.Mode == labsv1.ClusterModeKubeadm:
			kind = drivers.ImageKindContainerDisk
		default:
			continue
		}
		if _, err := cat.Resolve(n.Image, kind); err != nil {
			errs = append(errs, fmt.Sprintf("node %s: %v", n.Name, err))
		}
	}
	return errs
}

// secondSeed returns a seed whose params differ from seed 1's, if any.
func secondSeed(spec *labsv1.LabTemplateSpec) int64 {
	first, err := compile.ResolveParams(spec.Params, 1, compile.ResolveOptions{})
	if err != nil {
		return 2
	}
	for s := int64(2); s < 500; s++ {
		v, err := compile.ResolveParams(spec.Params, s, compile.ResolveOptions{})
		if err == nil && !equalMaps(first, v) {
			return s
		}
	}
	return 2
}

func equalMaps(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// plan lists the runs of the cycle for one lab.
func plan(l *labUnderTest, quick bool) []runSpec {
	spec := &l.tpl.Spec
	s1, s2 := int64(1), secondSeed(spec)
	runs := []runSpec{{lab: l, kind: runBase, id: "seed-1", seed: s1, steps: spec.Solution.Steps}}
	if quick {
		return runs
	}
	runs = append(runs, runSpec{lab: l, kind: runBase, id: fmt.Sprintf("seed-%d", s2), seed: s2, steps: spec.Solution.Steps})
	for _, m := range spec.Misconceptions {
		if m.Mutation == nil {
			continue
		}
		runs = append(runs, runSpec{lab: l, kind: runMutation, id: m.ID, seed: s1, steps: []labsv1.Action{*m.Mutation}, expectFail: m.ExpectFail})
	}
	for _, a := range spec.Solution.Alternatives {
		runs = append(runs, runSpec{lab: l, kind: runAlternative, id: a.ID, seed: s1, steps: a.Steps})
	}
	return runs
}

type verifier struct {
	o      verifyOpts
	c      client.Client
	disc   discovery.DiscoveryInterface
	rt     *drivers.Runtime
	logMu  sync.Mutex
	logOut io.Writer
}

func newVerifier(cfg *rest.Config, o verifyOpts, logOut io.Writer) (*verifier, error) {
	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		return nil, err
	}
	if err := labsv1.AddToScheme(scheme); err != nil {
		return nil, err
	}
	c, err := client.New(cfg, client.Options{Scheme: scheme})
	if err != nil {
		return nil, err
	}
	disc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		return nil, err
	}
	ex, err := drivers.NewRESTPodExecutor(cfg)
	if err != nil {
		return nil, err
	}
	// Exec-only runtime: steps run through the same drivers as setup.
	rt, err := drivers.NewRuntime(drivers.RuntimeOptions{Client: c, Reader: c, Scheme: scheme, Executor: ex})
	if err != nil {
		return nil, err
	}
	return &verifier{o: o, c: c, disc: disc, rt: rt, logOut: logOut}, nil
}

func (v *verifier) logf(format string, args ...any) {
	v.logMu.Lock()
	defer v.logMu.Unlock()
	fmt.Fprintf(v.logOut, "%s %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
}

func (v *verifier) verifyAll(ctx context.Context, labs []*labUnderTest) []LabReport {
	reports := make([]LabReport, len(labs))
	var runs []runSpec
	idx := map[*labUnderTest]int{}
	for i, l := range labs {
		idx[l] = i
		reports[i] = LabReport{Lab: l.tpl.Spec.Source.ID, Path: l.path, StartedAt: time.Now()}
		if errs := catalogErrors(v.o.catalog, &l.tpl.Spec); len(errs) > 0 {
			reports[i].Errors = errs
			v.logf("%s: image catalog: %s", reports[i].Lab, strings.Join(errs, "; "))
			continue
		}
		runs = append(runs, plan(l, v.o.quick)...)
	}
	results := make([]RunReport, len(runs))
	sem := make(chan struct{}, v.o.parallel)
	var wg sync.WaitGroup
	for i, r := range runs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				results[i] = RunReport{Kind: r.kind, ID: r.id, Seed: r.seed, Teardown: "skipped", Errors: []string{"interrupted"}}
				return
			}
			defer func() { <-sem }()
			results[i] = v.run(ctx, r)
		}()
	}
	wg.Wait()
	for i, r := range runs {
		lr := &reports[idx[r.lab]]
		lr.Runs = append(lr.Runs, results[i])
	}
	for i := range reports {
		r := &reports[i]
		r.OK = len(r.Errors) == 0 && len(r.Runs) > 0
		for _, rr := range r.Runs {
			r.OK = r.OK && rr.OK
		}
		for _, id := range sameAnswersAcrossSeeds(r.Runs) {
			msg := fmt.Sprintf("answer check %s expects the same answer for both seeds; learners could share it", id)
			r.Warnings = append(r.Warnings, msg)
			v.logf("%s: WARN %s", r.Lab, msg)
		}
		r.DurationSec = time.Since(r.StartedAt).Seconds()
	}
	return reports
}

func randSuffix() string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func nsName(lab, kind string) string {
	if len(lab) > 30 {
		lab = strings.TrimRight(lab[:30], "-")
	}
	return fmt.Sprintf("ctv-%s-%c%s", lab, kind[0], randSuffix())
}

// run executes one fresh session of the cycle.
func (v *verifier) run(ctx context.Context, r runSpec) (rep RunReport) {
	start := time.Now()
	lab := r.lab.tpl.Spec.Source.ID
	rep = RunReport{Kind: r.kind, ID: r.id, Seed: r.seed, Namespace: nsName(lab, r.kind), ExpectFail: r.expectFail}
	tag := fmt.Sprintf("%s/%s:%s", lab, r.kind, r.id)
	fail := func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		rep.Errors = append(rep.Errors, msg)
		v.logf("%s FAIL %s", tag, msg)
	}
	defer func() { rep.DurationSec = time.Since(start).Seconds() }()

	v.logf("%s: namespace %s, seed %d", tag, rep.Namespace, r.seed)
	sess, err := v.create(ctx, r, rep.Namespace)
	if err != nil {
		fail("create: %v", err)
		v.cleanup(ctx, &rep, nil)
		return rep
	}
	defer func() { v.cleanup(context.WithoutCancel(ctx), &rep, sess) }()

	// 1. Fresh session becomes Ready.
	sess, err = v.waitReady(ctx, sess)
	if err != nil {
		fail("session not ready: %v", err)
		return rep
	}
	rep.ReadySec = time.Since(start).Seconds()
	rep.Params = sess.Status.ResolvedParams
	v.logf("%s: Ready after %.0fs", tag, rep.ReadySec)

	// 2. Not already solved.
	before, err := v.grade(ctx, sess, 1)
	rep.Before = before
	if err != nil {
		fail("grade before: %v", err)
		return rep
	}
	if r.kind == runBase && allPassed(before) {
		fail("every check passes before the solution (lab is already solved)")
	}

	// 3/4/5. Apply the steps.
	spec, _, err := compile.Resolve(&r.lab.tpl.Spec, r.seed, compile.ResolveOptions{})
	if err != nil {
		fail("resolve: %v", err)
		return rep
	}
	ex := &controller.NodeExecutor{Drivers: v.rt.Registry, Session: sess, Template: spec}
	for i, a := range stepsFor(r, spec) {
		sctx, cancel := context.WithTimeout(ctx, controller.ActionRequest(a).Timeout+time.Minute)
		res, err := ex.RunAction(sctx, a)
		cancel()
		if err != nil {
			fail("%s step %d: %v (stdout: %s)", r.kind, i, err, tail(res.Stdout, 400))
			return rep
		}
	}

	after, err := v.grade(ctx, sess, 2)
	rep.After = after
	if err != nil {
		fail("grade after: %v", err)
		return rep
	}
	switch r.kind {
	case runBase, runAlternative:
		for _, c := range after.Checks {
			if !c.Passed {
				fail("check %s fails after the %s (%s): %s", c.ID, r.kind, c.Message, tail(c.Output, 300))
			}
		}
	}
	if r.kind == runBase {
		cur := &labsv1.LabSession{}
		if err := v.c.Get(ctx, client.ObjectKeyFromObject(sess), cur); err == nil {
			sess = cur
		}
		answers, problems, digests := verifyAnswers(ctx, spec, sess.Status.ComputedAnswers, execAnswerSource(ex, spec.Topology.Entry))
		rep.Answers, rep.answerDigests = answers, digests
		for _, p := range problems {
			fail("%s", p)
		}
	}
	switch r.kind {
	case runMutation:
		got := map[string]bool{}
		for _, c := range after.Checks {
			got[c.ID] = c.Passed
		}
		for _, id := range r.expectFail {
			passed, ok := got[id]
			switch {
			case !ok:
				fail("expectFail check %s does not exist", id)
			case passed:
				fail("mutation not caught: check %s passes", id)
			}
		}
	}
	rep.OK = len(rep.Errors) == 0
	return rep
}

// stepsFor returns the run's steps with params resolved for its seed.
func stepsFor(r runSpec, spec *labsv1.LabTemplateSpec) []labsv1.Action {
	switch r.kind {
	case runBase:
		return spec.Solution.Steps
	case runAlternative:
		for _, a := range spec.Solution.Alternatives {
			if a.ID == r.id {
				return a.Steps
			}
		}
	case runMutation:
		for _, m := range spec.Misconceptions {
			if m.ID == r.id && m.Mutation != nil {
				return []labsv1.Action{*m.Mutation}
			}
		}
	}
	return r.steps
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return "…" + s[len(s)-n:]
	}
	return s
}

func allPassed(g *GradeReport) bool {
	for _, c := range g.Checks {
		if !c.Passed {
			return false
		}
	}
	return len(g.Checks) > 0
}

func (v *verifier) create(ctx context.Context, r runSpec, ns string) (*labsv1.LabSession, error) {
	err := v.c.Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns, Labels: map[string]string{
		verifyLabel: "true", "labs.cloudtrain.dev/lab-id": r.lab.tpl.Spec.Source.ID,
	}}})
	if err != nil {
		return nil, err
	}
	lt := r.lab.tpl.DeepCopy()
	lt.Namespace = ns
	lt.ResourceVersion = ""
	if err := v.c.Create(ctx, lt); err != nil {
		return nil, fmt.Errorf("LabTemplate: %w", err)
	}
	ttl := metav1.Duration{Duration: 3 * time.Hour}
	s := &labsv1.LabSession{
		ObjectMeta: metav1.ObjectMeta{Name: "verify", Namespace: ns, Labels: v.o.sessionLabels},
		Spec: labsv1.LabSessionSpec{
			TemplateRef: labsv1.TemplateReference{Name: lt.Name},
			Learner:     labsv1.LearnerRef{ID: "verifier"},
			Seed:        r.seed,
			TTL:         &ttl,
		},
	}
	if err := v.c.Create(ctx, s); err != nil {
		return nil, fmt.Errorf("LabSession: %w", err)
	}
	return s, nil
}

func (v *verifier) waitReady(ctx context.Context, s *labsv1.LabSession) (*labsv1.LabSession, error) {
	deadline := time.Now().Add(v.o.readyTimeout)
	last := ""
	for {
		cur := &labsv1.LabSession{}
		if err := v.c.Get(ctx, client.ObjectKeyFromObject(s), cur); err != nil {
			return nil, err
		}
		ready := meta.FindStatusCondition(cur.Status.Conditions, labsv1.ConditionReady)
		msg := ""
		if ready != nil {
			msg = ready.Message
		}
		switch cur.Status.Phase {
		case labsv1.SessionReady:
			return cur, nil
		case labsv1.SessionFailed, labsv1.SessionExpired:
			return cur, fmt.Errorf("phase %s: %s", cur.Status.Phase, msg)
		}
		if nr := meta.FindStatusCondition(cur.Status.Conditions, labsv1.ConditionNodesReady); nr != nil && nr.Status != metav1.ConditionTrue {
			msg = nr.Message
		} else if sc := meta.FindStatusCondition(cur.Status.Conditions, labsv1.ConditionSetupComplete); sc != nil && sc.Status != metav1.ConditionTrue {
			msg = sc.Message
		}
		if msg != last {
			v.logf("%s/%s: %s: %s", s.Namespace, s.Name, cur.Status.Phase, msg)
			last = msg
		}
		if time.Now().After(deadline) {
			return cur, fmt.Errorf("not Ready after %s: %s", v.o.readyTimeout, msg)
		}
		select {
		case <-ctx.Done():
			return cur, ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}

// grade bumps spec.validateRequest and waits for status.validation.
func (v *verifier) grade(ctx context.Context, s *labsv1.LabSession, req int64) (*GradeReport, error) {
	patch := []byte(fmt.Sprintf(`{"spec":{"validateRequest":%d}}`, req))
	if err := v.c.Patch(ctx, s, client.RawPatch("application/merge-patch+json", patch)); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(v.o.gradeTimeout)
	for {
		cur := &labsv1.LabSession{}
		if err := v.c.Get(ctx, client.ObjectKeyFromObject(s), cur); err != nil {
			return nil, err
		}
		if val := cur.Status.Validation; val != nil && val.ObservedRequest == req && val.Phase != labsv1.ValidationRunning {
			g := &GradeReport{Score: val.Score, Phase: string(val.Phase), Checks: val.Checks}
			if val.Phase == labsv1.ValidationFailed {
				return g, fmt.Errorf("grading failed: %s", val.Message)
			}
			return g, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("no grading result after %s", v.o.gradeTimeout)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// cleanup deletes the session, checks that everything it created is gone,
// then deletes the namespace (unless --keep).
func (v *verifier) cleanup(ctx context.Context, rep *RunReport, s *labsv1.LabSession) {
	if v.o.keep {
		rep.Teardown = "skipped"
		v.logf("--keep: namespace %s left in place", rep.Namespace)
		return
	}
	var uid string
	if s != nil {
		cur := &labsv1.LabSession{}
		if err := v.c.Get(ctx, client.ObjectKeyFromObject(s), cur); err == nil {
			uid = string(cur.UID)
		}
		if err := v.c.Delete(ctx, s); err != nil && !apierrors.IsNotFound(err) {
			rep.Teardown = "failed"
			rep.Errors = append(rep.Errors, "delete session: "+err.Error())
		} else if err := v.waitGone(ctx, s, v.o.teardownTimeout); err != nil {
			rep.Teardown = "failed"
			rep.Errors = append(rep.Errors, "teardown: "+err.Error())
		} else {
			left, err := v.leftovers(ctx, rep.Namespace, uid)
			switch {
			case err != nil:
				rep.Teardown = "failed"
				rep.Errors = append(rep.Errors, "leftover check: "+err.Error())
			case len(left) > 0:
				rep.Teardown = "leftovers"
				rep.Leftovers = left
				rep.Errors = append(rep.Errors, fmt.Sprintf("teardown left %d object(s): %s", len(left), strings.Join(left, ", ")))
			default:
				rep.Teardown = "clean"
			}
		}
	}
	if rep.Teardown == "" {
		rep.Teardown = "skipped"
	}
	rep.OK = rep.OK && rep.Teardown == "clean"
	nsObj := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: rep.Namespace}}
	if err := v.c.Delete(ctx, nsObj); err != nil && !apierrors.IsNotFound(err) {
		rep.Errors = append(rep.Errors, "delete namespace: "+err.Error())
		return
	}
	if err := v.waitGone(ctx, nsObj, 5*time.Minute); err != nil {
		rep.Errors = append(rep.Errors, "namespace: "+err.Error())
	}
}

func (v *verifier) waitGone(ctx context.Context, obj client.Object, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		err := v.c.Get(ctx, client.ObjectKeyFromObject(obj), obj.DeepCopyObject().(client.Object))
		if apierrors.IsNotFound(err) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s still present after %s", obj.GetName(), timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

// leftovers lists every object still in the namespace (except what the
// namespace itself provides and the LabTemplate the verifier created) plus
// cluster-scoped Kube-OVN objects of the session.
func (v *verifier) leftovers(ctx context.Context, ns, uid string) ([]string, error) {
	lists, err := v.disc.ServerPreferredNamespacedResources()
	if err != nil && len(lists) == 0 {
		return nil, err
	}
	var out []string
	for _, l := range lists {
		gv, err := schema.ParseGroupVersion(l.GroupVersion)
		if err != nil {
			continue
		}
		for _, res := range l.APIResources {
			if !hasVerb(res.Verbs, "list") || strings.Contains(res.Name, "/") {
				continue
			}
			if res.Name == "events" || (gv.Group == labsv1.GroupVersion.Group && res.Kind == "LabTemplate") {
				continue
			}
			ul := &unstructured.UnstructuredList{}
			ul.SetGroupVersionKind(gv.WithKind(res.Kind + "List"))
			if err := v.c.List(ctx, ul, client.InNamespace(ns)); err != nil {
				continue
			}
			for _, it := range ul.Items {
				if ignorable(res.Kind, it.GetName()) {
					continue
				}
				out = append(out, fmt.Sprintf("%s/%s", strings.ToLower(res.Kind), it.GetName()))
			}
		}
	}
	// Cluster-scoped RBAC the vcluster chart names "vc-<release>-v-<namespace>".
	for _, kind := range []string{"ClusterRole", "ClusterRoleBinding"} {
		ul := &unstructured.UnstructuredList{}
		ul.SetGroupVersionKind(schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: kind + "List"})
		if err := v.c.List(ctx, ul); err != nil {
			return nil, err
		}
		for _, it := range ul.Items {
			if strings.HasSuffix(it.GetName(), "-v-"+ns) {
				out = append(out, fmt.Sprintf("%s/%s", strings.ToLower(kind), it.GetName()))
			}
		}
	}
	// vcluster host namespaces of the session ("ct-<release>").
	nsl := &unstructured.UnstructuredList{}
	nsl.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "NamespaceList"})
	if err := v.c.List(ctx, nsl, client.MatchingLabels{drivers.LabelSessionNamespace: ns}); err != nil {
		return nil, err
	}
	for _, it := range nsl.Items {
		out = append(out, "namespace/"+it.GetName())
	}
	if uid != "" {
		for _, gvk := range []schema.GroupVersionKind{drivers.GVKVpc, drivers.GVKSubnet} {
			ul := &unstructured.UnstructuredList{}
			ul.SetGroupVersionKind(gvk.GroupVersion().WithKind(gvk.Kind + "List"))
			if err := v.c.List(ctx, ul, client.MatchingLabels{drivers.LabelSessionUID: uid}); err != nil {
				if meta.IsNoMatchError(err) {
					continue
				}
				return nil, err
			}
			for _, it := range ul.Items {
				out = append(out, fmt.Sprintf("%s/%s", strings.ToLower(gvk.Kind), it.GetName()))
			}
		}
	}
	sort.Strings(out)
	return out, nil
}

func ignorable(kind, name string) bool {
	switch {
	case kind == "ConfigMap" && name == "kube-root-ca.crt",
		kind == "ServiceAccount" && name == "default":
		return true
	}
	return false
}

func hasVerb(verbs []string, v string) bool {
	for _, x := range verbs {
		if x == v {
			return true
		}
	}
	return false
}

func printSummary(w io.Writer, reports []LabReport) {
	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "LAB\tRUN\tSEED\tREADY\tBEFORE\tAFTER\tTEARDOWN\tRESULT")
	for _, r := range reports {
		if len(r.Runs) == 0 {
			fmt.Fprintf(tw, "%s\t-\t-\t-\t-\t-\t-\tFAIL %s\n", r.Lab, strings.Join(r.Errors, "; "))
		}
		for _, rr := range r.Runs {
			res := "ok"
			if !rr.OK {
				res = "FAIL"
				if len(rr.Errors) > 0 {
					res += " " + firstLine(rr.Errors[0])
				}
			}
			fmt.Fprintf(tw, "%s\t%s:%s\t%d\t%s\t%s\t%s\t%s\t%s\n", r.Lab, rr.Kind, rr.ID, rr.Seed,
				secs(rr.ReadySec), score(rr.Before), score(rr.After), rr.Teardown, res)
		}
	}
	_ = tw.Flush()
	for _, r := range reports {
		for _, msg := range r.Warnings {
			fmt.Fprintf(w, "%s: warning: %s\n", r.Lab, msg)
		}
	}
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(s, "\n")
	if len(s) > 120 {
		s = s[:120] + "…"
	}
	return s
}

func secs(s float64) string {
	if s == 0 {
		return "-"
	}
	return fmt.Sprintf("%.0fs", s)
}

func score(g *GradeReport) string {
	if g == nil {
		return "-"
	}
	passed := 0
	for _, c := range g.Checks {
		if c.Passed {
			passed++
		}
	}
	return fmt.Sprintf("%d (%d/%d)", g.Score, passed, len(g.Checks))
}
