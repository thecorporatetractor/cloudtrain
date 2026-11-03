package drivers

import (
	"context"
	"errors"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/utils/ptr"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// ExecDeviceCommand runs one CLI line (Command[0]; further elements are
// more lines) on a network device, e.g. "show ip ospf neighbor". Used by
// device-cmd checks.
const ExecDeviceCommand ExecKind = "device-cmd"

// NetdevBackend is how a device family is run.
type NetdevBackend string

const (
	// NetdevPod runs a containerized network OS as a pod (FRR, cEOS, SR Linux).
	NetdevPod NetdevBackend = "pod"
	// NetdevVM runs a VM-based network OS (vrnetlab images on KubeVirt). Not built yet.
	NetdevVM NetdevBackend = "vm"
	// NetdevClabernetes delegates a whole containerlab topology to
	// Clabernetes. Not built yet.
	NetdevClabernetes NetdevBackend = "clabernetes"
)

// DeviceFamily knows how to run and talk to one kind of network OS. It is
// the netdev extension point: a new NOS is a new family (and, for VM or
// Clabernetes backends, a backend implementation in NetdevDriver).
type DeviceFamily interface {
	// Name of the family ("frr").
	Name() string
	// Matches reports whether a catalog image ref belongs to the family.
	Matches(image string) bool
	// Backend that runs the device.
	Backend() NetdevBackend
	// Capabilities the device container needs on top of the runtime defaults.
	Capabilities() []corev1.Capability
	// ReadyCommand succeeds once the device accepts CLI commands.
	ReadyCommand() []string
	// ConfigCommand applies a configuration block read from stdin
	// (idempotent: applying the same block twice changes nothing). A
	// non-zero exit is a failed action.
	ConfigCommand() []string
	// CLICommand runs CLI lines (show commands) and prints their output.
	CLICommand(lines []string) []string
	// ConsoleCommand is the program a learner's console opens.
	ConsoleCommand() []string
}

// FRR is the DeviceFamily of FRRouting images (catalog refs "frr:*").
type FRR struct{}

var _ DeviceFamily = FRR{}

func (FRR) Name() string              { return "frr" }
func (FRR) Matches(image string) bool { return strings.HasPrefix(image, "frr:") }
func (FRR) Backend() NetdevBackend    { return NetdevPod }
func (FRR) ReadyCommand() []string    { return []string{"vtysh", "-c", "show version"} }
func (FRR) ConsoleCommand() []string  { return []string{"vtysh"} }
func (FRR) Capabilities() []corev1.Capability {
	// zebra programs routes and addresses; ospfd/isisd use raw sockets;
	// watchfrr manages the daemons. SYS_ADMIN is not optional: FRR's privs
	// model (lib/privs.c) puts it in every daemon's permitted set for netns
	// VRFs, and without it mgmtd, zebra, bgpd, ospfd, ospf6d, bfdd and
	// staticd all exit at start ("privs_init: initial cap_set_proc failed:
	// Operation not permitted", checked on cloudtrain/frr:10, FRR 10.7.1).
	// It is contained by the pod's isolation instead: seccomp RuntimeDefault,
	// no privilege escalation, and a user namespace or a sandbox runtime.
	return []corev1.Capability{"NET_ADMIN", "NET_RAW", "NET_BIND_SERVICE", "SYS_ADMIN"}
}

// netdevBaseCapabilities is the explicit allowlist from the container
// runtime's default set that device images use (every capability is dropped
// first, so a runtime with a wider default adds nothing): the FRR entrypoint
// installs config files and pid locks as root (CHOWN, DAC_OVERRIDE, FOWNER,
// FSETID), the daemons drop to the frr user (SETUID, SETGID), watchfrr
// signals them (KILL), and sshd's privilege separation (network-automation
// labs) chroots (SYS_CHROOT). Not granted: MKNOD, SETPCAP, SETFCAP,
// AUDIT_WRITE.
var netdevBaseCapabilities = []corev1.Capability{"CHOWN", "DAC_OVERRIDE", "FOWNER", "FSETID", "KILL", "SETGID", "SETUID", "SYS_CHROOT"}

// ConfigCommand writes stdin to a file and loads it with `vtysh -f`, which
// applies it to the running daemons in config mode and exits non-zero on
// any rejected line. FRR config commands are declarative, so re-applying a
// block is a no-op.
func (FRR) ConfigCommand() []string {
	return []string{"/bin/sh", "-c", `f=$(mktemp /tmp/cloudtrain-config.XXXXXX) || exit 1
cat > "$f"
vtysh -f "$f"; rc=$?
rm -f "$f"
exit $rc`}
}

func (FRR) CLICommand(lines []string) []string {
	cmd := []string{"vtysh"}
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			cmd = append(cmd, "-c", l)
		}
	}
	return cmd
}

// NetdevDriver runs network devices. Pod-backed families reuse the
// container driver's plumbing (naming, ownership, exec, reset/destroy)
// and are always wired into the session network (management segment on
// eth0, links as Multus attachments, IP forwarding on).
type NetdevDriver struct {
	*ContainerDriver
	Families []DeviceFamily
}

var (
	_ NodeDriver          = (*NetdevDriver)(nil)
	_ TopologyProvisioner = (*NetdevDriver)(nil)
)

// NewNetdev returns the netdev driver on top of base (which must have a
// Network) with the built-in families.
func NewNetdev(base *ContainerDriver, families ...DeviceFamily) *NetdevDriver {
	if len(families) == 0 {
		families = []DeviceFamily{FRR{}}
	}
	return &NetdevDriver{ContainerDriver: base, Families: families}
}

func (d *NetdevDriver) Name() labsv1.DriverName { return labsv1.DriverNetdev }

// Family returns the device family of a node.
func (d *NetdevDriver) Family(n labsv1.Node) (DeviceFamily, error) {
	for _, f := range d.Families {
		if f.Matches(n.Image) {
			return f, nil
		}
	}
	return nil, fmt.Errorf("netdev node %q: no device family for image %q: %w", n.Name, n.Image, ErrUnsupported)
}

func (d *NetdevDriver) podFamily(n labsv1.Node) (DeviceFamily, error) {
	f, err := d.Family(n)
	if err != nil {
		return nil, err
	}
	if f.Backend() != NetdevPod {
		return nil, &NotImplementedError{Driver: labsv1.DriverNetdev, Backend: string(f.Backend()), Op: "run " + f.Name()}
	}
	return f, nil
}

// BuildPod renders the device pod (before network wiring). The device
// container runs as root with the family's capabilities, so the pod is locked
// down around it: seccomp RuntimeDefault for every container, every other
// capability dropped, and no privilege escalation (setuid sudo inside the
// device) unless the lab opts in with learnerSudo on the node (the
// network-automation labs, whose automation account uses sudo).
func (d *NetdevDriver) BuildPod(ref NodeRef, f DeviceFamily) *corev1.Pod {
	pod := d.ContainerDriver.BuildPod(ref)
	c := &pod.Spec.Containers[0]
	c.Ports = nil
	c.SecurityContext = &corev1.SecurityContext{
		AllowPrivilegeEscalation: ptr.To(ref.Node.LearnerSudo),
		Capabilities: &corev1.Capabilities{
			Drop: []corev1.Capability{"ALL"},
			Add:  appendCapabilities(append([]corev1.Capability{}, netdevBaseCapabilities...), f.Capabilities()...),
		},
	}
	if pod.Spec.SecurityContext == nil {
		pod.Spec.SecurityContext = &corev1.PodSecurityContext{}
	}
	pod.Spec.SecurityContext.SeccompProfile = &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault}
	if ref.Node.LearnerSudo {
		setAnnotation(pod, AnnotationLearnerSudo, "true")
	}
	c.StartupProbe = &corev1.Probe{
		ProbeHandler:     corev1.ProbeHandler{Exec: &corev1.ExecAction{Command: f.ReadyCommand()}},
		PeriodSeconds:    2,
		TimeoutSeconds:   5,
		FailureThreshold: 90,
	}
	return pod
}

// Provision creates the device pod (no Service: the device lives in the
// isolated session VPC; access goes through exec).
func (d *NetdevDriver) Provision(ctx context.Context, ref NodeRef) (NodeState, error) {
	fail := func(err error) (NodeState, error) {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	f, err := d.podFamily(ref.Node)
	if err != nil {
		return fail(err)
	}
	if d.Network == nil {
		return fail(fmt.Errorf("netdev node %q needs a lab network: %w", ref.Node.Name, ErrUnsupported))
	}
	if ref.Node.LearnerSudo && d.DenyLearnerSudo {
		return fail(fmt.Errorf("node %q requests learnerSudo, which this platform does not allow (--allow-learner-sudo=false): %w", ref.Node.Name, ErrUnsupported))
	}
	pod := d.BuildPod(ref, f)
	if err := d.Network.DecoratePod(ref, pod, ContainerName, true); err != nil {
		return fail(err)
	}
	// Like container nodes, the device pod gets its tier's sandbox
	// RuntimeClass (catalog tier N) when one is configured and available; the
	// decision is made once, right before the pod is created.
	prepare := func() error {
		if _, err := d.applySandbox(ctx, ref, pod); err != nil {
			return err
		}
		// learnerSudo lifts no_new_privs in a container that keeps SYS_ADMIN
		// (FRR): sudo there is root with SYS_ADMIN, which on the host kernel
		// reaches bpf() and perf_event_open. Only inside a user namespace or a
		// VM sandbox; never with host users.
		if ref.Node.LearnerSudo {
			if ok, why := podIsolated(pod); !ok {
				return fmt.Errorf("node %q sets learnerSudo on a device that keeps SYS_ADMIN; that runs only in a user namespace or a sandbox RuntimeClass, and this pod has %s: %w",
					ref.Node.Name, why, ErrUnsupported)
			}
		}
		return nil
	}
	if err := d.createPodIfAbsent(ctx, ref, pod, prepare); err != nil {
		if IsPermanent(err) && !errors.Is(err, ErrConflict) {
			return fail(err)
		}
		return NodeState{Phase: labsv1.NodePending, Message: err.Error()}, fmt.Errorf("pod: %w", err)
	}
	st, err := d.Status(ctx, ref)
	if err == nil && st.Phase == labsv1.NodeReady {
		if st.Details == nil {
			st.Details = map[string]string{}
		}
		st.Details["family"] = f.Name()
	}
	return st, err
}

// Exec runs device config, CLI lines or shell commands on the device.
// Devices have one (admin) identity: learner shell commands are refused.
func (d *NetdevDriver) Exec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error) {
	f, err := d.podFamily(ref.Node)
	if err != nil {
		return ExecResult{}, err
	}
	if req.Member != "" {
		return ExecResult{}, fmt.Errorf("netdev driver: member %q: %w", req.Member, ErrUnsupported)
	}
	out := ExecRequest{Kind: ExecShell, User: labsv1.ActionAsAdmin, Timeout: req.Timeout}
	switch req.Kind {
	case ExecDeviceConfig:
		out.Command, out.Stdin = f.ConfigCommand(), req.Stdin
	case ExecDeviceCommand:
		var lines []string
		for _, c := range req.Command {
			lines = append(lines, strings.Split(c, "\n")...)
		}
		if len(lines) == 0 {
			return ExecResult{}, fmt.Errorf("netdev driver: empty CLI command")
		}
		out.Command = f.CLICommand(lines)
	case ExecShell, "":
		if req.User == labsv1.ActionAsLearner {
			return ExecResult{}, fmt.Errorf("netdev driver: shell as learner: %w", ErrUnsupported)
		}
		out.Command, out.Stdin = req.Command, req.Stdin
	default:
		return ExecResult{}, fmt.Errorf("netdev driver: exec kind %s: %w", req.Kind, ErrUnsupported)
	}
	return d.ContainerDriver.Exec(ctx, ref, out)
}

// Connect: console and ssh both open the device CLI over exec (the session
// VPC is not reachable from the access gateway; see README "Lab network").
func (d *NetdevDriver) Connect(_ context.Context, ref NodeRef, access labsv1.AccessType) (labsv1.Endpoint, error) {
	f, err := d.podFamily(ref.Node)
	if err != nil {
		return labsv1.Endpoint{}, err
	}
	switch access {
	case labsv1.AccessConsole, labsv1.AccessSSH, labsv1.AccessShell:
		return labsv1.Endpoint{
			Node: ref.Node.Name, Access: access, Protocol: "k8s-exec",
			Target:  fmt.Sprintf("%s/%s/%s", ref.Namespace(), ref.ResourceName(), ContainerName),
			Command: strings.Join(f.ConsoleCommand(), " "),
		}, nil
	}
	return labsv1.Endpoint{}, fmt.Errorf("netdev driver: %s access: %w", access, ErrUnsupported)
}

// appendCapabilities appends the capabilities have does not contain yet.
func appendCapabilities(have []corev1.Capability, add ...corev1.Capability) []corev1.Capability {
	for _, a := range add {
		dup := false
		for _, h := range have {
			dup = dup || h == a
		}
		if !dup {
			have = append(have, a)
		}
	}
	return have
}
