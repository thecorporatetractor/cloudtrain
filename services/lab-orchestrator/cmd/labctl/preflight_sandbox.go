package main

// labctl preflight, sandbox section (docs/kata-spike.md, section 6.3): can tier-B
// images run in a Kata sandbox on this cluster?
//
//   - static: the Kata RuntimeClasses (kata-deploy's kata-*, AKS kata-vm-isolation,
//     GKE microvm), and for every tier of the manager's sandboxes (--sandboxes,
//     --sandboxes-config) the check the manager runs (RuntimeClass exists, its
//     handler is a VM sandbox, its node selector matches a schedulable node);
//   - with --probe: a throwaway pod per sandbox RuntimeClass that must boot its own
//     kernel (not the node's) and have the lab kernel features built in (dummy, GRE,
//     bond, VLAN, WireGuard, netem, md raid1); the guest memory against the pod
//     limit (runtime-rs sizes the VM to the limit, the Go runtime adds 2 GiB); a
//     session network with a runc pod and a sandboxed pod on one lab link (the
//     orchestrator's Multus/Kube-OVN attachment): link MTU and 1400-byte frames with
//     DF both ways, and on eth0;
//   - with --probe and --systemd-image: a tier-B systemd pod boots to running and
//     `kubectl exec` works (the exec EBUSY regression of section 4.2).
//
// --sandbox-configmap writes the verdict per tier as the ConfigMap the manager
// reads (--sandbox-preflight): a tier that failed is unavailable there (its
// labs fall back to KubeVirt), and a non-Kata handler the probe proved a VM is
// trusted.
//
// Without Kata, tier B runs as KubeVirt VMs, so a cluster with no sandbox only
// warns; a tier the manager is told to sandbox but cannot is a failure.

import (
	"context"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

func (r *pfReport) addSandbox(name, status, msg, fix string) {
	r.Checks = append(r.Checks, pfCheck{Name: "sandbox/" + name, Status: status, Message: msg, Fix: fix})
}

// sandboxProbeScript prints "kernel <release>", "memkb <MemTotal>" and
// "feature <name> ok|missing" lines.
func sandboxProbeScript() string {
	var b strings.Builder
	b.WriteString("echo kernel $(uname -r)\necho bootid $(cat /proc/sys/kernel/random/boot_id)\necho memkb $(awk '/^MemTotal:/{print $2}' /proc/meminfo)\n")
	for _, f := range drivers.SandboxFeatures {
		fmt.Fprintf(&b, "if ( %s ) >/dev/null 2>&1; then echo feature %s ok; else echo feature %s missing; fi\n", f.Script, f.Name, f.Name)
	}
	return b.String()
}

// sandboxProbeLimit is the probe pod's memory limit (the guest size on runtime-rs).
const sandboxProbeLimit = 512 << 20

// rcVerdict is what the probes found about one RuntimeClass.
type rcVerdict struct {
	handler string
	probed  bool
	vm      bool
	kernel  string
	missing []string
	// failed are the failed probe checks (beyond the feature list, which is
	// judged per tier).
	failed []string
}

// tierStatic is the static verdict of one tier.
type tierStatic struct {
	rc     string
	failed string // empty: passed or only unproven
	probe  bool
}

// sandboxStatic reports the Kata RuntimeClasses and the manager's tiers. It
// returns the RuntimeClasses to probe (the tiers' ones, else every Kata one)
// and the static verdict per tier.
func sandboxStatic(rcs []nodev1.RuntimeClass, tiers map[string]drivers.SandboxTier, states map[string]drivers.SandboxState, rep *pfReport) ([]string, map[string]tierStatic) {
	var kata []string
	byName := map[string]nodev1.RuntimeClass{}
	for _, rc := range rcs {
		byName[rc.Name] = rc
		if drivers.IsSandboxRuntimeClass(rc) {
			kata = append(kata, rc.Name)
		}
	}
	sort.Strings(kata)
	if len(kata) == 0 {
		rep.addSandbox("runtimeclasses", pfWarn, "no Kata RuntimeClass: tier-B systemd images cannot run, tier-B labs run as KubeVirt VMs",
			"install kata-deploy (kind: KIND_PROFILE=kata) or enable the provider's sandbox (AKS Pod Sandboxing, GKE microvm)")
	} else {
		var desc []string
		for _, rc := range rcs {
			if !drivers.IsSandboxRuntimeClass(rc) {
				continue
			}
			d := rc.Name
			if rc.Handler != rc.Name {
				d += " (handler " + rc.Handler + ")"
			}
			if p, ok := drivers.ManagedSandboxClasses[rc.Name]; ok {
				d += " [" + p + "]"
			}
			desc = append(desc, d)
		}
		sort.Strings(desc)
		rep.addSandbox("runtimeclasses", pfPass, strings.Join(desc, ", "), "")
	}
	verdicts := map[string]tierStatic{}
	if len(tiers) == 0 {
		if len(kata) > 0 {
			rep.addSandbox("tiers", pfWarn, "no tier sandboxed: tier-B container nodes run without a sandbox (systemd images are refused)",
				"deploy the orchestrator with --sandboxes B="+kata[0]+" (Helm orchestrator.sandboxes), and pass the same here")
		}
		return kata, verdicts
	}
	var probe []string
	for _, t := range sortedTierKeys(tiers) {
		cfg, st := tiers[t], states[t]
		v := tierStatic{rc: cfg.RuntimeClass}
		rc, exists := byName[cfg.RuntimeClass]
		switch {
		case st.Available:
			rep.addSandbox("tier-"+t, pfPass, fmt.Sprintf("tier %s -> RuntimeClass %s: %s (fallback %s)", t, cfg.RuntimeClass, st.Reason, cfg.FallbackMode()), "")
			v.probe = true
		case exists && !strings.HasPrefix(rc.Handler, "kata"):
			// Not a Kata handler: the manager trusts it only once a probe
			// proved it boots its own kernel.
			rep.addSandbox("tier-"+t, pfWarn, st.Reason, "run with --probe and --sandbox-configmap, and mount the result into the manager (Helm: the "+sandboxPreflightDefault+" ConfigMap)")
			v.probe = true
		default:
			v.failed = st.Reason
			rep.addSandbox("tier-"+t, pfFail, st.Reason, "install the sandbox runtime on the lab nodes (kata-deploy labels them katacontainers.io/kata-runtime=true) or drop tier "+t+" from the sandboxes; until then its labs "+fallbackText(cfg))
		}
		if v.probe {
			probe = append(probe, cfg.RuntimeClass)
		}
		verdicts[t] = v
	}
	return dedupe(probe), verdicts
}

func fallbackText(cfg drivers.SandboxTier) string {
	if cfg.FallbackMode() == drivers.SandboxFallbackKubeVirt {
		return "run as KubeVirt VMs where the catalog has a vmFallback"
	}
	return "with systemd images fail (fallback fail)"
}

func sortedTierKeys(m map[string]drivers.SandboxTier) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// probeOut is the parsed output of the feature probe.
type probeOut struct {
	vm          bool
	kernel      string
	ok, missing []string
}

// sandboxProbeResult turns the probe output into checks. required are the
// features the tiers mapped to rc need (nil: rc is not mapped, so missing
// features only warn).
func sandboxProbeResult(rc string, node corev1.NodeSystemInfo, out string, limit int64, required []string, rep *pfReport) probeOut {
	var res probeOut
	var memKB int64
	var bootID string
	nodeKernel := node.KernelVersion
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Fields(line)
		switch {
		case len(f) == 2 && f[0] == "kernel":
			res.kernel = f[1]
		case len(f) == 2 && f[0] == "bootid":
			bootID = f[1]
		case len(f) == 2 && f[0] == "memkb":
			memKB, _ = strconv.ParseInt(f[1], 10, 64)
		case len(f) == 3 && f[0] == "feature" && f[2] == "ok":
			res.ok = append(res.ok, f[1])
		case len(f) == 3 && f[0] == "feature":
			res.missing = append(res.missing, f[1])
		}
	}
	name := "probe " + rc
	switch {
	case res.kernel == "":
		rep.addSandbox(name, pfFail, "no output from the probe pod", "")
		return res
	case nodeKernel == "":
		rep.addSandbox(name, pfFail, "the node reports no kernel version: cannot tell a VM sandbox from the host kernel", "")
		return res
	case res.kernel == nodeKernel:
		rep.addSandbox(name, pfFail, "the pod runs on the node's kernel "+res.kernel+": not a VM sandbox", "check the RuntimeClass handler (kata-deploy's containerd config)")
		return res
	case bootID != "" && bootID == node.BootID:
		rep.addSandbox(name, pfFail, "the pod sees the node's boot id: not a VM sandbox", "check the RuntimeClass handler")
		return res
	}
	res.vm = true
	rep.addSandbox(name, pfPass, fmt.Sprintf("own guest kernel %s (node %s)", res.kernel, nodeKernel), "")
	if len(res.missing) > 0 {
		st := pfWarn
		if len(intersect(res.missing, required)) > 0 {
			st = pfFail
		}
		rep.addSandbox(name+" features", st, fmt.Sprintf("guest kernel %s lacks %s (has %s)", res.kernel, strings.Join(res.missing, ", "), strings.Join(res.ok, ", ")),
			"use the CloudTrain lab guest kernel (tools/images/kata-kernel; kind: KIND_PROFILE=kata installs it); on AKS/GKE the guest kernel is the provider's, so labs that need these stay on KubeVirt")
	} else {
		rep.addSandbox(name+" features", pfPass, "lab kernel features built in: "+strings.Join(res.ok, ", "), "")
	}
	if memKB > 0 && limit > 0 {
		mib, lim := memKB/1024, limit>>20
		if mib > lim+1024 {
			rep.addSandbox(name+" memory", pfWarn, fmt.Sprintf("guest has %d MiB for a %d MiB pod limit: VM not sized to the limit (Go runtime: 2 GiB + limit, VMM outside the pod cgroup)", mib, lim),
				"use the runtime-rs shim (kata-clh-runtime-rs), which sizes the VM to the pod limit")
		} else {
			rep.addSandbox(name+" memory", pfPass, fmt.Sprintf("guest %d MiB for a %d MiB pod limit", mib, lim), "")
		}
	}
	return res
}

func intersect(a, b []string) []string {
	in := map[string]bool{}
	for _, s := range b {
		in[s] = true
	}
	var out []string
	for _, s := range a {
		if in[s] {
			out = append(out, s)
		}
	}
	return out
}

// requiredFeatures of a tier (empty = all).
func requiredFeatures(cfg drivers.SandboxTier) []string {
	if len(cfg.RequiredFeatures) > 0 {
		return cfg.RequiredFeatures
	}
	var all []string
	for _, f := range drivers.SandboxFeatures {
		all = append(all, f.Name)
	}
	return all
}

type sandboxProbe struct {
	c            client.Client
	ex           drivers.PodExecutor
	toolsImage   string
	systemdImage string
	timeout      time.Duration
	mode         network.Mode
	mtu          int
	logf         func(string, ...any)
}

// runSandboxPreflight adds the sandbox section to rep and returns the
// verdict per configured tier (nil without tiers).
func runSandboxPreflight(ctx context.Context, c client.Client, ex drivers.PodExecutor, o preflightOpts, mode network.Mode, nodes []corev1.Node, rep *pfReport, logf func(string, ...any)) *drivers.SandboxPreflight {
	rcl := &nodev1.RuntimeClassList{}
	if err := c.List(ctx, rcl); err != nil {
		rep.addSandbox("runtimeclasses", pfFail, "list RuntimeClasses: "+err.Error(), "")
		return nil
	}
	var states map[string]drivers.SandboxState
	if len(o.tiers) > 0 {
		states = (&drivers.Sandboxes{Tiers: o.tiers, Reader: c}).Check(ctx)
	}
	targets, static := sandboxStatic(rcl.Items, o.tiers, states, rep)
	handlers := map[string]string{}
	for _, rc := range rcl.Items {
		handlers[rc.Name] = rc.Handler
	}
	verdicts := map[string]*rcVerdict{}
	if !o.probe || len(targets) == 0 {
		if len(targets) > 0 {
			rep.addSandbox("probe", pfWarn, "not run: guest kernel, lab kernel features, lab link and systemd unchecked", "re-run with --probe")
		}
	} else {
		required := map[string][]string{}
		for _, cfg := range o.tiers {
			required[cfg.RuntimeClass] = append(required[cfg.RuntimeClass], requiredFeatures(cfg)...)
		}
		kernels := map[string]corev1.NodeSystemInfo{}
		for _, n := range nodes {
			kernels[n.Name] = n.Status.NodeInfo
		}
		p := &sandboxProbe{c: c, ex: ex, toolsImage: o.toolsImage, systemdImage: o.systemdImage, timeout: o.timeout, mode: mode, mtu: o.mtu, logf: logf}
		for _, rc := range targets {
			v := p.run(ctx, rc, required[rc], kernels, rep)
			v.handler = handlers[rc]
			verdicts[rc] = v
		}
	}
	if len(o.tiers) == 0 {
		return nil
	}
	out := &drivers.SandboxPreflight{APIVersion: drivers.SandboxAPIVersion, Kind: drivers.SandboxPreflightKind,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339), Tiers: map[string]drivers.SandboxPreflightTier{}}
	for t, cfg := range o.tiers {
		out.Tiers[t] = tierVerdict(cfg, static[t], verdicts[cfg.RuntimeClass], handlers[cfg.RuntimeClass])
	}
	return out
}

// tierVerdict combines the static and probe results of one tier.
func tierVerdict(cfg drivers.SandboxTier, st tierStatic, v *rcVerdict, handler string) drivers.SandboxPreflightTier {
	r := drivers.SandboxPreflightTier{RuntimeClass: cfg.RuntimeClass, Handler: handler}
	var fails []string
	if st.failed != "" {
		fails = append(fails, st.failed)
	}
	if v != nil && v.probed {
		r.VM, r.Kernel, r.Missing = v.vm, v.kernel, v.missing
		if !v.vm {
			fails = append(fails, "the probe pod did not boot its own kernel")
		}
		if m := intersect(v.missing, requiredFeatures(cfg)); len(m) > 0 {
			fails = append(fails, "guest kernel lacks "+strings.Join(m, ", "))
		}
		fails = append(fails, v.failed...)
	}
	switch {
	case len(fails) > 0:
		r.Result, r.Message = drivers.PreflightFail, strings.Join(fails, "; ")
	case v == nil || !v.probed:
		r.Result, r.Message = drivers.PreflightUnprobed, "static checks only (no --probe)"
	default:
		r.Result, r.Message = drivers.PreflightPass, "own kernel "+v.kernel+", lab features, link and systemd probes passed"
	}
	return r
}

func (p *sandboxProbe) run(ctx context.Context, rc string, required []string, kernels map[string]corev1.NodeSystemInfo, rep *pfReport) *rcVerdict {
	v := &rcVerdict{probed: true}
	fail := func(name, msg, fix string) {
		rep.addSandbox(name, pfFail, msg, fix)
		v.failed = append(v.failed, name+": "+msg)
	}
	ns := "ct-preflight-sb-" + randSuffix()
	nsObj := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns, Labels: sessionNamespaceLabels(map[string]string{"labs.cloudtrain.dev/preflight": "true"})}}
	if err := p.c.Create(ctx, nsObj); err != nil {
		fail("probe "+rc, "create namespace: "+err.Error(), "")
		return v
	}
	defer func() {
		dctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		_ = p.c.DeleteAllOf(dctx, &corev1.Pod{}, client.InNamespace(ns), client.GracePeriodSeconds(0))
		if err := p.c.Delete(dctx, nsObj); err != nil {
			p.logf("delete namespace %s: %v", ns, err)
		}
	}()
	pctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	p.logf("sandbox probe of RuntimeClass %s in %s", rc, ns)
	pod := sandboxPod(ns, "features", rc, p.toolsImage, false)
	pod.Spec.Containers[0].Command = []string{"sleep", "3600"}
	pod.Spec.Containers[0].SecurityContext = &corev1.SecurityContext{Capabilities: &corev1.Capabilities{Add: []corev1.Capability{"NET_ADMIN"}}}
	if err := p.start(pctx, pod); err != nil {
		fail("probe "+rc, err.Error(), "check the RuntimeClass handler and the kata-deploy pods on "+pod.Spec.NodeName)
		return v
	}
	out, err := p.exec(pctx, pod, sandboxProbeScript())
	if err != nil {
		fail("probe "+rc, "exec: "+err.Error(), "")
		return v
	}
	res := sandboxProbeResult(rc, kernels[pod.Spec.NodeName], out, sandboxProbeLimit, required, rep)
	v.vm, v.kernel, v.missing = res.vm, res.kernel, res.missing
	if !res.vm {
		return v // never start a privileged pod outside a VM
	}
	p.link(pctx, ns, rc, v, rep)
	if p.systemdImage == "" {
		rep.addSandbox("probe "+rc+" systemd", pfWarn, "not run: systemd boot and exec in a tier-B pod unchecked", "re-run with --systemd-image cloudtrain/deb-sys:24.04 (on the nodes)")
		return v
	}
	sd := sandboxPod(ns, "systemd", rc, p.systemdImage, true)
	if err := p.start(pctx, sd); err != nil {
		fail("probe "+rc+" systemd", err.Error(), "")
		return v
	}
	var state string
	err = waitFor(pctx, 2*time.Second, func() (bool, error) {
		s, err := p.exec(pctx, sd, "systemctl is-system-running 2>/dev/null || true")
		state = strings.TrimSpace(s)
		if err != nil && strings.Contains(err.Error(), "busy") {
			return false, err
		}
		return state == "running" || state == "degraded", nil
	})
	switch {
	case err != nil && strings.Contains(err.Error(), "busy"):
		fail("probe "+rc+" systemd", "kubectl exec into the systemd pod fails with EBUSY: "+firstLine(err.Error()),
			"the image needs the empty init leaf cgroup (tools/images/linux-pod/sys/ct-sysinit), or the Kata agent changed")
	case err != nil:
		fail("probe "+rc+" systemd", fmt.Sprintf("systemd did not reach running (last state %q): %v", state, err), "check the image's entrypoint and journal")
	default:
		rep.addSandbox("probe "+rc+" systemd", pfPass, fmt.Sprintf("%s boots systemd to %s, kubectl exec works", p.systemdImage, state), "")
	}
	return v
}

// link wires a runc pod and a sandboxed pod into a throwaway session network
// with the orchestrator's code (Kube-OVN segments, the Multus attachment of a
// lab link) and checks the sandbox's link MTU and full-size frames with DF in
// both directions, on the link and on eth0 (docs/kata-spike.md 4.4).
func (p *sandboxProbe) link(ctx context.Context, ns, rc string, v *rcVerdict, rep *pfReport) {
	name := "probe " + rc + " link"
	fail := func(msg, fix string) {
		rep.addSandbox(name, pfFail, msg, fix)
		v.failed = append(v.failed, name+": "+msg)
	}
	sess := network.Session{Namespace: ns, Name: "preflight-sandbox", UID: types.UID("preflight-sb-" + randSuffix())}
	plan, err := network.BuildWith(sess, probeTopology(), network.Options{Mode: p.mode, MTU: p.mtu})
	if err != nil {
		fail(err.Error(), "")
		return
	}
	mgr := &network.Manager{Client: p.c}
	defer func() {
		dctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		_ = p.c.DeleteAllOf(dctx, &corev1.Pod{}, client.InNamespace(ns), client.MatchingLabels{network.LabelSessionUID: string(sess.UID)}, client.GracePeriodSeconds(0))
		if err := waitFor(dctx, 2*time.Second, func() (bool, error) { return mgr.Delete(dctx, sess) }); err != nil {
			p.logf("cleanup of the sandbox probe network in %s: %v", ns, err)
		}
	}()
	if err := waitFor(ctx, 2*time.Second, func() (bool, error) { return mgr.Ensure(ctx, plan) }); err != nil {
		fail("session VPC/subnets not Ready: "+err.Error(), "check kube-ovn-controller logs")
		return
	}
	pods := map[string]*corev1.Pod{}
	for _, n := range []string{"a", "b"} {
		runtimeClass := ""
		if n == "b" {
			runtimeClass = rc
		}
		pod := sandboxPod(ns, "link-"+n, runtimeClass, p.toolsImage, false)
		pod.Labels[network.LabelSessionUID] = string(sess.UID)
		pod.Labels[network.LabelManagedBy] = network.ManagedBy
		pod.Spec.Containers[0].Command = []string{"sleep", "3600"}
		if err := plan.DecoratePod(n, pod, "node", network.PodOptions{ToolsImage: p.toolsImage}); err != nil {
			fail(err.Error(), "")
			return
		}
		if err := p.start(ctx, pod); err != nil {
			fail(err.Error(), "check Multus and kube-ovn-cni logs on "+pod.Spec.NodeName)
			return
		}
		pods[n] = pod
	}
	a, b := pods["a"], pods["b"]
	size := p.mtu
	if size == 0 {
		size = network.DefaultLinkMTU
	}
	if p.mtu > 0 {
		out, err := p.exec(ctx, b, "cat /sys/class/net/eth1/mtu")
		if got := strings.TrimSpace(out); err != nil || got != strconv.Itoa(p.mtu) {
			fail(fmt.Sprintf("the sandbox's link eth1 has MTU %q, want %d (%v)", got, p.mtu, err), "Kata's tcfilter mirrors the CNI interface's MTU into the guest: check the kata-agent and the NAD")
			return
		}
	}
	payload := strconv.Itoa(size - 28)
	linkA := plan.Links[0].Ends[0].Address.Addr().String()
	linkB := plan.Links[0].Ends[1].Address.Addr().String()
	where := fmt.Sprintf("runc on %s <-> %s on %s", a.Spec.NodeName, rc, b.Spec.NodeName)
	checks := []struct {
		from     *corev1.Pod
		to, what string
	}{
		{b, linkA, "sandbox -> runc over the lab link"},
		{a, linkB, "runc -> sandbox over the lab link"},
		{b, a.Status.PodIP, "sandbox -> runc on eth0"},
	}
	for _, c := range checks {
		if _, err := p.exec(ctx, c.from, "ping -c 3 -W 2 -M do -s "+payload+" "+c.to); err != nil {
			fail(fmt.Sprintf("%d-byte frames with DF %s fail (%s): %v", size, c.what, where, err), "underlay MTU must be >= link MTU + 100 (geneve); Kata tcfilter must carry full-size frames")
			return
		}
	}
	rep.addSandbox(name, pfPass, fmt.Sprintf("lab link eth1 MTU %d in the sandbox; %d-byte frames with DF both ways over the link and on eth0 (%s)", size, size, where), "")
}

// sandboxPod is a probe pod, in RuntimeClass rc unless rc is empty. A systemd
// pod is privileged (inside the guest VM only: the caller has checked the
// sandbox is a VM).
func sandboxPod(ns, name, rc, image string, systemd bool) *corev1.Pod {
	lim := corev1.ResourceList{corev1.ResourceMemory: *resource.NewQuantity(sandboxProbeLimit, resource.BinarySI), corev1.ResourceCPU: resource.MustParse("1")}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: map[string]string{"labs.cloudtrain.dev/preflight": "true"}},
		Spec: corev1.PodSpec{
			AutomountServiceAccountToken:  ptr.To(false),
			RestartPolicy:                 corev1.RestartPolicyNever,
			TerminationGracePeriodSeconds: ptr.To(int64(1)),
			Containers: []corev1.Container{{
				Name: "node", Image: image, ImagePullPolicy: corev1.PullIfNotPresent,
				Resources: corev1.ResourceRequirements{Limits: lim, Requests: lim},
			}},
		},
	}
	if rc != "" {
		pod.Spec.RuntimeClassName = ptr.To(rc)
	}
	if systemd {
		if rc == "" {
			panic("sandboxPod: a privileged probe pod needs a sandbox RuntimeClass")
		}
		pod.Spec.Containers[0].SecurityContext = &corev1.SecurityContext{Privileged: ptr.To(true)}
	}
	return pod
}

func (p *sandboxProbe) start(ctx context.Context, pod *corev1.Pod) error {
	if err := p.c.Create(ctx, pod); err != nil {
		return fmt.Errorf("create pod %s: %w", pod.Name, err)
	}
	err := waitFor(ctx, 2*time.Second, func() (bool, error) {
		if err := p.c.Get(ctx, client.ObjectKeyFromObject(pod), pod); err != nil {
			return false, err
		}
		if pod.Status.Phase == corev1.PodFailed || pod.Status.Phase == corev1.PodSucceeded {
			return false, fmt.Errorf("pod %s %s", pod.Name, pod.Status.Phase)
		}
		return pod.Status.Phase == corev1.PodRunning && pod.Status.PodIP != "", nil
	})
	if err != nil {
		return fmt.Errorf("pod %s not running in RuntimeClass %s: %v (%s)", pod.Name, ptr.Deref(pod.Spec.RuntimeClassName, "default"), err, podEvents(ctx, p.c, pod))
	}
	return nil
}

func (p *sandboxProbe) exec(ctx context.Context, pod *corev1.Pod, script string) (string, error) {
	return (&netProbe{ex: p.ex}).exec(ctx, pod, script)
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// sandboxPreflightDefault is the ConfigMap the manager mounts for
// --sandbox-preflight (the kind deploy and the Helm chart's default name).
const sandboxPreflightDefault = "lab-sandbox-preflight"

// sandboxConfigMap renders the preflight verdict as the ConfigMap the
// manager reads (<namespace>/<name>).
func sandboxConfigMap(pf *drivers.SandboxPreflight, ref string) ([]byte, error) {
	ns, name, ok := strings.Cut(ref, "/")
	if !ok || ns == "" || name == "" {
		return nil, fmt.Errorf("--sandbox-configmap-name %q: want <namespace>/<name>", ref)
	}
	body, err := yaml.Marshal(pf)
	if err != nil {
		return nil, err
	}
	cm := &corev1.ConfigMap{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "ConfigMap"},
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: map[string]string{
			"app.kubernetes.io/part-of": "cloudtrain", "app.kubernetes.io/managed-by": "labctl-preflight",
		}},
		Data: map[string]string{drivers.SandboxPreflightKey: string(body)},
	}
	return yaml.Marshal(cm)
}

// loadSandboxTiers resolves the tiers to check: --sandboxes-config (a
// SandboxConfig file, a ConfigMap file, or configmap:<ns>/<name> read from the
// cluster: what the manager reads), then --sandboxes, or the deprecated
// --tier-runtime-classes.
func loadSandboxTiers(ctx context.Context, c client.Client, configRef, flagValue, legacy string) (map[string]drivers.SandboxTier, error) {
	if flagValue != "" && legacy != "" {
		return nil, fmt.Errorf("--sandboxes and the deprecated --tier-runtime-classes are exclusive")
	}
	tiers := map[string]drivers.SandboxTier{}
	if configRef != "" {
		var data []byte
		if ref, ok := strings.CutPrefix(configRef, "configmap:"); ok {
			ns, name, ok := strings.Cut(ref, "/")
			if !ok {
				return nil, fmt.Errorf("--sandboxes-config %q: want configmap:<namespace>/<name>", configRef)
			}
			cm := &corev1.ConfigMap{}
			if err := c.Get(ctx, client.ObjectKey{Namespace: ns, Name: name}, cm); err != nil {
				return nil, fmt.Errorf("--sandboxes-config: %w", err)
			}
			v, ok := cm.Data[drivers.SandboxConfigKey]
			if !ok {
				return nil, fmt.Errorf("ConfigMap %s has no %s", ref, drivers.SandboxConfigKey)
			}
			data = []byte(v)
		} else {
			b, err := os.ReadFile(configRef) // #nosec G304 -- a file the operator names
			if err != nil {
				return nil, err
			}
			data = b
		}
		cfg, err := drivers.ParseSandboxConfig(data)
		if err != nil {
			return nil, err
		}
		for t, v := range cfg.Tiers {
			tiers[t] = v
		}
	}
	parse, v := drivers.ParseSandboxFlag, flagValue
	if legacy != "" {
		parse, v = drivers.ParseTierRuntimeClasses, legacy
	}
	fl, err := parse(v)
	if err != nil {
		return nil, err
	}
	for t, v := range fl {
		tiers[t] = v
	}
	return tiers, nil
}

// writeSandboxConfigMap writes the ConfigMap to path ("-" = w).
func writeSandboxConfigMap(pf *drivers.SandboxPreflight, ref, path string, w io.Writer) error {
	if pf == nil {
		return fmt.Errorf("--sandbox-configmap: no sandbox tiers to report (pass --sandboxes or --sandboxes-config)")
	}
	b, err := sandboxConfigMap(pf, ref)
	if err != nil {
		return err
	}
	if path == "-" {
		_, err = w.Write(b)
		return err
	}
	return os.WriteFile(path, b, 0o600)
}
