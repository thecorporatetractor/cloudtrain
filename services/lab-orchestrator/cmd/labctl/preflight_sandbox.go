package main

// labctl preflight, sandbox section (docs/kata-spike.md, section 6.3): can tier-B
// images run in a Kata sandbox on this cluster?
//
//   - static: the Kata RuntimeClasses (kata-deploy's kata-*, AKS kata-vm-isolation,
//     GKE microvm), and for every tier the manager maps with --tier-runtime-classes
//     the same detection the manager runs at startup (RuntimeClass exists, its node
//     selector matches a schedulable node);
//   - with --probe: a throwaway pod per sandbox RuntimeClass that must boot its own
//     kernel (not the node's) and have the lab kernel features built in (dummy, GRE,
//     bond, VLAN, WireGuard, netem, md raid1); the guest memory against the pod
//     limit (runtime-rs sizes the VM to the limit, the Go runtime adds 2 GiB);
//   - with --probe and --systemd-image: a tier-B systemd pod boots to running and
//     `kubectl exec` works (the exec EBUSY regression of section 4.2).
//
// Without Kata, tier B runs as KubeVirt VMs, so a cluster with no sandbox only
// warns; a tier the manager is told to map but cannot is a failure.

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	nodev1 "k8s.io/api/node/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func (r *pfReport) addSandbox(name, status, msg, fix string) {
	r.Checks = append(r.Checks, pfCheck{Name: "sandbox/" + name, Status: status, Message: msg, Fix: fix})
}

// managedSandboxClasses are the managed providers' Kata RuntimeClasses.
var managedSandboxClasses = map[string]string{
	"kata-vm-isolation": "AKS Pod Sandboxing",
	"microvm":           "GKE Sandbox microvm",
}

// isSandboxClass recognises a Kata RuntimeClass by name or handler.
func isSandboxClass(rc nodev1.RuntimeClass) bool {
	if _, ok := managedSandboxClasses[rc.Name]; ok {
		return true
	}
	return strings.HasPrefix(rc.Name, "kata") || strings.HasPrefix(rc.Handler, "kata")
}

// sandboxFeatures are the lab guest kernel features tier-B content needs
// (docs/kata-spike.md 4.3; the stock Kata kernel has none of them).
var sandboxFeatures = []struct{ name, script string }{
	{"dummy", "ip link add ctpf-dummy type dummy && ip link del ctpf-dummy"},
	{"gre", "ip link add ctpf-gre type gre remote 192.0.2.1 local 192.0.2.2 && ip link del ctpf-gre"},
	{"bond", "ip link add ctpf-bond type bond && ip link del ctpf-bond"},
	{"vlan", "ip link add ctpf-d0 type dummy && ip link add link ctpf-d0 name ctpf-d0.10 type vlan id 10 && ip link del ctpf-d0"},
	{"wireguard", "ip link add ctpf-wg type wireguard && ip link del ctpf-wg"},
	{"netem", "tc qdisc add dev lo root netem delay 1ms && tc qdisc del dev lo root"},
	{"md", "grep -q raid1 /proc/mdstat"},
}

// sandboxProbeScript prints "kernel <release>", "memkb <MemTotal>" and
// "feature <name> ok|missing" lines.
func sandboxProbeScript() string {
	var b strings.Builder
	b.WriteString("echo kernel $(uname -r)\necho memkb $(awk '/^MemTotal:/{print $2}' /proc/meminfo)\n")
	for _, f := range sandboxFeatures {
		fmt.Fprintf(&b, "if ( %s ) >/dev/null 2>&1; then echo feature %s ok; else echo feature %s missing; fi\n", f.script, f.name, f.name)
	}
	return b.String()
}

// sandboxProbeLimit is the probe pod's memory limit (the guest size on runtime-rs).
const sandboxProbeLimit = 512 << 20

// sandboxStatic reports the Kata RuntimeClasses and the manager's tier map.
// It returns the RuntimeClasses to probe: the mapped ones, else every Kata one.
func sandboxStatic(rcs []nodev1.RuntimeClass, tiers, detected, dropped map[string]string, rep *pfReport) []string {
	var kata []string
	for _, rc := range rcs {
		if isSandboxClass(rc) {
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
			if !isSandboxClass(rc) {
				continue
			}
			d := rc.Name
			if rc.Handler != rc.Name {
				d += " (handler " + rc.Handler + ")"
			}
			if p, ok := managedSandboxClasses[rc.Name]; ok {
				d += " [" + p + "]"
			}
			desc = append(desc, d)
		}
		sort.Strings(desc)
		rep.addSandbox("runtimeclasses", pfPass, strings.Join(desc, ", "), "")
	}
	if len(tiers) == 0 {
		if len(kata) > 0 {
			rep.addSandbox("tiers", pfWarn, "no tier mapped: tier-B container nodes run without a sandbox (systemd images are refused)",
				"deploy the orchestrator with --tier-runtime-classes B="+kata[0]+" (Helm orchestrator.tierRuntimeClasses), and pass the same flag here")
		}
		return kata
	}
	var probe []string
	for _, t := range sortedKeys(tiers) {
		if reason, bad := dropped[t]; bad {
			rep.addSandbox("tier-"+t, pfFail, reason, "install the sandbox runtime on the lab nodes (kata-deploy labels them katacontainers.io/kata-runtime=true) or drop tier "+t+" from --tier-runtime-classes")
			continue
		}
		rep.addSandbox("tier-"+t, pfPass, fmt.Sprintf("tier %s -> RuntimeClass %s, schedulable", t, detected[t]), "")
		probe = append(probe, detected[t])
	}
	return dedupe(probe)
}

// sandboxProbeResult turns the probe output into checks. strict (the
// RuntimeClass is mapped to a tier) makes missing features a failure.
func sandboxProbeResult(rc, nodeKernel, out string, limit int64, strict bool, rep *pfReport) (isVM bool) {
	var kernel string
	var memKB int64
	var missing, ok []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Fields(line)
		switch {
		case len(f) == 2 && f[0] == "kernel":
			kernel = f[1]
		case len(f) == 2 && f[0] == "memkb":
			memKB, _ = strconv.ParseInt(f[1], 10, 64)
		case len(f) == 3 && f[0] == "feature" && f[2] == "ok":
			ok = append(ok, f[1])
		case len(f) == 3 && f[0] == "feature":
			missing = append(missing, f[1])
		}
	}
	name := "probe " + rc
	switch {
	case kernel == "":
		rep.addSandbox(name, pfFail, "no output from the probe pod", "")
		return false
	case kernel == nodeKernel:
		rep.addSandbox(name, pfFail, "the pod runs on the node's kernel "+kernel+": not a VM sandbox", "check the RuntimeClass handler (kata-deploy's containerd config)")
		return false
	}
	rep.addSandbox(name, pfPass, fmt.Sprintf("own guest kernel %s (node %s)", kernel, nodeKernel), "")
	if len(missing) > 0 {
		st := pfWarn
		if strict {
			st = pfFail
		}
		rep.addSandbox(name+" features", st, fmt.Sprintf("guest kernel %s lacks %s (has %s)", kernel, strings.Join(missing, ", "), strings.Join(ok, ", ")),
			"use the CloudTrain lab guest kernel (tools/images/kata-kernel; kind: KIND_PROFILE=kata installs it); on AKS/GKE the guest kernel is the provider's, so labs that need these stay on KubeVirt")
	} else {
		rep.addSandbox(name+" features", pfPass, "lab kernel features built in: "+strings.Join(ok, ", "), "")
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
	return true
}

type sandboxProbe struct {
	c            client.Client
	ex           drivers.PodExecutor
	toolsImage   string
	systemdImage string
	timeout      time.Duration
	logf         func(string, ...any)
}

// runSandboxPreflight adds the sandbox section to rep.
func runSandboxPreflight(ctx context.Context, c client.Client, ex drivers.PodExecutor, o preflightOpts, nodes []corev1.Node, rep *pfReport, logf func(string, ...any)) {
	rcl := &nodev1.RuntimeClassList{}
	if err := c.List(ctx, rcl); err != nil {
		rep.addSandbox("runtimeclasses", pfFail, "list RuntimeClasses: "+err.Error(), "")
		return
	}
	detected, dropped := drivers.DetectTierRuntimeClasses(ctx, c, o.tiers)
	targets := sandboxStatic(rcl.Items, o.tiers, detected, dropped, rep)
	if !o.probe || len(targets) == 0 {
		if len(targets) > 0 {
			rep.addSandbox("probe", pfWarn, "not run: guest kernel and lab kernel features unchecked", "re-run with --probe")
		}
		return
	}
	mapped := map[string]bool{}
	for _, rc := range detected {
		mapped[rc] = true
	}
	kernels := map[string]string{}
	for _, n := range nodes {
		kernels[n.Name] = n.Status.NodeInfo.KernelVersion
	}
	p := &sandboxProbe{c: c, ex: ex, toolsImage: o.toolsImage, systemdImage: o.systemdImage, timeout: o.timeout, logf: logf}
	for _, rc := range targets {
		p.run(ctx, rc, mapped[rc], kernels, rep)
	}
}

func (p *sandboxProbe) run(ctx context.Context, rc string, strict bool, kernels map[string]string, rep *pfReport) {
	ns := "ct-preflight-sb-" + randSuffix()
	nsObj := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: ns, Labels: sessionNamespaceLabels(map[string]string{"labs.cloudtrain.dev/preflight": "true"})}}
	if err := p.c.Create(ctx, nsObj); err != nil {
		rep.addSandbox("probe "+rc, pfFail, "create namespace: "+err.Error(), "")
		return
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
		rep.addSandbox("probe "+rc, pfFail, err.Error(), "check the RuntimeClass handler and the kata-deploy pods on "+pod.Spec.NodeName)
		return
	}
	out, err := p.exec(pctx, pod, sandboxProbeScript())
	if err != nil {
		rep.addSandbox("probe "+rc, pfFail, "exec: "+err.Error(), "")
		return
	}
	if !sandboxProbeResult(rc, kernels[pod.Spec.NodeName], out, sandboxProbeLimit, strict, rep) {
		return // never start a privileged pod outside a VM
	}
	if p.systemdImage == "" {
		rep.addSandbox("probe "+rc+" systemd", pfWarn, "not run: systemd boot and exec in a tier-B pod unchecked", "re-run with --systemd-image cloudtrain/deb-sys:24.04 (on the nodes)")
		return
	}
	sd := sandboxPod(ns, "systemd", rc, p.systemdImage, true)
	if err := p.start(pctx, sd); err != nil {
		rep.addSandbox("probe "+rc+" systemd", pfFail, err.Error(), "")
		return
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
		rep.addSandbox("probe "+rc+" systemd", pfFail, "kubectl exec into the systemd pod fails with EBUSY: "+firstLine(err.Error()),
			"the image needs the empty init leaf cgroup (tools/images/linux-pod/sys/ct-sysinit), or the Kata agent changed")
	case err != nil:
		rep.addSandbox("probe "+rc+" systemd", pfFail, fmt.Sprintf("systemd did not reach running (last state %q): %v", state, err), "check the image's entrypoint and journal")
	default:
		rep.addSandbox("probe "+rc+" systemd", pfPass, fmt.Sprintf("%s boots systemd to %s, kubectl exec works", p.systemdImage, state), "")
	}
}

// sandboxPod is a probe pod in RuntimeClass rc. A systemd pod is privileged
// (inside the guest VM only: the caller has checked the sandbox is a VM).
func sandboxPod(ns, name, rc, image string, systemd bool) *corev1.Pod {
	lim := corev1.ResourceList{corev1.ResourceMemory: *resource.NewQuantity(sandboxProbeLimit, resource.BinarySI), corev1.ResourceCPU: resource.MustParse("1")}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: map[string]string{"labs.cloudtrain.dev/preflight": "true"}},
		Spec: corev1.PodSpec{
			RuntimeClassName:              ptr.To(rc),
			AutomountServiceAccountToken:  ptr.To(false),
			RestartPolicy:                 corev1.RestartPolicyNever,
			TerminationGracePeriodSeconds: ptr.To(int64(1)),
			Containers: []corev1.Container{{
				Name: "node", Image: image, ImagePullPolicy: corev1.PullIfNotPresent,
				Resources: corev1.ResourceRequirements{Limits: lim, Requests: lim},
			}},
		},
	}
	if systemd {
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
		return pod.Status.Phase == corev1.PodRunning, nil
	})
	if err != nil {
		return fmt.Errorf("pod %s not running in RuntimeClass %s: %v (%s)", pod.Name, ptr.Deref(pod.Spec.RuntimeClassName, ""), err, podEvents(ctx, p.c, pod))
	}
	return nil
}

func (p *sandboxProbe) exec(ctx context.Context, pod *corev1.Pod, script string) (string, error) {
	return (&netProbe{ex: p.ex}).exec(ctx, pod, script)
}

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
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
