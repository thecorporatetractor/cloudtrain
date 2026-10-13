package drivers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	corev1 "k8s.io/api/core/v1"

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
	done, err := n.Manager.Delete(ctx, network.SessionOf(ref.Session))
	if err != nil {
		return err
	}
	if !done {
		return errNetworkTerminating
	}
	return nil
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
