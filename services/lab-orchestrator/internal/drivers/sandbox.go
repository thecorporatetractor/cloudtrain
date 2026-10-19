package drivers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Tier sandboxes (docs/kata-spike.md, docs/any-kubernetes.md; off unless the
// manager runs with --sandboxes or --sandboxes-config). A catalog image's tier
// (A, B, ...) maps to a sandbox RuntimeClass, e.g. B -> kata-clh-runtime-rs:
// container nodes of tier-B images then run in a Kata sandbox (a lightweight
// VM per pod) instead of the default runtime.
//
// Safety rule: catalog images marked systemd or privileged need a privileged
// container. Inside a Kata sandbox "privileged" covers the guest VM only
// (kata-deploy sets privileged_without_host_devices), so the driver allows it
// there and nowhere else. Without an available sandbox such a node is either
// rewritten to its KubeVirt VM twin (fallback kubevirt, catalog vmFallback) or
// fails with ErrUnsupported; it never runs privileged on the host kernel.
//
// A sandbox is available when its RuntimeClass exists, its handler is a VM
// sandbox (a kata* handler, or one labctl preflight proved boots its own
// kernel), its node selector matches a schedulable node, and the preflight
// result, if one is mounted, did not fail it. The state is re-checked every
// SandboxTTL; a privileged pod re-checks its RuntimeClass right before it is
// created.

// AnnotationSandbox records the sandbox decision on the pod ("<runtimeClass>"
// or "none: <reason>"), for debugging and lab verification.
const AnnotationSandbox = "labs.cloudtrain.dev/sandbox"

// Fallbacks of a tier whose sandbox is unavailable.
const (
	// SandboxFallbackKubeVirt rewrites the tier's container nodes whose
	// catalog image names a vmFallback to that KubeVirt VM (the default).
	SandboxFallbackKubeVirt = "kubevirt"
	// SandboxFallbackFail keeps the nodes as they are: systemd and privileged
	// images fail, the others run with the default runtime.
	SandboxFallbackFail = "fail"
)

// DefaultSandboxTTL is how long a sandbox availability check is reused.
const DefaultSandboxTTL = 30 * time.Second

// sandboxTiers are the curriculum tiers (content/curriculum.yaml).
var sandboxTiers = map[string]bool{"A": true, "B": true, "C": true, "K": true, "V": true, "N": true}

// SandboxTier is the sandbox of one tier.
type SandboxTier struct {
	// RuntimeClass of the tier's container nodes (kata-deploy:
	// kata-clh-runtime-rs, AKS: kata-vm-isolation, GKE: microvm).
	RuntimeClass string `json:"runtimeClass"`
	// Fallback when the sandbox is unavailable: kubevirt (default) or fail.
	Fallback string `json:"fallback,omitempty"`
	// RequiredFeatures are the guest kernel features labctl preflight must
	// find in the sandbox (dummy, gre, bond, vlan, wireguard, netem, md);
	// empty = all of them.
	RequiredFeatures []string `json:"requiredFeatures,omitempty"`
}

// FallbackMode is the effective fallback (default kubevirt).
func (t SandboxTier) FallbackMode() string {
	if t.Fallback == "" {
		return SandboxFallbackKubeVirt
	}
	return t.Fallback
}

// SandboxConfig is the manager's sandbox configuration (--sandboxes-config,
// the Helm value orchestrator.sandboxes rendered into a ConfigMap).
type SandboxConfig struct {
	APIVersion string                 `json:"apiVersion,omitempty"`
	Kind       string                 `json:"kind,omitempty"`
	Tiers      map[string]SandboxTier `json:"tiers"`
}

// SandboxConfigKind and SandboxPreflightKind are the kinds of the two files.
const (
	SandboxConfigKind    = "SandboxConfig"
	SandboxPreflightKind = "SandboxPreflight"
	SandboxAPIVersion    = "labs.cloudtrain.dev/v1alpha1"
	// SandboxConfigKey and SandboxPreflightKey are their ConfigMap keys.
	SandboxConfigKey    = "sandboxes.yaml"
	SandboxPreflightKey = "preflight.yaml"
)

// ParseSandboxConfig parses a SandboxConfig document, or a ConfigMap holding
// one under sandboxes.yaml.
func ParseSandboxConfig(data []byte) (*SandboxConfig, error) {
	data, err := configMapKey(data, SandboxConfigKey)
	if err != nil {
		return nil, err
	}
	c := &SandboxConfig{}
	if err := yaml.UnmarshalStrict(data, c); err != nil {
		return nil, fmt.Errorf("sandbox config: %w", err)
	}
	if c.Kind != "" && c.Kind != SandboxConfigKind {
		return nil, fmt.Errorf("sandbox config: kind %q, want %s", c.Kind, SandboxConfigKind)
	}
	if err := ValidateSandboxTiers(c.Tiers); err != nil {
		return nil, err
	}
	return c, nil
}

// configMapKey returns data[key] when data is a ConfigMap, else data.
func configMapKey(data []byte, key string) ([]byte, error) {
	var probe struct {
		Kind string            `json:"kind"`
		Data map[string]string `json:"data"`
	}
	if err := yaml.Unmarshal(data, &probe); err != nil || probe.Kind != "ConfigMap" {
		return data, nil //nolint:nilerr // not a ConfigMap: parsed as the document itself
	}
	v, ok := probe.Data[key]
	if !ok {
		return nil, fmt.Errorf("ConfigMap has no %s key", key)
	}
	return []byte(v), nil
}

// ParseSandboxFlag parses --sandboxes: "<tier>=<RuntimeClass>[:kubevirt|:fail]"
// comma separated, e.g. "B=kata-clh-runtime-rs" (fallback kubevirt).
func ParseSandboxFlag(s string) (map[string]SandboxTier, error) {
	out := map[string]SandboxTier{}
	for _, part := range SplitList(s) {
		tier, rest, ok := strings.Cut(part, "=")
		tier, rest = strings.TrimSpace(tier), strings.TrimSpace(rest)
		rc, fb, hasFB := strings.Cut(rest, ":")
		if !ok || tier == "" || rc == "" || (hasFB && fb == "") {
			return nil, fmt.Errorf("sandbox %q: want <tier>=<RuntimeClass>[:kubevirt|:fail]", part)
		}
		if _, dup := out[tier]; dup {
			return nil, fmt.Errorf("sandbox: tier %s mapped twice", tier)
		}
		out[tier] = SandboxTier{RuntimeClass: rc, Fallback: fb}
	}
	if err := ValidateSandboxTiers(out); err != nil {
		return nil, err
	}
	return out, nil
}

// ParseTierRuntimeClasses parses the deprecated prototype flag
// --tier-runtime-classes ("B=kata-clh"): the same as --sandboxes with fallback
// fail, which is what the prototype did.
func ParseTierRuntimeClasses(s string) (map[string]SandboxTier, error) {
	m, err := ParseSandboxFlag(s)
	if err != nil {
		return nil, err
	}
	for t, v := range m {
		if v.Fallback != "" {
			return nil, fmt.Errorf("tier runtime class %s=%s:%s: the prototype flag takes no fallback (use --sandboxes)", t, v.RuntimeClass, v.Fallback)
		}
		v.Fallback = SandboxFallbackFail
		m[t] = v
	}
	return m, nil
}

// ValidateSandboxTiers checks tier names, RuntimeClass names, fallbacks and
// required features.
func ValidateSandboxTiers(tiers map[string]SandboxTier) error {
	known := map[string]bool{}
	for _, f := range SandboxFeatures {
		known[f.Name] = true
	}
	for _, t := range sortedTierKeys(tiers) {
		v := tiers[t]
		if !sandboxTiers[t] {
			return fmt.Errorf("sandbox tier %q: want one of A, B, C, K, V, N", t)
		}
		if errs := validation.IsDNS1123Subdomain(v.RuntimeClass); len(errs) > 0 {
			return fmt.Errorf("sandbox tier %s: RuntimeClass %q: %s", t, v.RuntimeClass, strings.Join(errs, "; "))
		}
		switch v.Fallback {
		case "", SandboxFallbackKubeVirt, SandboxFallbackFail:
		default:
			return fmt.Errorf("sandbox tier %s: fallback %q: want kubevirt or fail", t, v.Fallback)
		}
		for _, f := range v.RequiredFeatures {
			if !known[f] {
				return fmt.Errorf("sandbox tier %s: unknown required feature %q", t, f)
			}
		}
	}
	return nil
}

// SandboxPreflight is labctl preflight's verdict per tier (the ConfigMap the
// manager reads with --sandbox-preflight).
type SandboxPreflight struct {
	APIVersion  string                          `json:"apiVersion,omitempty"`
	Kind        string                          `json:"kind,omitempty"`
	GeneratedAt string                          `json:"generatedAt,omitempty"`
	Tiers       map[string]SandboxPreflightTier `json:"tiers"`
}

// Preflight results of a tier.
const (
	PreflightPass = "pass"
	PreflightFail = "fail"
	// PreflightUnprobed: only the static checks ran (no --probe).
	PreflightUnprobed = "unprobed"
)

// SandboxPreflightTier is the probe result of one tier's RuntimeClass.
type SandboxPreflightTier struct {
	RuntimeClass string `json:"runtimeClass"`
	// Handler the RuntimeClass had when it was probed.
	Handler string `json:"handler,omitempty"`
	Result  string `json:"result"`
	// VM: the probe pod booted its own kernel (not the node's).
	VM      bool     `json:"vm,omitempty"`
	Kernel  string   `json:"kernel,omitempty"`
	Missing []string `json:"missingFeatures,omitempty"`
	Message string   `json:"message,omitempty"`
}

// ParseSandboxPreflight parses a SandboxPreflight document, or a ConfigMap
// holding one under preflight.yaml.
func ParseSandboxPreflight(data []byte) (*SandboxPreflight, error) {
	data, err := configMapKey(data, SandboxPreflightKey)
	if err != nil {
		return nil, err
	}
	p := &SandboxPreflight{}
	if err := yaml.UnmarshalStrict(data, p); err != nil {
		return nil, fmt.Errorf("sandbox preflight: %w", err)
	}
	if p.Kind != "" && p.Kind != SandboxPreflightKind {
		return nil, fmt.Errorf("sandbox preflight: kind %q, want %s", p.Kind, SandboxPreflightKind)
	}
	for t, v := range p.Tiers {
		switch v.Result {
		case PreflightPass, PreflightFail, PreflightUnprobed:
		default:
			return nil, fmt.Errorf("sandbox preflight tier %s: result %q", t, v.Result)
		}
	}
	return p, nil
}

// LoadSandboxFile reads an optional file: a path that does not exist yields
// nil (the ConfigMap is optional), an empty path too.
func LoadSandboxFile(path string) ([]byte, error) {
	if path == "" {
		return nil, nil
	}
	b, err := os.ReadFile(filepath.Clean(path))
	if os.IsNotExist(err) {
		return nil, nil
	}
	return b, err
}

// SandboxFeatures are the lab guest kernel features tier-B content needs
// (docs/kata-spike.md 4.3; the stock Kata kernel has none of them), with the
// shell probe labctl preflight runs in the sandbox.
var SandboxFeatures = []struct{ Name, Script string }{
	{"dummy", "ip link add ctpf-dummy type dummy && ip link del ctpf-dummy"},
	{"gre", "ip link add ctpf-gre type gre remote 192.0.2.1 local 192.0.2.2 && ip link del ctpf-gre"},
	{"bond", "ip link add ctpf-bond type bond && ip link del ctpf-bond"},
	{"vlan", "ip link add ctpf-d0 type dummy && ip link add link ctpf-d0 name ctpf-d0.10 type vlan id 10 && ip link del ctpf-d0"},
	{"wireguard", "ip link add ctpf-wg type wireguard && ip link del ctpf-wg"},
	{"netem", "tc qdisc add dev lo root netem delay 1ms && tc qdisc del dev lo root"},
	{"md", "grep -q raid1 /proc/mdstat"},
}

// ManagedSandboxClasses are the managed providers' Kata RuntimeClasses.
var ManagedSandboxClasses = map[string]string{
	"kata-vm-isolation": "AKS Pod Sandboxing",
	"microvm":           "GKE Sandbox microvm",
}

// IsSandboxRuntimeClass recognises a Kata RuntimeClass by name or handler
// (for reports; the manager trusts the handler only, see vmHandler).
func IsSandboxRuntimeClass(rc nodev1.RuntimeClass) bool {
	if _, ok := ManagedSandboxClasses[rc.Name]; ok {
		return true
	}
	return strings.HasPrefix(rc.Name, "kata") || strings.HasPrefix(rc.Handler, "kata")
}

// vmHandler reports whether rc's handler runs pods in a VM: a Kata handler
// (kata-deploy, AKS), or a handler labctl preflight proved boots its own
// kernel (e.g. GKE microvm). A RuntimeClass is never trusted by its name: a
// "kata-x" RuntimeClass with handler runc is the host kernel.
func vmHandler(rc *nodev1.RuntimeClass, pf *SandboxPreflightTier) (bool, string) {
	if hostHandlers[rc.Handler] {
		return false, fmt.Sprintf("RuntimeClass %s has handler %q, a runtime without its own kernel: never a sandbox for privileged containers", rc.Name, rc.Handler)
	}
	if strings.HasPrefix(rc.Handler, "kata") {
		return true, "handler " + rc.Handler
	}
	if pf != nil && pf.VM && pf.RuntimeClass == rc.Name && pf.Handler == rc.Handler {
		return true, "handler " + rc.Handler + " (preflight: own kernel " + pf.Kernel + ")"
	}
	return false, fmt.Sprintf("RuntimeClass %s has handler %q, not a known VM sandbox (kata*); prove it with labctl preflight --probe and mount the result (--sandbox-preflight)", rc.Name, rc.Handler)
}

// hostHandlers are runtimes that share (runc, crun, youki) or emulate (gVisor)
// the node's kernel: never trusted for privileged containers, whatever a
// preflight file says.
var hostHandlers = map[string]bool{"": true, "runc": true, "crun": true, "youki": true, "runsc": true, "gvisor": true, "runhcs-wcow-process": true}

// SandboxState is the availability of one tier's sandbox.
type SandboxState struct {
	Tier         string
	RuntimeClass string
	Fallback     string
	// Available: the RuntimeClass exists, matches a schedulable node and
	// labctl preflight did not fail it; the tier's unprivileged pods use it.
	Available bool
	// VMTrusted: its handler is a VM sandbox (kata*, or proven by preflight);
	// only then do systemd and privileged images run there.
	VMTrusted bool
	// Transient: the check failed with an API error (not a verdict); the
	// previous state is kept, without one the caller retries.
	Transient bool
	// Reason explains the state (why it is unavailable, or the handler).
	Reason string
}

// Privileged reports whether systemd and privileged images may run in it.
func (st SandboxState) Privileged() bool { return st.Available && st.VMTrusted }

// Sandboxes is the manager's tier sandbox configuration and its availability.
// The zero value and nil are "off": nothing changes.
type Sandboxes struct {
	Tiers     map[string]SandboxTier
	Preflight *SandboxPreflight
	// Reader is an uncached reader (RuntimeClasses, Nodes).
	Reader client.Reader
	// TTL of an availability check (default DefaultSandboxTTL).
	TTL time.Duration
	Log logr.Logger
	Now func() time.Time

	mu      sync.Mutex
	states  map[string]SandboxState
	checked time.Time
}

// Enabled reports whether any tier is configured.
func (s *Sandboxes) Enabled() bool { return s != nil && len(s.Tiers) > 0 }

func (s *Sandboxes) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Sandboxes) preflight(tier string) *SandboxPreflightTier {
	if s.Preflight == nil {
		return nil
	}
	if p, ok := s.Preflight.Tiers[tier]; ok {
		return &p
	}
	return nil
}

// States returns every configured tier's state, re-checked when older than
// the TTL. Changes are logged.
func (s *Sandboxes) States(ctx context.Context) map[string]SandboxState {
	if !s.Enabled() {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ttl := s.TTL
	if ttl <= 0 {
		ttl = DefaultSandboxTTL
	}
	if s.states != nil && s.now().Sub(s.checked) < ttl {
		return s.states
	}
	next := s.check(ctx)
	for t, st := range next {
		prev, seen := s.states[t]
		if st.Transient {
			if seen && !prev.Transient {
				next[t] = prev // an API hiccup is not a verdict
				continue
			}
		}
		if !seen || prev.Available != st.Available || prev.VMTrusted != st.VMTrusted || prev.Reason != st.Reason {
			s.logState(st)
		}
	}
	s.states = next
	allTransient := true
	for _, st := range next {
		allTransient = allTransient && st.Transient
	}
	if !allTransient { // nothing learnt: check again on the next call
		s.checked = s.now()
	}
	return next
}

func (s *Sandboxes) logState(st SandboxState) {
	if st.Available && !st.VMTrusted {
		s.Log.Info("tier sandbox usable for unprivileged pods only: systemd and privileged images fall back or fail", "tier", st.Tier, "runtimeClass", st.RuntimeClass, "fallback", st.Fallback, "reason", st.Reason)
		return
	}
	if st.Available {
		s.Log.Info("tier sandbox available", "tier", st.Tier, "runtimeClass", st.RuntimeClass, "detail", st.Reason)
		return
	}
	then := "systemd and privileged images fail, the others use the default runtime"
	if st.Fallback == SandboxFallbackKubeVirt {
		then = "container nodes with a catalog vmFallback run as KubeVirt VMs; other systemd and privileged images fail"
	}
	s.Log.Info("tier sandbox unavailable: "+then, "tier", st.Tier, "runtimeClass", st.RuntimeClass, "fallback", st.Fallback, "reason", st.Reason)
}

// Check re-checks every tier now (manager startup) and logs each state.
func (s *Sandboxes) Check(ctx context.Context) map[string]SandboxState {
	if !s.Enabled() {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.states, s.checked = s.check(ctx), s.now()
	for _, t := range sortedStateKeys(s.states) {
		s.logState(s.states[t])
	}
	return s.states
}

func (s *Sandboxes) check(ctx context.Context) map[string]SandboxState {
	out := map[string]SandboxState{}
	nodes := &corev1.NodeList{}
	nodeErr := s.Reader.List(ctx, nodes)
	for t, cfg := range s.Tiers {
		st := s.verify(ctx, t, cfg)
		if st.Available {
			switch n := schedulableMatches(nodes.Items, st.selector); {
			case nodeErr != nil:
				st.Available, st.Transient, st.Reason = false, true, "cannot list nodes: "+nodeErr.Error()
			case n == 0:
				st.Available, st.Reason = false, fmt.Sprintf("RuntimeClass %s (%s) matches no schedulable node", cfg.RuntimeClass, st.Reason)
			default:
				st.Reason = fmt.Sprintf("%s, %d schedulable node(s)", st.Reason, n)
			}
		}
		out[t] = st.SandboxState
	}
	return out
}

type verified struct {
	SandboxState
	selector labels.Selector
}

// verify checks the RuntimeClass, its handler and the preflight verdict of
// one tier (no node matching), straight from the API server.
func (s *Sandboxes) verify(ctx context.Context, tier string, cfg SandboxTier) verified {
	st := verified{SandboxState: SandboxState{Tier: tier, RuntimeClass: cfg.RuntimeClass, Fallback: cfg.FallbackMode()}, selector: labels.Everything()}
	rc := &nodev1.RuntimeClass{}
	if err := s.Reader.Get(ctx, client.ObjectKey{Name: cfg.RuntimeClass}, rc); err != nil {
		if apierrors.IsNotFound(err) {
			st.Reason = "RuntimeClass " + cfg.RuntimeClass + " not found"
		} else {
			st.Transient, st.Reason = true, fmt.Sprintf("RuntimeClass %s: %v", cfg.RuntimeClass, err)
		}
		return st
	}
	pf := s.preflight(tier)
	if pf != nil && pf.RuntimeClass == cfg.RuntimeClass && pf.Result == PreflightFail {
		st.Reason = "labctl preflight failed it: " + pf.Message
		return st
	}
	if rc.Scheduling != nil && len(rc.Scheduling.NodeSelector) > 0 {
		st.selector = labels.SelectorFromSet(rc.Scheduling.NodeSelector)
	}
	ok, why := vmHandler(rc, pf)
	st.Available, st.VMTrusted, st.Reason = true, ok, why
	return st
}

// Verify re-checks one tier's RuntimeClass and handler now, bypassing the
// TTL: the last check before a privileged container is created.
func (s *Sandboxes) Verify(ctx context.Context, tier string) SandboxState {
	if !s.Enabled() {
		return SandboxState{Tier: tier, Reason: "no sandboxes configured"}
	}
	cfg, ok := s.Tiers[tier]
	if !ok {
		return SandboxState{Tier: tier, Reason: "no sandbox configured for tier " + tier}
	}
	return s.verify(ctx, tier, cfg).SandboxState
}

func schedulableMatches(nodes []corev1.Node, sel labels.Selector) int {
	n := 0
	for _, node := range nodes {
		if !node.Spec.Unschedulable && sel.Matches(labels.Set(node.Labels)) {
			n++
		}
	}
	return n
}

// FormatSandboxStates renders states for logs ("B=kata-clh(available)").
func FormatSandboxStates(m map[string]SandboxState) string {
	var out []string
	for _, t := range sortedStateKeys(m) {
		st := m[t]
		a := "unavailable"
		switch {
		case st.Privileged():
			a = "available"
		case st.Available:
			a = "available, unprivileged only"
		}
		out = append(out, fmt.Sprintf("%s=%s(%s, fallback %s)", t, st.RuntimeClass, a, st.Fallback))
	}
	return strings.Join(out, ",")
}

func sortedStateKeys(m map[string]SandboxState) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func sortedTierKeys(m map[string]SandboxTier) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// needsPrivilege: the image only works in a privileged container.
func needsPrivilege(img CatalogImage) bool { return img.Systemd || img.Privileged }

// applySandbox sets the tier's RuntimeClass on a container node's pod and,
// for systemd and privileged images inside a sandbox, makes the node
// container privileged. It fails such an image that would otherwise run on
// the host kernel. It returns the tier whose sandbox a privileged container
// was granted ("" if none): the caller re-verifies it before creating the pod.
func (d *ContainerDriver) applySandbox(ctx context.Context, ref NodeRef, pod *corev1.Pod) (string, error) {
	if d.Catalog == nil {
		return "", nil
	}
	img, err := d.Catalog.Resolve(ref.Node.Image, ImageKindContainer)
	if err != nil {
		return "", nil
	}
	priv := needsPrivilege(img)
	refuse := func(why string) error {
		return fmt.Errorf("node %s: image %s needs a privileged container, which runs only inside a sandbox RuntimeClass (manager --sandboxes, e.g. %s=kata-clh-runtime-rs); %s; without one run it as a KubeVirt VM: %w",
			ref.Node.Name, ref.Node.Image, img.Tier, why, ErrUnsupported)
	}
	cfg, configured := SandboxTier{}, false
	if d.Sandboxes.Enabled() {
		cfg, configured = d.Sandboxes.Tiers[img.Tier]
	}
	if !configured {
		if priv {
			return "", refuse(fmt.Sprintf("no sandbox is configured for tier %q", img.Tier))
		}
		if d.Sandboxes.Enabled() {
			setAnnotation(pod, AnnotationSandbox, "none: no sandbox for tier "+img.Tier)
		}
		return "", nil
	}
	st := d.Sandboxes.States(ctx)[img.Tier]
	if st.Transient {
		return "", fmt.Errorf("node %s: tier %s sandbox: %s", ref.Node.Name, img.Tier, st.Reason)
	}
	if priv && !st.Privileged() {
		return "", refuse(fmt.Sprintf("the tier %s sandbox is unavailable for privileged containers (%s)", img.Tier, st.Reason))
	}
	if !st.Available {
		setAnnotation(pod, AnnotationSandbox, "none: "+st.Reason)
		return "", nil
	}
	pod.Spec.RuntimeClassName = ptr.To(cfg.RuntimeClass)
	setAnnotation(pod, AnnotationSandbox, cfg.RuntimeClass)
	if !priv {
		return "", nil
	}
	for i := range pod.Spec.Containers {
		c := &pod.Spec.Containers[i]
		if c.Name != ContainerName {
			continue
		}
		if c.SecurityContext == nil {
			c.SecurityContext = &corev1.SecurityContext{}
		}
		c.SecurityContext.Privileged = ptr.To(true)
		if img.Systemd {
			// Ready = systemd finished booting, so setup never races it
			// ("System has not been booted with systemd as init system").
			c.ReadinessProbe = systemdReadiness()
		}
	}
	return img.Tier, nil
}

func setAnnotation(pod *corev1.Pod, k, v string) {
	if pod.Annotations == nil {
		pod.Annotations = map[string]string{}
	}
	pod.Annotations[k] = v
}

// systemdReadiness is the readiness probe of systemd nodes: the system
// reached running (or degraded: some unit failed, which labs may cause).
func systemdReadiness() *corev1.Probe {
	return &corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{Exec: &corev1.ExecAction{Command: []string{
			"sh", "-c", `s=$(systemctl is-system-running 2>/dev/null); [ "$s" = running ] || [ "$s" = degraded ]`,
		}}},
		PeriodSeconds:    1,
		TimeoutSeconds:   5,
		FailureThreshold: 3,
	}
}

// SandboxNode is the sandbox decision for one container node of a
// configured tier.
type SandboxNode struct {
	Node, Tier, RuntimeClass string
	// Substrate: "sandbox" (RuntimeClass), "vm" (rewritten to VMImage) or
	// "none" (sandbox unavailable, node unchanged).
	Substrate string
	Image     string
	VMImage   string
	Reason    string
}

// Substrates of SandboxNode.
const (
	SubstrateSandbox = "sandbox"
	SubstrateVM      = "vm"
	SubstrateNone    = "none"
)

// PlanSandboxes applies the vmFallback rewrite to a resolved template (in
// place) and reports the sandbox decision of every container node of a
// configured tier. A container node becomes its catalog vmFallback VM
// (driver vm, the twin image, the same cpu and memory with the VM minimum,
// access ssh + console as on the lab VMs) when its tier's sandbox cannot run
// it (unavailable, or a systemd/privileged image and a handler that is not a
// trusted VM) and the tier's fallback is kubevirt.
//
// recorded is the session's status.topology: a node keeps the substrate it was
// first provisioned on, so a sandbox (or a manager configuration) that comes
// or goes never swaps a running node; a recorded VM twin stays one even with
// sandboxes off or a changed catalog.
//
// Not rewritten (they keep failing or running as before): the entry node,
// nodes on topology links (VMs take none), nodes with web access, images
// without vmFallback, and every node when another non-entry container node of
// the session stays a pod (pods reach each other as lab peers, a VM is not
// one). With sandboxes off and nothing recorded it does nothing.
//
// A transient API error yields an error that is not ErrUnsupported: retry.
func (s *Sandboxes) PlanSandboxes(ctx context.Context, cat *ImageCatalog, spec *labsv1.LabTemplateSpec, recorded *labsv1.Topology) ([]SandboxNode, error) {
	if spec == nil {
		return nil, nil
	}
	rec := map[string]labsv1.Node{}
	if recorded != nil {
		for _, n := range recorded.Nodes {
			rec[n.Name] = n
		}
	}
	// Recorded VM twins first, whatever the configuration is now.
	stuck := map[string]string{} // node -> its template image
	for i := range spec.Topology.Nodes {
		n := &spec.Topology.Nodes[i]
		if r, ok := rec[n.Name]; ok && n.Driver == labsv1.DriverContainer && r.Driver == labsv1.DriverVM {
			stuck[n.Name] = n.Image
			*n = *r.DeepCopy()
		}
	}
	if !s.Enabled() || cat == nil {
		var out []SandboxNode
		for name := range stuck {
			out = append(out, SandboxNode{Node: name, Substrate: SubstrateVM, VMImage: rec[name].Image, Reason: "provisioned as the VM fallback"})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Node < out[j].Node })
		return out, nil
	}
	states := s.States(ctx)
	type cand struct {
		i    int
		dec  SandboxNode
		want bool // the sandbox cannot run it and the fallback is kubevirt
		twin bool
		why  string
	}
	var cands []cand
	blocker := "" // a non-entry container node that cannot become a VM
	for i := range spec.Topology.Nodes {
		n := &spec.Topology.Nodes[i]
		if orig, ok := stuck[n.Name]; ok {
			dec := SandboxNode{Node: n.Name, Substrate: SubstrateVM, Image: orig, VMImage: n.Image, Reason: "provisioned as the VM fallback"}
			if img, err := cat.Resolve(orig, ImageKindContainer); err == nil {
				if cfg, ok := s.Tiers[img.Tier]; ok {
					st := states[img.Tier]
					dec.Tier, dec.RuntimeClass = img.Tier, cfg.RuntimeClass
					if st.Privileged() {
						dec.Reason = "provisioned as the VM fallback; the sandbox is available again, the session keeps its VM"
					} else {
						dec.Reason = st.Reason
					}
				}
			}
			cands = append(cands, cand{i: i, dec: dec})
			continue
		}
		if n.Driver != labsv1.DriverContainer {
			continue
		}
		img, err := cat.Resolve(n.Image, ImageKindContainer)
		cfg, configured := SandboxTier{}, false
		if err == nil {
			cfg, configured = s.Tiers[img.Tier]
		}
		if !configured {
			if n.Name != spec.Topology.Entry && blocker == "" {
				blocker = n.Name
			}
			continue
		}
		st := states[img.Tier]
		if st.Transient {
			return nil, fmt.Errorf("tier %s sandbox: %s", img.Tier, st.Reason)
		}
		ok := st.Available && (!needsPrivilege(img) || st.VMTrusted)
		c := cand{i: i, dec: SandboxNode{Node: n.Name, Tier: img.Tier, RuntimeClass: cfg.RuntimeClass, Image: n.Image, VMImage: img.VMFallback, Reason: st.Reason}}
		c.twin, c.why = vmTwinEligible(spec, n, img)
		r, wasRecorded := rec[n.Name]
		switch {
		case wasRecorded && r.Driver == labsv1.DriverContainer:
			// Provisioned as a pod: it stays one.
		case ok:
		case st.Fallback == SandboxFallbackKubeVirt:
			c.want = true
		}
		// All or nothing: every non-entry pod of the session must become a
		// VM, or none does.
		if !(c.want && c.twin) && n.Name != spec.Topology.Entry && blocker == "" {
			blocker = n.Name
		}
		if ok && !c.want {
			c.dec.Substrate = SubstrateSandbox
		} else {
			c.dec.Substrate = SubstrateNone
		}
		cands = append(cands, c)
	}
	var out []SandboxNode
	for _, c := range cands {
		n := &spec.Topology.Nodes[c.i]
		if c.want && c.twin && blocker == "" {
			if _, err := cat.Resolve(c.dec.VMImage, ImageKindContainerDisk); err != nil {
				return nil, fmt.Errorf("node %s: vmFallback of %s: %w", n.Name, n.Image, err)
			}
			n.Driver, n.Image = labsv1.DriverVM, c.dec.VMImage
			n.Resources = vmTwinResources(n.Resources)
			n.Access = []labsv1.AccessType{labsv1.AccessSSH, labsv1.AccessConsole}
			c.dec.Substrate = SubstrateVM
		} else if c.want {
			why := c.why
			if c.twin {
				why = "node " + blocker + " stays a pod and would lose its lab-peer path"
			}
			c.dec.Reason += "; no VM fallback: " + why
		}
		out = append(out, c.dec)
	}
	return out, nil
}

// vmTwinEligible reports whether a container node can become its VM twin
// without changing the lab.
func vmTwinEligible(spec *labsv1.LabTemplateSpec, n *labsv1.Node, img CatalogImage) (bool, string) {
	switch {
	case img.VMFallback == "":
		return false, "image " + n.Image + " has no catalog vmFallback"
	case n.Name == spec.Topology.Entry:
		return false, "it is the entry node"
	case n.LearnerSudo:
		return false, "it sets learnerSudo"
	}
	for _, l := range spec.Topology.Links {
		for _, ep := range []string{l.A, l.B} {
			if node, _, _ := strings.Cut(ep, ":"); node == n.Name {
				return false, "it is on a topology link (VMs take none)"
			}
		}
	}
	for _, a := range n.Access {
		if a != labsv1.AccessSSH && a != labsv1.AccessShell && a != labsv1.AccessConsole {
			return false, fmt.Sprintf("it has %s access (a VM serves ssh and console)", a)
		}
	}
	return true, ""
}

// vmTwinResources: the node's cpu and memory, at least the VM minimum
// memory (nil keeps the VM defaults).
func vmTwinResources(r *labsv1.NodeResources) *labsv1.NodeResources {
	if r == nil {
		return nil
	}
	out := r.DeepCopy()
	out.Disks = nil
	if out.MemoryMiB != nil && *out.MemoryMiB < defaultVMMemMiB {
		out.MemoryMiB = ptr.To(int64(defaultVMMemMiB))
	}
	return out
}
