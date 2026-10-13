// Package drivers defines the NodeDriver interface that runs topology nodes
// and a registry of driver implementations.
package drivers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// NodeRef identifies one topology node of one session. Template is the
// session's template with params already resolved. During teardown it may
// only carry the topology recorded in the session status (the live template
// can be gone), so Destroy must rely on Session and Node alone.
type NodeRef struct {
	Session  *labsv1.LabSession
	Template *labsv1.LabTemplateSpec
	Node     labsv1.Node
}

// Namespace the node's resources live in (the session's namespace).
func (r NodeRef) Namespace() string { return r.Session.Namespace }

// ResourceName is the DNS-1035 base name for the node's Kubernetes objects.
func (r NodeRef) ResourceName() string {
	return ResourceName(r.Session.Name, string(r.Session.UID), r.Node.Name)
}

// ResourceName builds "<session>-<node>-<hash>", at most 63 characters. The
// hash covers session name, UID and node separately, so "lab-x"/"web" and
// "lab"/"x-web" (or a recreated session of the same name) never collide.
// '.' (valid in session names, invalid in Service names) becomes '-'.
func ResourceName(session, uid, node string) string {
	sum := sha256.Sum256([]byte(session + "\x00" + uid + "\x00" + node))
	suffix := "-" + hex.EncodeToString(sum[:])[:8]
	base := strings.ReplaceAll(session+"-"+node, ".", "-")
	if base[0] < 'a' || base[0] > 'z' {
		base = "ls-" + base
	}
	if max := 63 - len(suffix); len(base) > max {
		base = base[:max]
	}
	return strings.TrimRight(base, "-") + suffix
}

// LabelValue fits s into a label value (63 chars), hashing longer values.
func LabelValue(s string) string {
	if len(s) <= 63 {
		return s
	}
	sum := sha256.Sum256([]byte(s))
	return strings.TrimRight(s[:52], "-_.") + "-" + hex.EncodeToString(sum[:])[:10]
}

// NodeState is what a driver observed about a node.
type NodeState struct {
	Phase   labsv1.NodePhase
	Message string
	// InstanceID identifies the backing instance (pod UID + restarts, VM
	// UID, ...). When it changes the node was recreated and lost its setup.
	InstanceID string
	// Details are facts for the grader and other nodes (addresses, member states).
	Details map[string]string
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
// keeping the node's identity; Provision resumes a hibernated node. While a
// node is hibernated, Status must report labsv1.NodeHibernated.
type Hibernator interface {
	Hibernate(ctx context.Context, ref NodeRef) error
}

// SessionRef identifies a session and its resolved template, for
// topology-wide resources.
type SessionRef struct {
	Session  *labsv1.LabSession
	Template *labsv1.LabTemplateSpec
}

// TopologyProvisioner is implemented by drivers that need session-scoped
// resources shared by their nodes: links / Multus NADs / impairment for
// netdev, a shared network for kubeadm VMs. The reconciler calls
// ProvisionTopology (idempotent) before provisioning any node of that
// driver, and DestroyTopology after all nodes were destroyed.
type TopologyProvisioner interface {
	ProvisionTopology(ctx context.Context, ref SessionRef) (ready bool, err error)
	DestroyTopology(ctx context.Context, ref SessionRef) error
}

var (
	// ErrNotImplemented is returned by drivers (or operations) not built yet.
	ErrNotImplemented = errors.New("not implemented")
	// ErrUnsupported is returned for operations a driver can never perform,
	// e.g. RDP access to a container.
	ErrUnsupported = errors.New("unsupported")
	// ErrConflict is returned when an object with the node's name exists but
	// belongs to something else; the driver will not adopt or delete it.
	ErrConflict = errors.New("resource name conflict")
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
	return errors.Is(err, ErrNotImplemented) || errors.Is(err, ErrUnsupported) || errors.Is(err, ErrConflict)
}
