package drivers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

// PodNetwork wires pod-backed nodes (container, netdev) into the session
// network: topology links as Multus attachments in the session's Kube-OVN
// VPC. It is session-scoped (TopologyProvisioner) and decorates pods.
type PodNetwork interface {
	TopologyProvisioner
	LinkReporter
	// DecoratePod adds the node's network wiring to pod; container is the
	// node's main container, router enables IP forwarding.
	DecoratePod(ref NodeRef, pod *corev1.Pod, container string, router bool) error
}

// LinkReporter is implemented by topology provisioners that publish link
// facts (LabSession status.links).
type LinkReporter interface {
	Links(ref SessionRef) ([]labsv1.LinkStatus, error)
}

// LinkNetwork is the PodNetwork on Kube-OVN + Multus (internal/network).
type LinkNetwork struct {
	Manager *network.Manager
	// ToolsImage is the pullable nettools image for net-init and the link sidecar.
	ToolsImage string
	// DestroyWait bounds how long DestroyTopology waits for the network to
	// be gone before returning a retryable error (default 45s).
	DestroyWait time.Duration
	// OVN, when set, makes link segments pass 802.1Q-tagged frames
	// (vlan-passthru on their logical switches). Nil: tagged frames are
	// dropped on links.
	OVN *OVNCentral
}

// OVNCentral runs ovn-nbctl in Kube-OVN's ovn-central pod, for logical
// switch options Kube-OVN has no API for. It needs list on pods and
// create on pods/exec in Namespace.
type OVNCentral struct {
	Reader   client.Reader
	Executor PodExecutor
	// Namespace and Selector find the ovn-central pods (kube-system,
	// app=ovn-central); Container is the container to exec in (ovn-central).
	Namespace string
	Selector  map[string]string
	Container string
}

// ParseOVNCentral parses "<namespace>/<label>=<value>" (container ovn-central).
func ParseOVNCentral(spec string) (*OVNCentral, error) {
	ns, sel, ok := strings.Cut(spec, "/")
	k, v, ok2 := strings.Cut(sel, "=")
	if !ok || !ok2 || ns == "" || k == "" || v == "" {
		return nil, fmt.Errorf("ovn-central %q: want <namespace>/<label>=<value>", spec)
	}
	return &OVNCentral{Namespace: ns, Selector: map[string]string{k: v}, Container: "ovn-central"}, nil
}

// VLANPassthruCommand is the ovn-nbctl argv that sets vlan-passthru on
// switches (one transaction). --no-leader-only: any member of a clustered
// NB database forwards the write to the leader.
func VLANPassthruCommand(switches []string) []string {
	cmd := []string{"ovn-nbctl", "--no-leader-only"}
	for i, ls := range switches {
		if i > 0 {
			cmd = append(cmd, "--")
		}
		cmd = append(cmd, "set", "Logical_Switch", ls, "other_config:vlan-passthru=true")
	}
	return cmd
}

// SetVLANPassthru implements network.SetVLANPassthru.
func (o *OVNCentral) SetVLANPassthru(ctx context.Context, switches []string) error {
	pods := &corev1.PodList{}
	if err := o.Reader.List(ctx, pods, client.InNamespace(o.Namespace), client.MatchingLabels(o.Selector)); err != nil {
		return err
	}
	var errs []error
	for _, p := range pods.Items {
		if p.Status.Phase != corev1.PodRunning || p.DeletionTimestamp != nil {
			continue
		}
		var out bytes.Buffer
		err := o.Executor.Exec(ctx, p.Namespace, p.Name, o.Container, VLANPassthruCommand(switches), nil, &out, &out)
		if err == nil {
			return nil
		}
		errs = append(errs, fmt.Errorf("%s: %w: %s", p.Name, err, strings.TrimSpace(out.String())))
	}
	if len(errs) == 0 {
		return fmt.Errorf("no running ovn-central pod in %s matching %v", o.Namespace, o.Selector)
	}
	return errors.Join(errs...)
}

var _ PodNetwork = (*LinkNetwork)(nil)

// Plan computes the session's network plan from a topology.
func (n *LinkNetwork) Plan(s *labsv1.LabSession, topo *labsv1.Topology) (*network.Plan, error) {
	if topo == nil {
		return nil, fmt.Errorf("network: no topology: %w", ErrUnsupported)
	}
	p, err := network.Build(network.SessionOf(s), topo)
	if errors.Is(err, network.ErrInvalid) {
		return nil, fmt.Errorf("%w: %w", ErrUnsupported, err)
	}
	return p, err
}

func topologyOf(spec *labsv1.LabTemplateSpec) *labsv1.Topology {
	if spec == nil {
		return nil
	}
	return &spec.Topology
}

// ProvisionTopology creates the VPC, management segment and link segments.
func (n *LinkNetwork) ProvisionTopology(ctx context.Context, ref SessionRef) (bool, error) {
	p, err := n.Plan(ref.Session, topologyOf(ref.Template))
	if err != nil {
		return false, err
	}
	ready, err := n.Manager.Ensure(ctx, p)
	if ready && err == nil && n.OVN != nil {
		err = n.Manager.EnsureVLANPassthru(ctx, p, n.OVN.SetVLANPassthru)
		ready = err == nil
	}
	if errors.Is(err, network.ErrConflict) {
		return false, fmt.Errorf("%w: %w", ErrConflict, err)
	}
	return ready, err
}

// errNetworkTerminating keeps teardown retrying until every object is gone.
var errNetworkTerminating = errors.New("session network still terminating")

// DestroyTopology deletes every network object of the session (found by
// label, so it needs no topology). It errors until they are all gone, which
// keeps the session finalizer in place.
func (n *LinkNetwork) DestroyTopology(ctx context.Context, ref SessionRef) error {
	// Wired pods take a few seconds to terminate (5s grace). Wait here
	// rather than return an error at once: every error grows the
	// controller's exponential backoff, which would delay the final
	// cleanup by minutes.
	deadline := time.Now().Add(n.destroyWait())
	for {
		done, err := n.Manager.Delete(ctx, network.SessionOf(ref.Session))
		if err != nil {
			return err
		}
		if done {
			return nil
		}
		if time.Now().After(deadline) {
			return errNetworkTerminating
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (n *LinkNetwork) destroyWait() time.Duration {
	if n.DestroyWait > 0 {
		return n.DestroyWait
	}
	return 45 * time.Second
}

// Links reports the link facts of the session.
func (n *LinkNetwork) Links(ref SessionRef) ([]labsv1.LinkStatus, error) {
	p, err := n.Plan(ref.Session, topologyOf(ref.Template))
	if err != nil {
		return nil, err
	}
	return p.LinkStatuses(), nil
}

// DecoratePod implements PodNetwork.
func (n *LinkNetwork) DecoratePod(ref NodeRef, pod *corev1.Pod, container string, router bool) error {
	p, err := n.Plan(ref.Session, topologyOf(ref.Template))
	if err != nil {
		return err
	}
	return p.DecoratePod(ref.Node.Name, pod, container, network.PodOptions{ToolsImage: n.ToolsImage, Router: router})
}

// CaptureTarget is where a capture on a link end runs: the link sidecar of
// the end's pod, with the tcpdump argv.
type CaptureTarget struct {
	Namespace, Pod, Container string
	Command                   []string
}

// CaptureTarget locates the link end "node:iface" of a session. The access
// gateway (or a debugging operator) execs Command there and streams stdout.
func (n *LinkNetwork) CaptureTarget(ref SessionRef, node, iface string, o network.CaptureOptions) (CaptureTarget, error) {
	topo := topologyOf(ref.Template)
	if topo == nil && ref.Session.Status.Topology != nil {
		topo = ref.Session.Status.Topology
	}
	p, err := n.Plan(ref.Session, topo)
	if err != nil {
		return CaptureTarget{}, err
	}
	ne, ok := p.FindEnd(node, iface)
	if !ok {
		return CaptureTarget{}, fmt.Errorf("no link end %s:%s: %w", node, iface, ErrUnsupported)
	}
	if ne.End.Driver != labsv1.DriverContainer && ne.End.Driver != labsv1.DriverNetdev {
		return CaptureTarget{}, &NotImplementedError{Driver: ne.End.Driver, Backend: "link", Op: "capture"}
	}
	return CaptureTarget{
		Namespace: ref.Session.Namespace,
		Pod:       ResourceName(ref.Session.Name, string(ref.Session.UID), node),
		Container: network.SidecarName,
		Command:   network.CaptureCommand(iface, o),
	}, nil
}

// Capture runs a capture on a link end through exec and streams it to out
// until ctx is cancelled or Count packets were seen.
func (n *LinkNetwork) Capture(ctx context.Context, ex PodExecutor, ref SessionRef, node, iface string, o network.CaptureOptions, out, errOut io.Writer) error {
	t, err := n.CaptureTarget(ref, node, iface, o)
	if err != nil {
		return err
	}
	return ex.Exec(ctx, t.Namespace, t.Pod, t.Container, t.Command, nil, out, errOut)
}

// Network topology hooks of the container driver: with a Network set,
// container nodes with link ends are wired into the session network.

// ProvisionTopology implements TopologyProvisioner.
func (d *ContainerDriver) ProvisionTopology(ctx context.Context, ref SessionRef) (bool, error) {
	if d.Network == nil {
		return true, nil
	}
	return d.Network.ProvisionTopology(ctx, ref)
}

// DestroyTopology implements TopologyProvisioner.
func (d *ContainerDriver) DestroyTopology(ctx context.Context, ref SessionRef) error {
	if d.Network == nil {
		return nil
	}
	return d.Network.DestroyTopology(ctx, ref)
}

// Links implements LinkReporter.
func (d *ContainerDriver) Links(ref SessionRef) ([]labsv1.LinkStatus, error) {
	if d.Network == nil {
		return nil, nil
	}
	return d.Network.Links(ref)
}

// decoratePod applies the network wiring to a container node's pod.
func (d *ContainerDriver) decoratePod(ref NodeRef, pod *corev1.Pod, router bool) error {
	if d.Network == nil {
		if ref.Template != nil {
			for _, l := range ref.Template.Topology.Links {
				if strings.HasPrefix(l.A, ref.Node.Name+":") || strings.HasPrefix(l.B, ref.Node.Name+":") {
					return fmt.Errorf("node %s has topology links but no lab network is configured: %w", ref.Node.Name, ErrUnsupported)
				}
			}
		}
		return nil
	}
	return d.Network.DecoratePod(ref, pod, ContainerName, router)
}
