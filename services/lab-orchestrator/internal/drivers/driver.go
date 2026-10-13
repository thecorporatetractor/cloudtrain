// Package drivers defines the NodeDriver interface that runs topology nodes
// and a registry of driver implementations.
package drivers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// NodeRef identifies one topology node of one session. Template is the
// session's template with params already resolved.
type NodeRef struct {
	Session  *labsv1.LabSession
	Template *labsv1.LabTemplateSpec
	Node     labsv1.Node
}

// Namespace the node's resources live in (the session's namespace).
func (r NodeRef) Namespace() string { return r.Session.Namespace }

// ResourceName is the DNS-1035 compatible base name for the node's
// Kubernetes objects: "<session>-<node>", shortened with a hash if needed.
func (r NodeRef) ResourceName() string { return ResourceName(r.Session.Name, r.Node.Name) }

// ResourceName builds "<session>-<node>" limited to 63 characters.
func ResourceName(session, node string) string {
	name := session + "-" + node
	if name[0] >= '0' && name[0] <= '9' {
		name = "ls-" + name
	}
	if len(name) <= 63 {
		return name
	}
	sum := sha256.Sum256([]byte(name))
	return name[:52] + "-" + hex.EncodeToString(sum[:])[:10]
}

// NodeState is what a driver observed about a node.
type NodeState struct {
	Phase   labsv1.NodePhase
	Message string
}

// ExecKind tells the driver how to interpret an ExecRequest.
type ExecKind string

const (
	// ExecShell runs Command (argv) on the node.
	ExecShell ExecKind = "shell"
	// ExecKubeApply applies Stdin as a manifest to the node's cluster.
	ExecKubeApply ExecKind = "kube-apply"
	// ExecDeviceConfig pushes Stdin as configuration to a network device.
	ExecDeviceConfig ExecKind = "device-config"
)

// ExecRequest runs something on a node out of band (setup, checks, resets).
type ExecRequest struct {
	Kind ExecKind
	// Member addresses a member of a kubeadm cluster node ("node/member").
	Member  string
	User    labsv1.ActionUser
	Command []string
	Stdin   []byte
	Timeout time.Duration
}

// ExecResult of an ExecRequest. A non-zero ExitCode is not an error.
type ExecResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

// NodeDriver provisions and operates one kind of topology node. All methods
// must be idempotent: the reconciler calls Provision on every pass.
type NodeDriver interface {
	// Name is the driver name used in lab.yaml (container, vm, ...).
	Name() labsv1.DriverName
	// Provision creates the node's backing resources if absent and returns
	// the current state.
	Provision(ctx context.Context, ref NodeRef) (NodeState, error)
	// Status observes the node without changing anything.
	Status(ctx context.Context, ref NodeRef) (NodeState, error)
	// Exec runs a command / manifest / config on the node.
	Exec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error)
	// Connect returns how the access gateway reaches the given access point.
	Connect(ctx context.Context, ref NodeRef, access labsv1.AccessType) (labsv1.Endpoint, error)
	// Reset returns the node to its freshly provisioned state.
	Reset(ctx context.Context, ref NodeRef) error
	// Destroy removes all backing resources. Destroying an absent node is not an error.
	Destroy(ctx context.Context, ref NodeRef) error
}

// Hibernator is implemented by drivers that can release compute while
// keeping the node's identity; Provision resumes a hibernated node.
type Hibernator interface {
	Hibernate(ctx context.Context, ref NodeRef) error
}

var (
	// ErrNotImplemented is returned by drivers (or operations) not built yet.
	ErrNotImplemented = errors.New("not implemented")
	// ErrUnsupported is returned for operations a driver can never perform,
	// e.g. RDP access to a container.
	ErrUnsupported = errors.New("unsupported")
)

// NotImplementedError reports a missing driver operation.
type NotImplementedError struct {
	Driver  labsv1.DriverName
	Backend string
	Op      string
}

func (e *NotImplementedError) Error() string {
	return fmt.Sprintf("driver %s (%s): %s not implemented", e.Driver, e.Backend, e.Op)
}

// Is makes errors.Is(err, ErrNotImplemented) work.
func (e *NotImplementedError) Is(target error) bool { return target == ErrNotImplemented }

// IsPermanent reports whether retrying err cannot succeed, so the node (and
// session) should be marked Failed instead of requeued.
func IsPermanent(err error) bool {
	return errors.Is(err, ErrNotImplemented) || errors.Is(err, ErrUnsupported)
}
