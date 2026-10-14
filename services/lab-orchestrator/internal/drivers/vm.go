package drivers

import (
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Defaults for vm nodes without resources.
const (
	defaultVMCores  = 1
	defaultVMMemMiB = 1024
)

// VMDriver runs a vm node as a KubeVirt VirtualMachine from a catalog
// containerDisk on the session's lab network. The VM gets the learner
// account (passwordless sudo) and is reachable as `ssh <node>` from the
// entry node; admin commands run as root over ssh from the entry node's
// admin sidecar.
type VMDriver struct {
	Client    client.Client
	Reader    client.Reader
	Catalog   *ImageCatalog
	Container *ContainerDriver
	Session   *SessionRuntime
	// ImageRegistry prefixes containerDisk images (see ContainerDriver.ImageFor).
	ImageRegistry string
	// Disks selects ephemeral (containerDisk) or persistent root disks.
	Disks VMDiskOptions
}

var (
	_ NodeDriver     = (*VMDriver)(nil)
	_ AccessProvider = (*VMDriver)(nil)
	_ Hibernator     = (*VMDriver)(nil)
)

func (d *VMDriver) Name() labsv1.DriverName { return labsv1.DriverVM }

func (d *VMDriver) reader() client.Reader {
	if d.Reader != nil {
		return d.Reader
	}
	return d.Client
}

func (d *VMDriver) host(ref NodeRef) (PlannedHost, error) {
	for _, h := range HostPlan(&ref.Template.Topology) {
		if h.Node == ref.Node.Name && h.Member == "" {
			return h, nil
		}
	}
	return PlannedHost{}, fmt.Errorf("vm node %s has no lab address: %w", ref.Node.Name, ErrUnsupported)
}

// secretName holds the VM's host key and cloud-init.
func (d *VMDriver) secretName(ref NodeRef) string { return ref.ResourceName() + "-vm" }

func vmLabels(ref NodeRef, member string) map[string]string {
	l := SessionLabels(ref.Session)
	l[LabelNode] = LabelValue(ref.Node.Name)
	if member != "" {
		l[LabelMember] = LabelValue(member)
	}
	return l
}

// Provision creates the host key, cloud-init and VM, then waits until the VM
// runs and cloud-init finished (checked once per VM incarnation over ssh).
func (d *VMDriver) Provision(ctx context.Context, ref NodeRef) (NodeState, error) {
	fail := func(err error) (NodeState, error) {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	img, err := d.Catalog.Resolve(ref.Node.Image, ImageKindContainerDisk)
	if err != nil {
		return fail(err)
	}
	h, err := d.host(ref)
	if err != nil {
		return fail(err)
	}
	sec, err := d.secret(ctx, ref, h)
	if err != nil {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
	}
	cores, mem := vmResources(ref.Node.Resources, defaultVMCores, defaultVMMemMiB)
	vm := buildVM(ref.Session, NewLabNet(ref.Session), vmSpec{
		Name: ref.ResourceName(), Hostname: h.Name, IP: h.IP, Image: imageWithRegistry(d.ImageRegistry, img.Image),
		Cores: cores, MemMiB: mem, CISecret: sec, Labels: vmLabels(ref, ""),
		Disk: d.Disks, DiskSize: img.DiskSize,
	})
	if err := setOwner(ref.Session, vm, d.Client); err != nil {
		return fail(err)
	}
	if err := ensure(ctx, d.Client, d.reader(), ref.Session, vm); err != nil {
		if IsPermanent(err) {
			return fail(err)
		}
		return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
	}
	if d.Disks.Persistent { // resume after hibernate
		if err := setRunStrategy(ctx, d.Client, d.reader(), ref.Namespace(), []string{vm.GetName()}, "Always"); err != nil {
			return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
		}
	}
	return d.observe(ctx, ref, h, true)
}

// secret creates (once) the VM's Secret with its host key and cloud-init.
func (d *VMDriver) secret(ctx context.Context, ref NodeRef, h PlannedHost) (string, error) {
	name := d.secretName(ref)
	if err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: name}, &corev1.Secret{}); err == nil {
		return name, nil
	}
	learnerPub, adminPub, err := d.Session.SessionKeys(ctx, ref.Session)
	if err != nil {
		return "", fmt.Errorf("session keys: %w", err)
	}
	hk, err := NewSSHKeyPair("root@" + h.Name)
	if err != nil {
		return "", err
	}
	ud, err := cloudInit{Hostname: h.Name, LearnerPub: learnerPub, AdminPub: adminPub, HostKey: hk,
		Hosts: HostPlan(&ref.Template.Topology)}.Render()
	if err != nil {
		return "", err
	}
	return name, ensureSecret(ctx, d.Client, d.reader(), ref.Session, name, map[string][]byte{
		"userdata": ud, "hostkey.pub": hk.Public,
	})
}

func (d *VMDriver) observe(ctx context.Context, ref NodeRef, h PlannedHost, converge bool) (NodeState, error) {
	name := ref.ResourceName()
	st, err := observeVMIs(ctx, d.reader(), ref.Namespace(), []string{name})
	if err != nil {
		return NodeState{}, err
	}
	if st.running < st.total {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: "VM booting: " + strings.Join(st.waiting, ", ")}, nil
	}
	boot, instance := st.instance, st.instance
	if d.Disks.Persistent {
		if instance, err = vmIdentity(ctx, d.reader(), ref.Namespace(), []string{name}); err != nil {
			return NodeState{}, err
		}
	}
	state := NodeState{Phase: labsv1.NodeReady, InstanceID: instance, Details: map[string]string{"ip": h.IP}}
	done, err := vmAnnotation(ctx, d.reader(), ref.Namespace(), name, AnnotationBootstrapped)
	if err != nil {
		return NodeState{}, err
	}
	if done == instance && boot != instance {
		// Bootstrapped disk, new boot (resume): wait until ssh answers again.
		booted, err := vmAnnotation(ctx, d.reader(), ref.Namespace(), name, AnnotationBooted)
		if err != nil {
			return NodeState{}, err
		}
		if booted == boot {
			return state, nil
		}
	} else if done == instance {
		return state, nil
	}
	if !converge {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: "waiting for cloud-init", InstanceID: instance}, nil
	}
	res, err := execOnHost(ctx, d.Container, ref, h.Name, ExecRequest{
		Command: []string{"/bin/sh", "-c", "timeout 20 cloud-init status --wait >/dev/null 2>&1; cloud-init status 2>/dev/null | grep -q 'status: done' && echo READY || echo WAIT"},
		Timeout: 40 * time.Second,
	})
	if err != nil || res.ExitCode != 0 || !strings.Contains(res.Stdout, "READY") {
		msg := "waiting for ssh and cloud-init on " + h.Name
		return NodeState{Phase: labsv1.NodeProvisioning, Message: msg, InstanceID: instance}, nil
	}
	if err := annotateVMWith(ctx, d.Client, ref.Namespace(), name,
		map[string]string{AnnotationBootstrapped: instance, AnnotationBooted: boot}); err != nil {
		return NodeState{}, err
	}
	return state, nil
}

// Hibernate stops a VM with a persistent disk (runStrategy Halted); the
// next Provision starts it again. A VM on an ephemeral containerDisk keeps
// running (stopping it would discard the learner's changes).
func (d *VMDriver) Hibernate(ctx context.Context, ref NodeRef) error {
	if !d.Disks.Persistent {
		return fmt.Errorf("vm %s boots from an ephemeral disk: %w", ref.Node.Name, ErrUnsupported)
	}
	return client.IgnoreNotFound(setRunStrategy(ctx, d.Client, d.reader(), ref.Namespace(), []string{ref.ResourceName()}, "Halted"))
}

// Status observes the VM without changing anything.
func (d *VMDriver) Status(ctx context.Context, ref NodeRef) (NodeState, error) {
	if ref.Session.Spec.Hibernate && d.Disks.Persistent {
		return stoppedState(ctx, d.reader(), ref.Namespace(), []string{ref.ResourceName()})
	}
	h, err := d.host(ref)
	if err != nil {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	return d.observe(ctx, ref, h, false)
}

// Access contributes the VM's host entry once its host key exists.
func (d *VMDriver) Access(ctx context.Context, ref NodeRef) (NodeAccess, bool, error) {
	h, err := d.host(ref)
	if err != nil {
		return NodeAccess{}, false, err
	}
	sec := &corev1.Secret{}
	if err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: d.secretName(ref)}, sec); err != nil {
		return NodeAccess{}, false, client.IgnoreNotFound(err)
	}
	return NodeAccess{Hosts: []HostAccess{{Name: h.Name, IP: h.IP, HostKey: sec.Data["hostkey.pub"]}}}, true, nil
}

// Exec runs a shell command on the VM over ssh (root for admin, the learner
// account for learner).
func (d *VMDriver) Exec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error) {
	if req.Member != "" {
		return ExecResult{}, fmt.Errorf("vm node %s has no members: %w", ref.Node.Name, ErrUnsupported)
	}
	return execOnHost(ctx, d.Container, ref, ref.Node.Name, req)
}

// Connect: ssh through the entry node, or the KubeVirt serial console.
func (d *VMDriver) Connect(_ context.Context, ref NodeRef, access labsv1.AccessType) (labsv1.Endpoint, error) {
	h, err := d.host(ref)
	if err != nil {
		return labsv1.Endpoint{}, err
	}
	switch access {
	case labsv1.AccessSSH:
		return hostEndpoint(ref, h.IP)
	case labsv1.AccessConsole:
		return labsv1.Endpoint{Node: ref.Node.Name, Access: access, Protocol: "kubevirt-console",
			Target: ref.Namespace() + "/" + ref.ResourceName()}, nil
	}
	return labsv1.Endpoint{}, fmt.Errorf("vm driver: %s access: %w", access, ErrUnsupported)
}

// Reset deletes the VM (and its persistent disk); the next Provision
// recreates it from the image. ErrInProgress until the old VM and disk are
// gone, so the new VM never adopts the old disk.
func (d *VMDriver) Reset(ctx context.Context, ref NodeRef) error {
	gone, err := deleteVMs(ctx, d.Client, d.reader(), ref.Session, []string{ref.ResourceName()})
	if err != nil {
		return err
	}
	if !gone {
		return inProgress("VM %s is being deleted for reset", ref.ResourceName())
	}
	return nil
}

// Destroy deletes the VM and its Secret; ErrInProgress until the VM is gone.
func (d *VMDriver) Destroy(ctx context.Context, ref NodeRef) error {
	gone, err := deleteVMs(ctx, d.Client, d.reader(), ref.Session, []string{ref.ResourceName()})
	if err != nil {
		return err
	}
	if _, err := deleteIfOwned(ctx, d.Client, d.reader(), ref.Session,
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: d.secretName(ref)}}); err != nil {
		return err
	}
	if !gone {
		return inProgress("VM %s is terminating", ref.ResourceName())
	}
	return nil
}

// imageWithRegistry prefixes an unqualified image with registry.
func imageWithRegistry(registry, image string) string {
	return (&ContainerDriver{ImageRegistry: registry}).ImageFor(image)
}
