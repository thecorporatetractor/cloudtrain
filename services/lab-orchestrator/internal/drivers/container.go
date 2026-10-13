package drivers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	utilexec "k8s.io/client-go/util/exec"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Labels set on every object a driver creates.
const (
	LabelSession    = "labs.cloudtrain.dev/session"
	LabelSessionUID = "labs.cloudtrain.dev/session-uid"
	LabelNode       = "labs.cloudtrain.dev/node"
	LabelManagedBy  = "app.kubernetes.io/managed-by"
	ManagedBy       = "cloudtrain-lab-orchestrator"

	// ContainerName is the name of the main container of a container node.
	ContainerName = "node"
	// LearnerUser is the unprivileged account images provide for as=learner.
	LearnerUser = "learner"
)

// Well-known ports exposed by container nodes.
const (
	PortSSH = 22
	PortWeb = 80
)

// PodExecutor runs a command in a pod container.
type PodExecutor interface {
	Exec(ctx context.Context, namespace, pod, container string, cmd []string, stdin io.Reader, stdout, stderr io.Writer) error
}

// ContainerDriver runs a node as a Pod (Kata via RuntimeClass in production,
// runc locally) plus a ClusterIP Service, e.g. the learner's jumphost.
type ContainerDriver struct {
	Client client.Client
	// Reader, when set, is an uncached reader (mgr.GetAPIReader()) used to
	// inspect name conflicts the label-filtered cache cannot see.
	Reader client.Reader
	// Scheme, when set, is used to make the session the controller owner of
	// the Pod and Service so they are garbage-collected with it.
	Scheme *runtime.Scheme
	// ImageRegistry prefixes catalog image refs without a registry
	// ("jumphost:1" -> "<ImageRegistry>/jumphost:1").
	ImageRegistry string
	// RuntimeClassName, e.g. "kata"; empty uses the cluster default.
	RuntimeClassName string
	// ClusterDomain for Service DNS names (default "cluster.local").
	ClusterDomain string
	// Executor runs Exec requests; nil makes Exec return ErrNotImplemented.
	Executor PodExecutor
	// Catalog, when set, resolves node image refs (unknown refs fail the node).
	Catalog *ImageCatalog
	// AdminImage is the image of the entry node's admin sidecar (ssh client
	// + kubectl); empty uses the entry node's own image.
	AdminImage string
	// Network, when set, wires nodes with topology links into the session
	// network (see links.go); without it such nodes fail as unsupported.
	Network PodNetwork
}

// ContainerDriver deliberately does not implement Hibernator: deleting the
// Pod would discard the learner's work, and container nodes are cheap enough
// to keep running. State-preserving hibernation belongs to the vm and
// k8s-cluster drivers (stop the VM, keep its disk).
var _ NodeDriver = (*ContainerDriver)(nil)

func (d *ContainerDriver) Name() labsv1.DriverName { return labsv1.DriverContainer }

func (d *ContainerDriver) labels(ref NodeRef) map[string]string {
	l := d.selector(ref)
	l[LabelManagedBy] = ManagedBy
	return l
}

// selector identifies the node's objects; it includes the session UID so a
// recreated session never adopts its predecessor's pod.
func (d *ContainerDriver) selector(ref NodeRef) map[string]string {
	l := map[string]string{
		LabelSession: LabelValue(ref.Session.Name),
		LabelNode:    LabelValue(ref.Node.Name),
	}
	if ref.Session.UID != "" {
		l[LabelSessionUID] = string(ref.Session.UID)
	}
	return l
}

// owns reports whether obj was created by this driver for ref.
func (d *ContainerDriver) owns(ref NodeRef, obj client.Object) bool {
	got := obj.GetLabels()
	for k, v := range d.labels(ref) {
		if got[k] != v {
			return false
		}
	}
	if ref.Session.UID != "" {
		for _, o := range obj.GetOwnerReferences() {
			if o.Controller != nil && *o.Controller && o.UID != ref.Session.UID {
				return false
			}
		}
	}
	return true
}

func (d *ContainerDriver) conflict(ref NodeRef, obj client.Object) error {
	return fmt.Errorf("%T %s/%s exists but does not belong to session %s node %s: %w",
		obj, obj.GetNamespace(), obj.GetName(), ref.Session.Name, ref.Node.Name, ErrConflict)
}

// ImageFor resolves a catalog image ref to a pullable image.
func (d *ContainerDriver) ImageFor(ref string) string {
	if d.ImageRegistry == "" {
		return ref
	}
	first, _, hasSlash := strings.Cut(ref, "/")
	if hasSlash && (strings.ContainsAny(first, ".:") || first == "localhost") {
		return ref // already fully qualified
	}
	return strings.TrimSuffix(d.ImageRegistry, "/") + "/" + ref
}

// servicePorts lists the Service ports for a node's access points. Every
// container node exposes ssh so other lab nodes (and the jumphost's ssh
// config) can reach it.
func servicePorts(n labsv1.Node) []corev1.ServicePort {
	ports := []corev1.ServicePort{{Name: "ssh", Port: PortSSH, TargetPort: intstr.FromInt32(PortSSH), Protocol: corev1.ProtocolTCP}}
	for _, a := range n.Access {
		if a == labsv1.AccessWeb {
			ports = append(ports, corev1.ServicePort{Name: "web", Port: PortWeb, TargetPort: intstr.FromInt32(PortWeb), Protocol: corev1.ProtocolTCP})
		}
	}
	return ports
}

// BuildPod renders the Pod for a container node.
func (d *ContainerDriver) BuildPod(ref NodeRef) *corev1.Pod {
	n := ref.Node
	var cports []corev1.ContainerPort
	for _, p := range servicePorts(n) {
		cports = append(cports, corev1.ContainerPort{Name: p.Name, ContainerPort: p.Port, Protocol: corev1.ProtocolTCP})
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      ref.ResourceName(),
			Namespace: ref.Namespace(),
			Labels:    d.labels(ref),
		},
		Spec: corev1.PodSpec{
			Hostname:                     n.Name,
			RestartPolicy:                corev1.RestartPolicyAlways,
			AutomountServiceAccountToken: ptr.To(false),
			EnableServiceLinks:           ptr.To(false),
			Containers: []corev1.Container{{
				Name:      ContainerName,
				Image:     d.ImageFor(d.catalogImage(n.Image)),
				Ports:     cports,
				Resources: containerResources(n.Resources),
				Stdin:     true,
				TTY:       true,
			}},
		},
	}
	if d.RuntimeClassName != "" {
		pod.Spec.RuntimeClassName = ptr.To(d.RuntimeClassName)
	}
	if isEntry(ref) {
		d.decorateEntryPod(ref, pod)
	}
	return pod
}

// catalogImage maps a catalog ref to its image; without a catalog (or for
// an unknown ref, which Provision rejects) the ref is used as is.
func (d *ContainerDriver) catalogImage(ref string) string {
	if d.Catalog == nil {
		return ref
	}
	if img, err := d.Catalog.Resolve(ref, ImageKindContainer); err == nil {
		return img.Image
	}
	return ref
}

func containerResources(r *labsv1.NodeResources) corev1.ResourceRequirements {
	out := corev1.ResourceRequirements{}
	if r == nil {
		return out
	}
	req, lim := corev1.ResourceList{}, corev1.ResourceList{}
	if r.CPU != nil {
		req[corev1.ResourceCPU] = r.CPU.DeepCopy()
		lim[corev1.ResourceCPU] = r.CPU.DeepCopy()
	}
	if r.MemoryMiB != nil {
		q := resource.NewQuantity(*r.MemoryMiB*1024*1024, resource.BinarySI)
		req[corev1.ResourceMemory] = *q
		lim[corev1.ResourceMemory] = q.DeepCopy()
	}
	if len(req) > 0 {
		out.Requests, out.Limits = req, lim
	}
	return out
}

// BuildService renders the Service for a container node.
func (d *ContainerDriver) BuildService(ref NodeRef) *corev1.Service {
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      ref.ResourceName(),
			Namespace: ref.Namespace(),
			Labels:    d.labels(ref),
		},
		Spec: corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: d.selector(ref),
			Ports:    servicePorts(ref.Node),
		},
	}
}

// createIfAbsent creates obj unless an object of that name exists. An
// existing object is only accepted if it carries this node's labels (and
// owner); otherwise a permanent ErrConflict is returned.
func (d *ContainerDriver) createIfAbsent(ctx context.Context, ref NodeRef, obj client.Object) error {
	if d.Scheme != nil {
		if err := controllerutil.SetControllerReference(ref.Session, obj, d.Scheme); err != nil {
			return err
		}
	}
	existing := obj.DeepCopyObject().(client.Object)
	err := d.Client.Get(ctx, client.ObjectKeyFromObject(obj), existing)
	if err == nil {
		if !d.owns(ref, existing) {
			return d.conflict(ref, existing)
		}
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return err
	}
	err = d.Client.Create(ctx, obj)
	if err == nil {
		return nil
	}
	if !apierrors.IsAlreadyExists(err) {
		return err
	}
	// Not in the (label-filtered) cache but present: inspect it directly.
	r := d.Reader
	if r == nil {
		r = d.Client
	}
	existing = obj.DeepCopyObject().(client.Object)
	if gerr := r.Get(ctx, client.ObjectKeyFromObject(obj), existing); gerr != nil {
		return fmt.Errorf("%s exists but cannot be read: %w", obj.GetName(), gerr)
	}
	if !d.owns(ref, existing) {
		return d.conflict(ref, existing)
	}
	return nil
}

// Provision creates the Service and Pod if absent and reports pod state.
func (d *ContainerDriver) Provision(ctx context.Context, ref NodeRef) (NodeState, error) {
	if ref.Node.Image == "" {
		err := fmt.Errorf("container node %q has no image: %w", ref.Node.Name, ErrUnsupported)
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	if d.Catalog != nil {
		if _, err := d.Catalog.Resolve(ref.Node.Image, ImageKindContainer); err != nil {
			return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
		}
	}
	if err := d.createIfAbsent(ctx, ref, d.BuildService(ref)); err != nil {
		return NodeState{Phase: labsv1.NodePending, Message: err.Error()}, fmt.Errorf("service: %w", err)
	}
	pod := d.BuildPod(ref)
	if err := d.decoratePod(ref, pod, false); err != nil {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	if err := d.createIfAbsent(ctx, ref, pod); err != nil {
		return NodeState{Phase: labsv1.NodePending, Message: err.Error()}, fmt.Errorf("pod: %w", err)
	}
	return d.Status(ctx, ref)
}

// Status maps the Pod state onto a node phase.
func (d *ContainerDriver) Status(ctx context.Context, ref NodeRef) (NodeState, error) {
	pod := &corev1.Pod{}
	err := d.Client.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, pod)
	if apierrors.IsNotFound(err) {
		return NodeState{Phase: labsv1.NodePending, Message: "pod not created"}, nil
	}
	if err != nil {
		return NodeState{}, err
	}
	if !d.owns(ref, pod) {
		return NodeState{Phase: labsv1.NodeFailed, Message: d.conflict(ref, pod).Error()}, d.conflict(ref, pod)
	}
	st, err := podState(pod)
	st.InstanceID = podInstanceID(pod)
	return st, err
}

func podState(pod *corev1.Pod) (NodeState, error) {
	if pod.DeletionTimestamp != nil {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: "pod terminating"}, nil
	}
	switch pod.Status.Phase {
	case corev1.PodFailed, corev1.PodSucceeded:
		return NodeState{Phase: labsv1.NodeFailed, Message: fmt.Sprintf("pod %s: %s", strings.ToLower(string(pod.Status.Phase)), pod.Status.Message)}, nil
	case corev1.PodRunning:
		for _, c := range pod.Status.Conditions {
			if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
				st := NodeState{Phase: labsv1.NodeReady}
				if pod.Status.PodIP != "" {
					st.Details = map[string]string{"ip": pod.Status.PodIP}
				}
				return st, nil
			}
		}
	}
	msg := "pod " + strings.ToLower(string(pod.Status.Phase))
	for _, cs := range pod.Status.ContainerStatuses {
		if w := cs.State.Waiting; w != nil && w.Reason != "" {
			msg = fmt.Sprintf("%s: %s", msg, w.Reason)
		}
	}
	return NodeState{Phase: labsv1.NodeProvisioning, Message: msg}, nil
}

// podInstanceID changes whenever the node's filesystem was reset: a new pod
// (UID) or a container restart (RestartPolicy Always discards the writable
// layer).
func podInstanceID(pod *corev1.Pod) string {
	var restarts int32
	for _, cs := range pod.Status.ContainerStatuses {
		// The admin sidecar's files are wired at runtime too, so its restarts
		// count as a reset as well.
		if cs.Name == ContainerName || cs.Name == AdminContainerName {
			restarts += cs.RestartCount
		}
	}
	return fmt.Sprintf("%s/%d", pod.UID, restarts)
}

// Connect returns the endpoint for an access point.
func (d *ContainerDriver) Connect(_ context.Context, ref NodeRef, access labsv1.AccessType) (labsv1.Endpoint, error) {
	domain := d.ClusterDomain
	if domain == "" {
		domain = "cluster.local"
	}
	host := fmt.Sprintf("%s.%s.svc.%s", ref.ResourceName(), ref.Namespace(), domain)
	ep := labsv1.Endpoint{Node: ref.Node.Name, Access: access}
	switch access {
	case labsv1.AccessShell:
		ep.Protocol = "k8s-exec"
		ep.Target = fmt.Sprintf("%s/%s/%s", ref.Namespace(), ref.ResourceName(), ContainerName)
	case labsv1.AccessSSH:
		ep.Protocol, ep.Host, ep.Port = "ssh", host, PortSSH
	case labsv1.AccessWeb:
		ep.Protocol, ep.Host, ep.Port = "http", host, PortWeb
		ep.URL = fmt.Sprintf("http://%s:%d/", host, PortWeb)
	default:
		return labsv1.Endpoint{}, fmt.Errorf("container driver: %s access: %w", access, ErrUnsupported)
	}
	return ep, nil
}

// Exec runs a shell request in the node container.
func (d *ContainerDriver) Exec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error) {
	if req.Kind != "" && req.Kind != ExecShell {
		return ExecResult{}, fmt.Errorf("container driver: exec kind %s: %w", req.Kind, ErrUnsupported)
	}
	if req.Member != "" {
		return ExecResult{}, fmt.Errorf("container driver: cluster member %q: %w", req.Member, ErrUnsupported)
	}
	return d.ExecIn(ctx, ref, ContainerName, req)
}

// learnerEnv is the environment of a learner login: commands run as the
// learner see the learner's HOME (kubeconfig, ssh config) and start there.
var learnerEnv = []string{
	"env", "-i", "HOME=/home/" + LearnerUser, "USER=" + LearnerUser, "LOGNAME=" + LearnerUser,
	"SHELL=/bin/bash", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "TERM=dumb",
	"/bin/sh", "-c", `cd "$HOME" && exec "$@"`, "sh",
}

// ExecIn runs req.Command in one container of the node's pod. User learner
// switches to the learner account (runuser) with a login-like environment.
func (d *ContainerDriver) ExecIn(ctx context.Context, ref NodeRef, container string, req ExecRequest) (ExecResult, error) {
	if len(req.Command) == 0 {
		return ExecResult{}, errors.New("container driver: empty command")
	}
	if d.Executor == nil {
		return ExecResult{}, &NotImplementedError{Driver: labsv1.DriverContainer, Backend: "pod", Op: "exec without executor"}
	}
	cmd := req.Command
	if req.User == labsv1.ActionAsLearner {
		cmd = append(append([]string{"runuser", "-u", LearnerUser, "--"}, learnerEnv...), cmd...)
	}
	if req.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, req.Timeout)
		defer cancel()
	}
	var stdin io.Reader
	if req.Stdin != nil {
		stdin = bytes.NewReader(req.Stdin)
	}
	var stdout, stderr bytes.Buffer
	err := d.Executor.Exec(ctx, ref.Namespace(), ref.ResourceName(), container, cmd, stdin, &stdout, &stderr)
	res := ExecResult{Stdout: stdout.String(), Stderr: stderr.String()}
	var exitErr utilexec.ExitError
	if errors.As(err, &exitErr) {
		res.ExitCode = exitErr.ExitStatus()
		return res, nil
	}
	if err != nil && ctx.Err() != nil {
		return res, fmt.Errorf("exec in %s/%s: %w", ref.ResourceName(), container, ctx.Err())
	}
	return res, err
}

// Reset deletes the Pod; the next Provision recreates it from the image.
func (d *ContainerDriver) Reset(ctx context.Context, ref NodeRef) error {
	return d.deletePod(ctx, ref)
}

// Destroy deletes the Pod and the Service.
func (d *ContainerDriver) Destroy(ctx context.Context, ref NodeRef) error {
	if err := d.deletePod(ctx, ref); err != nil {
		return err
	}
	return d.deleteOwned(ctx, ref, &corev1.Service{})
}

func (d *ContainerDriver) deletePod(ctx context.Context, ref NodeRef) error {
	return d.deleteOwned(ctx, ref, &corev1.Pod{}, client.PropagationPolicy(metav1.DeletePropagationBackground))
}

// deleteOwned deletes the node's object of obj's kind, but only if it is
// ours (and still the same object, via a UID precondition). Someone else's
// object of that name yields ErrConflict and is left alone.
func (d *ContainerDriver) deleteOwned(ctx context.Context, ref NodeRef, obj client.Object, opts ...client.DeleteOption) error {
	err := d.Client.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, obj)
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !d.owns(ref, obj) {
		return d.conflict(ref, obj)
	}
	uid := obj.GetUID()
	opts = append(opts, client.Preconditions{UID: &uid})
	return client.IgnoreNotFound(d.Client.Delete(ctx, obj, opts...))
}

// RESTPodExecutor execs into pods through the API server (SPDY, falling
// back from WebSocket).
type RESTPodExecutor struct {
	Config    *rest.Config
	Clientset kubernetes.Interface
}

// NewRESTPodExecutor builds a RESTPodExecutor from a rest config.
func NewRESTPodExecutor(cfg *rest.Config) (*RESTPodExecutor, error) {
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	return &RESTPodExecutor{Config: cfg, Clientset: cs}, nil
}

// Exec implements PodExecutor.
func (e *RESTPodExecutor) Exec(ctx context.Context, namespace, pod, container string, cmd []string, stdin io.Reader, stdout, stderr io.Writer) error {
	req := e.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").Namespace(namespace).Name(pod).SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   cmd,
			Stdin:     stdin != nil,
			Stdout:    true,
			Stderr:    true,
		}, scheme.ParameterCodec)
	spdyExec, err := remotecommand.NewSPDYExecutor(e.Config, "POST", req.URL())
	if err != nil {
		return err
	}
	wsExec, err := remotecommand.NewWebSocketExecutor(e.Config, "GET", req.URL().String())
	if err != nil {
		return err
	}
	ex, err := remotecommand.NewFallbackExecutor(wsExec, spdyExec, func(err error) bool {
		return httpstream.IsUpgradeFailure(err) || httpstream.IsHTTPSProxyError(err)
	})
	if err != nil {
		return err
	}
	return ex.StreamWithContext(ctx, remotecommand.StreamOptions{Stdin: stdin, Stdout: stdout, Stderr: stderr})
}
