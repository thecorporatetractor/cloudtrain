package drivers

import (
	"context"
	"fmt"

	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// RuntimeOptions configures the real lab runtime.
type RuntimeOptions struct {
	Client client.Client
	// Reader is an uncached reader (mgr.GetAPIReader()).
	Reader        client.Reader
	Scheme        *runtime.Scheme
	Executor      PodExecutor
	Catalog       *ImageCatalog
	ImageRegistry string
	// RuntimeClassName for container nodes (e.g. "kata").
	RuntimeClassName string
	// AdminImageRef is the catalog ref of the entry node's admin sidecar
	// image (default "jumphost:1").
	AdminImageRef string
	// Helm, VClusterChart and VClusterValues install virtual clusters.
	Helm           HelmRunner
	VClusterChart  string
	VClusterValues string
	// VClusterPodSecurity is the Pod Security Standard enforced on vcluster
	// host namespaces (default baseline).
	VClusterPodSecurity string
	// Lab state persistence (what hibernate/resume preserves):
	// PersistentHome gives container nodes a /home/learner PVC,
	// VClusterPersistence keeps vcluster databases on a PVC, VMDisks makes
	// VM root disks persistent DataVolumes. StorageClass applies to all of
	// them (empty: cluster default).
	PersistentHome      bool
	VClusterPersistence bool
	VMDisks             VMDiskOptions
	StorageClass        string
	// UserNamespaces: run catalog images marked userNamespace with pod
	// hostUsers: false (resolve with DetectUserNamespaces).
	UserNamespaces bool
}

// Runtime is the assembled driver set.
type Runtime struct {
	Registry  *Registry
	Session   *SessionRuntime
	Container *ContainerDriver
}

// NewRuntime builds the container, vm, k8s-cluster (virtual + kubeadm) and
// netdev (stub) drivers plus the session runtime that owns keys, the lab
// network and entry wiring.
func NewRuntime(o RuntimeOptions) (*Runtime, error) {
	adminRef := o.AdminImageRef
	if adminRef == "" {
		adminRef = "jumphost:1"
	}
	container := &ContainerDriver{
		Client: o.Client, Reader: o.Reader, Scheme: o.Scheme, ImageRegistry: o.ImageRegistry,
		RuntimeClassName: o.RuntimeClassName, Executor: o.Executor, Catalog: o.Catalog,
		PersistentHome: o.PersistentHome, HomeStorageClass: o.StorageClass,
		UserNamespaces: o.UserNamespaces,
	}
	disks := o.VMDisks
	if disks.StorageClass == "" {
		disks.StorageClass = o.StorageClass
	}
	if o.Catalog != nil {
		img, err := o.Catalog.Resolve(adminRef, ImageKindContainer)
		if err != nil {
			return nil, fmt.Errorf("admin sidecar image: %w", err)
		}
		container.AdminImage = container.ImageFor(img.Image)
	}
	session := &SessionRuntime{
		Client: o.Client, Reader: o.Reader, Container: container,
		Network: &LabNetwork{Client: o.Client, Reader: o.Reader},
	}
	vm := &VMDriver{Client: o.Client, Reader: o.Reader, Catalog: o.Catalog, Container: container, Session: session,
		ImageRegistry: o.ImageRegistry, Disks: disks}
	cluster := &ClusterDriver{
		Virtual: &VClusterDriver{Client: o.Client, Reader: o.Reader, Container: container, Helm: o.Helm,
			Chart: o.VClusterChart, ValuesFile: o.VClusterValues, Persistent: o.VClusterPersistence, StorageClass: o.StorageClass,
			PodSecurity: o.VClusterPodSecurity},
		Kubeadm: &KubeadmDriver{Client: o.Client, Reader: o.Reader, Catalog: o.Catalog, Container: container,
			Session: session, ImageRegistry: o.ImageRegistry, Disks: disks},
	}
	reg, err := NewRegistry(container, vm, cluster, NewNetdevDriver())
	if err != nil {
		return nil, err
	}
	session.Registry = reg
	return &Runtime{Registry: reg, Session: session, Container: container}, nil
}

// Access dispatches to the cluster mode's backend.
func (c *ClusterDriver) Access(ctx context.Context, ref NodeRef) (NodeAccess, bool, error) {
	b, err := c.backend(ref)
	if err != nil {
		return NodeAccess{}, false, err
	}
	ap, ok := b.(AccessProvider)
	if !ok {
		return NodeAccess{}, true, nil
	}
	return ap.Access(ctx, ref)
}

var _ AccessProvider = (*ClusterDriver)(nil)

// clusterMode is the effective mode of a k8s-cluster node.
func clusterMode(n labsv1.Node) labsv1.ClusterMode {
	if n.Cluster != nil && n.Cluster.Mode != "" {
		return n.Cluster.Mode
	}
	return labsv1.ClusterModeVirtual
}
