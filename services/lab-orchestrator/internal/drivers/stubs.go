package drivers

import (
	"context"
	"fmt"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// stubDriver is a placeholder for a backend that is not built yet. Every
// operation returns a NotImplementedError, except Destroy, which succeeds
// because a stub never created anything (so session deletion is not blocked).
type stubDriver struct {
	name    labsv1.DriverName
	backend string
}

func (s *stubDriver) Name() labsv1.DriverName { return s.name }

func (s *stubDriver) err(op string) error {
	return &NotImplementedError{Driver: s.name, Backend: s.backend, Op: op}
}

func (s *stubDriver) Provision(context.Context, NodeRef) (NodeState, error) {
	return NodeState{Phase: labsv1.NodeFailed, Message: s.err("provision").Error()}, s.err("provision")
}

func (s *stubDriver) Status(context.Context, NodeRef) (NodeState, error) {
	return NodeState{Phase: labsv1.NodePending}, s.err("status")
}

func (s *stubDriver) Exec(context.Context, NodeRef, ExecRequest) (ExecResult, error) {
	return ExecResult{}, s.err("exec")
}

func (s *stubDriver) Connect(context.Context, NodeRef, labsv1.AccessType) (labsv1.Endpoint, error) {
	return labsv1.Endpoint{}, s.err("connect")
}

func (s *stubDriver) Reset(context.Context, NodeRef) error { return s.err("reset") }

func (s *stubDriver) Destroy(context.Context, NodeRef) error { return nil }

// NewVMDriver returns the vm driver (KubeVirt VirtualMachines). Not implemented yet.
func NewVMDriver() NodeDriver { return &stubDriver{name: labsv1.DriverVM, backend: "kubevirt"} }

// NewNetdevDriver returns the netdev driver (Clabernetes / vrnetlab). Not implemented yet.
func NewNetdevDriver() NodeDriver {
	return &stubDriver{name: labsv1.DriverNetdev, backend: "clabernetes"}
}

// NewVClusterDriver returns the k8s-cluster mode=virtual backend (vcluster). Not implemented yet.
func NewVClusterDriver() NodeDriver {
	return &stubDriver{name: labsv1.DriverK8sCluster, backend: "vcluster"}
}

// NewKubeadmDriver returns the k8s-cluster mode=kubeadm backend (VM nodes from golden snapshots). Not implemented yet.
func NewKubeadmDriver() NodeDriver {
	return &stubDriver{name: labsv1.DriverK8sCluster, backend: "kubeadm"}
}

// ClusterDriver is the k8s-cluster driver; it dispatches to a backend by
// node.cluster.mode.
type ClusterDriver struct {
	Virtual NodeDriver
	Kubeadm NodeDriver
}

// NewClusterDriver returns a ClusterDriver with the stub backends.
func NewClusterDriver() *ClusterDriver {
	return &ClusterDriver{Virtual: NewVClusterDriver(), Kubeadm: NewKubeadmDriver()}
}

var _ NodeDriver = (*ClusterDriver)(nil)

func (c *ClusterDriver) Name() labsv1.DriverName { return labsv1.DriverK8sCluster }

func (c *ClusterDriver) backend(ref NodeRef) (NodeDriver, error) {
	mode := labsv1.ClusterModeVirtual
	if ref.Node.Cluster != nil && ref.Node.Cluster.Mode != "" {
		mode = ref.Node.Cluster.Mode
	}
	switch mode {
	case labsv1.ClusterModeVirtual:
		return c.Virtual, nil
	case labsv1.ClusterModeKubeadm:
		return c.Kubeadm, nil
	}
	return nil, fmt.Errorf("cluster mode %q: %w", mode, ErrUnsupported)
}

func (c *ClusterDriver) Provision(ctx context.Context, ref NodeRef) (NodeState, error) {
	b, err := c.backend(ref)
	if err != nil {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	return b.Provision(ctx, ref)
}

func (c *ClusterDriver) Status(ctx context.Context, ref NodeRef) (NodeState, error) {
	b, err := c.backend(ref)
	if err != nil {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	return b.Status(ctx, ref)
}

func (c *ClusterDriver) Exec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error) {
	b, err := c.backend(ref)
	if err != nil {
		return ExecResult{}, err
	}
	return b.Exec(ctx, ref, req)
}

func (c *ClusterDriver) Connect(ctx context.Context, ref NodeRef, a labsv1.AccessType) (labsv1.Endpoint, error) {
	b, err := c.backend(ref)
	if err != nil {
		return labsv1.Endpoint{}, err
	}
	return b.Connect(ctx, ref, a)
}

// Hibernate dispatches to the backend; a backend without hibernation keeps running.
func (c *ClusterDriver) Hibernate(ctx context.Context, ref NodeRef) error {
	b, err := c.backend(ref)
	if err != nil {
		return err
	}
	h, ok := b.(Hibernator)
	if !ok {
		return fmt.Errorf("cluster mode backend %T cannot hibernate: %w", b, ErrUnsupported)
	}
	return h.Hibernate(ctx, ref)
}

var _ Hibernator = (*ClusterDriver)(nil)

func (c *ClusterDriver) Reset(ctx context.Context, ref NodeRef) error {
	b, err := c.backend(ref)
	if err != nil {
		return err
	}
	return b.Reset(ctx, ref)
}

func (c *ClusterDriver) Destroy(ctx context.Context, ref NodeRef) error {
	b, err := c.backend(ref)
	if err != nil {
		return err
	}
	return b.Destroy(ctx, ref)
}
