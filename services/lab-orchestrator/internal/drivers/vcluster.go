package drivers

// k8s-cluster mode=virtual: one vcluster per cluster node, installed with
// Helm from a vendored chart (deploy/vcluster/values.yaml plus per-session
// overrides). The vcluster runs in the session namespace on the platform
// network; its synced workload pods are isolated with a NetworkPolicy, and
// its kubeconfig (pointed at https://<release>.<ns>.svc) is published as the
// node's kubeconfig Secret and wired into the entry node.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// LabelVClusterManagedBy is set by vcluster on every object it syncs to the host.
const LabelVClusterManagedBy = "vcluster.loft.sh/managed-by"

// HelmRunner runs the helm CLI.
type HelmRunner interface {
	Helm(ctx context.Context, args ...string) ([]byte, error)
}

// ExecHelm runs a helm binary.
type ExecHelm struct {
	// Binary defaults to "helm" on PATH.
	Binary string
}

// Helm implements HelmRunner.
func (h ExecHelm) Helm(ctx context.Context, args ...string) ([]byte, error) {
	bin := h.Binary
	if bin == "" {
		bin = "helm"
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	if err != nil {
		return out.Bytes(), fmt.Errorf("helm %s: %v: %s", strings.Join(args[:min(2, len(args))], " "), err, strings.TrimSpace(out.String()))
	}
	return out.Bytes(), nil
}

// VClusterDriver is the k8s-cluster mode=virtual backend.
type VClusterDriver struct {
	Client    client.Client
	Reader    client.Reader
	Container *ContainerDriver
	Helm      HelmRunner
	// Chart is the vcluster chart (a .tgz path or a chart reference).
	Chart string
	// ValuesFile is deploy/vcluster/values.yaml (optional).
	ValuesFile string
	// Persistent keeps the embedded database on a PVC (StatefulSet
	// data-<release>-0) instead of an emptyDir, so the control plane can
	// be scaled to zero (hibernate) and back without losing the cluster.
	Persistent bool
	// StorageClass and VolumeSize of that PVC (defaults: cluster default, 1Gi).
	StorageClass string
	VolumeSize   string
}

var (
	_ NodeDriver     = (*VClusterDriver)(nil)
	_ AccessProvider = (*VClusterDriver)(nil)
	_ Hibernator     = (*VClusterDriver)(nil)
)

func (d *VClusterDriver) Name() labsv1.DriverName { return labsv1.DriverK8sCluster }

func (d *VClusterDriver) reader() client.Reader {
	if d.Reader != nil {
		return d.Reader
	}
	return d.Client
}

// VClusterRelease is the Helm release (and Service) name of a virtual
// cluster node: short, so every name the chart derives from it fits.
func VClusterRelease(s *labsv1.LabSession, node string) string {
	sum := sha256.Sum256([]byte(s.Namespace + "\x00" + s.Name + "\x00" + string(s.UID) + "\x00" + node))
	return "vc-" + hex.EncodeToString(sum[:])[:10]
}

// VClusterReleases lists the releases of the topology's virtual clusters.
func VClusterReleases(s *labsv1.LabSession, topo *labsv1.Topology) []string {
	var out []string
	for _, n := range topo.Nodes {
		if n.Driver == labsv1.DriverK8sCluster && clusterMode(n) == labsv1.ClusterModeVirtual {
			out = append(out, VClusterRelease(s, n.Name))
		}
	}
	return out
}

func (d *VClusterDriver) policyName(release string) string { return release + "-workloads" }

// workloadPolicy: pods the learner creates inside the vcluster run in the
// session namespace on the platform network; they may only reach DNS, each
// other and their own vcluster API (no host API, no other labs, no internet).
func (d *VClusterDriver) workloadPolicy(ref NodeRef, release string) *networkingv1.NetworkPolicy {
	udp, tcp := corev1.ProtocolUDP, corev1.ProtocolTCP
	dns, api := intstr.FromInt32(53), intstr.FromInt32(8443)
	np := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: d.policyName(release), Namespace: ref.Namespace(), Labels: SessionLabels(ref.Session)},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{LabelVClusterManagedBy: release}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
			Egress: []networkingv1.NetworkPolicyEgressRule{
				{
					To: []networkingv1.NetworkPolicyPeer{{
						NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": "kube-system"}},
						PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"k8s-app": "kube-dns"}},
					}},
					Ports: []networkingv1.NetworkPolicyPort{{Protocol: &udp, Port: &dns}, {Protocol: &tcp, Port: &dns}},
				},
				{To: []networkingv1.NetworkPolicyPeer{{PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{LabelVClusterManagedBy: release}}}}},
				{
					To:    []networkingv1.NetworkPolicyPeer{{PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "vcluster", "release": release}}}},
					Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &api}},
				},
			},
		},
	}
	return np
}

// values renders the per-session Helm values overlay.
func (d *VClusterDriver) values(ref NodeRef, release string) ([]byte, error) {
	labels := SessionLabels(ref.Session)
	labels[LabelNode] = LabelValue(ref.Node.Name)
	// Without persistence the embedded database lives in an emptyDir (no
	// PVC to clean up; a restarted pod is an empty cluster). With it, the
	// StatefulSet's PVC is deleted with the release (retentionPolicy Delete)
	// and explicitly by Reset/Destroy.
	vc := map[string]any{"enabled": false}
	if d.Persistent {
		size := d.VolumeSize
		if size == "" {
			size = "1Gi"
		}
		vc = map[string]any{"enabled": true, "retentionPolicy": "Delete", "size": size}
		if d.StorageClass != "" {
			vc["storageClass"] = d.StorageClass
		}
	}
	return yaml.Marshal(map[string]any{
		"controlPlane": map[string]any{
			"proxy": map[string]any{"extraSANs": []string{release + "." + ref.Namespace() + ".svc"}},
			"statefulSet": map[string]any{
				"persistence": map[string]any{"volumeClaim": vc},
				"labels":      labels,
				"pods":        map[string]any{"labels": labels},
			},
		},
	})
}

// Provision installs the vcluster once, waits for it, then publishes the
// kubeconfig Secret.
func (d *VClusterDriver) Provision(ctx context.Context, ref NodeRef) (NodeState, error) {
	release := VClusterRelease(ref.Session, ref.Node.Name)
	np := d.workloadPolicy(ref, release)
	if err := setOwner(ref.Session, np, d.Client); err != nil {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	if err := ensure(ctx, d.Client, d.reader(), ref.Session, np); err != nil {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
	}
	wl, err := d.workload(ctx, ref, release)
	if err != nil {
		return NodeState{}, err
	}
	if wl == nil {
		if err := d.install(ctx, ref, release); err != nil {
			return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
		}
		return NodeState{Phase: labsv1.NodeProvisioning, Message: "vcluster installing"}, nil
	}
	if wl.GetLabels()[LabelSessionUID] != string(ref.Session.UID) {
		err := fmt.Errorf("StatefulSet %s exists but does not belong to session %s: %w", release, ref.Session.Name, ErrConflict)
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	// Resume after hibernate (or a reset): scale the control plane back up.
	if replicas(wl) == 0 {
		if err := d.scale(ctx, wl, 1); err != nil {
			return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
		}
		return NodeState{Phase: labsv1.NodeProvisioning, Message: "vcluster starting"}, nil
	}
	return d.observe(ctx, ref, release, true)
}

// workload returns the vcluster control plane (a Deployment without
// persistence, a StatefulSet with it), or nil if not installed.
func (d *VClusterDriver) workload(ctx context.Context, ref NodeRef, release string) (client.Object, error) {
	key := client.ObjectKey{Namespace: ref.Namespace(), Name: release}
	for _, obj := range []client.Object{&appsv1.Deployment{}, &appsv1.StatefulSet{}} {
		err := d.reader().Get(ctx, key, obj)
		if err == nil {
			return obj, nil
		}
		if !apierrors.IsNotFound(err) {
			return nil, err
		}
	}
	return nil, nil
}

// controlPlanePods lists the vcluster control-plane pods of a release.
func (d *VClusterDriver) controlPlanePods(ctx context.Context, ref NodeRef, release string) ([]corev1.Pod, error) {
	pods := &corev1.PodList{}
	err := d.reader().List(ctx, pods, client.InNamespace(ref.Namespace()), client.MatchingLabels{"app": "vcluster", "release": release})
	return pods.Items, err
}

func (d *VClusterDriver) install(ctx context.Context, ref NodeRef, release string) error {
	if d.Helm == nil || d.Chart == "" {
		return &NotImplementedError{Driver: labsv1.DriverK8sCluster, Backend: "vcluster", Op: "install without helm chart"}
	}
	vals, err := d.values(ref, release)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "vcluster-values-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	overlay := filepath.Join(dir, "session.yaml")
	if err := os.WriteFile(overlay, vals, 0o600); err != nil {
		return err
	}
	args := []string{"upgrade", "--install", release, d.Chart, "--namespace", ref.Namespace()}
	if d.ValuesFile != "" {
		args = append(args, "-f", d.ValuesFile)
	}
	args = append(args, "-f", overlay)
	_, err = d.Helm.Helm(ctx, args...)
	return err
}

func (d *VClusterDriver) observe(ctx context.Context, ref NodeRef, release string, publish bool) (NodeState, error) {
	pods, err := d.controlPlanePods(ctx, ref, release)
	if err != nil {
		return NodeState{}, err
	}
	var pod *corev1.Pod
	for i := range pods {
		if pods[i].DeletionTimestamp == nil {
			pod = &pods[i]
		}
	}
	if pod == nil {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: "vcluster pod not created"}, nil
	}
	st, _ := podState(pod)
	if st.Phase != labsv1.NodeReady {
		st.Phase, st.Message = labsv1.NodeProvisioning, "vcluster "+st.Message
		return st, nil
	}
	instance, err := d.instance(ctx, ref, release, pod)
	if err != nil {
		return NodeState{}, err
	}
	state := NodeState{Phase: labsv1.NodeReady, InstanceID: instance,
		Details: map[string]string{"apiServer": d.server(ref, release), "context": clusterContext(ref.Node), "release": release}}
	kc := &corev1.Secret{}
	err = d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: KubeconfigSecretName(ref)}, kc)
	if err == nil && kc.Annotations[AnnotationBootstrapped] == string(pod.UID) {
		return state, nil
	}
	if err != nil && !apierrors.IsNotFound(err) {
		return NodeState{}, err
	}
	if !publish {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: "kubeconfig not published", InstanceID: instance}, nil
	}
	if err := d.publish(ctx, ref, release, string(pod.UID)); err != nil {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error(), InstanceID: instance}, nil
	}
	return state, nil
}

func (d *VClusterDriver) server(ref NodeRef, release string) string {
	return "https://" + release + "." + ref.Namespace() + ".svc:443"
}

// publish converts vcluster's own kubeconfig Secret (vc-<release>) into the
// node's kubeconfig Secret.
func (d *VClusterDriver) publish(ctx context.Context, ref NodeRef, release, instance string) error {
	src := &corev1.Secret{}
	if err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: "vc-" + release}, src); err != nil {
		if apierrors.IsNotFound(err) {
			return fmt.Errorf("waiting for vcluster kubeconfig")
		}
		return err
	}
	kc, err := RenameKubeconfig(src.Data["config"], clusterContext(ref.Node), d.server(ref, release))
	if err != nil {
		return fmt.Errorf("vcluster kubeconfig: %w", err)
	}
	sec := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: KubeconfigSecretName(ref)}}
	err = d.reader().Get(ctx, client.ObjectKeyFromObject(sec), sec)
	switch {
	case apierrors.IsNotFound(err):
		sec.Labels = SessionLabels(ref.Session)
		sec.Annotations = map[string]string{AnnotationBootstrapped: instance}
		sec.Data = map[string][]byte{"admin.conf": kc, "learner.conf": kc}
		if err := setOwner(ref.Session, sec, d.Client); err != nil {
			return err
		}
		return d.Client.Create(ctx, sec)
	case err != nil:
		return err
	}
	if !ownedBySession(ref.Session, sec) {
		return fmt.Errorf("secret %s does not belong to session %s: %w", sec.Name, ref.Session.Name, ErrConflict)
	}
	if sec.Annotations == nil {
		sec.Annotations = map[string]string{}
	}
	sec.Annotations[AnnotationBootstrapped] = instance
	sec.Data = map[string][]byte{"admin.conf": kc, "learner.conf": kc}
	return d.Client.Update(ctx, sec)
}

// Status observes the vcluster.
func (d *VClusterDriver) Status(ctx context.Context, ref NodeRef) (NodeState, error) {
	release := VClusterRelease(ref.Session, ref.Node.Name)
	if ref.Session.Spec.Hibernate {
		return d.hibernateState(ctx, ref, release)
	}
	return d.observe(ctx, ref, release, false)
}

// Access contributes the cluster's kubeconfigs once published.
func (d *VClusterDriver) Access(ctx context.Context, ref NodeRef) (NodeAccess, bool, error) {
	kc := &corev1.Secret{}
	if err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: KubeconfigSecretName(ref)}, kc); err != nil {
		return NodeAccess{}, false, client.IgnoreNotFound(err)
	}
	return NodeAccess{Clusters: []ClusterAccess{{Node: ref.Node.Name, Context: clusterContext(ref.Node),
		Learner: kc.Data["learner.conf"], Admin: kc.Data["admin.conf"]}}}, true, nil
}

// Exec runs against the virtual cluster's API from the entry node.
func (d *VClusterDriver) Exec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error) {
	if req.Member != "" {
		return ExecResult{}, fmt.Errorf("virtual cluster %s has no members: %w", ref.Node.Name, ErrUnsupported)
	}
	return execOnCluster(ctx, d.Container, ref, req)
}

// Connect: a virtual cluster has no access points of its own.
func (d *VClusterDriver) Connect(_ context.Context, ref NodeRef, access labsv1.AccessType) (labsv1.Endpoint, error) {
	return labsv1.Endpoint{}, fmt.Errorf("virtual cluster %s: %s access: %w", ref.Node.Name, access, ErrUnsupported)
}

// Reset returns the virtual cluster to an empty one. With an emptyDir
// database deleting the pod is enough; with a PVC the control plane is
// scaled to zero, the PVC deleted (ErrInProgress until it is gone) and
// Provision scales it back up on a fresh volume.
func (d *VClusterDriver) Reset(ctx context.Context, ref NodeRef) error {
	release := VClusterRelease(ref.Session, ref.Node.Name)
	if err := d.deleteSynced(ctx, ref, release); err != nil {
		return err
	}
	wl, err := d.workload(ctx, ref, release)
	if err != nil {
		return err
	}
	if sts, ok := wl.(*appsv1.StatefulSet); ok && sts.GetLabels()[LabelSessionUID] == string(ref.Session.UID) {
		return d.resetPersistent(ctx, ref, release, sts)
	}
	pods, err := d.controlPlanePods(ctx, ref, release)
	if err != nil {
		return err
	}
	for i := range pods {
		if err := d.Client.Delete(ctx, &pods[i]); err != nil && !apierrors.IsNotFound(err) {
			return err
		}
	}
	return nil
}

// deleteSynced deletes the objects vcluster synced into the host namespace.
func (d *VClusterDriver) deleteSynced(ctx context.Context, ref NodeRef, release string) error {
	sel := client.MatchingLabels{LabelVClusterManagedBy: release}
	ns := client.InNamespace(ref.Namespace())
	for _, obj := range []client.Object{&corev1.Pod{}, &corev1.Service{}, &corev1.ConfigMap{}, &corev1.Secret{},
		&corev1.PersistentVolumeClaim{}, &corev1.ServiceAccount{}, &corev1.Endpoints{}} {
		if err := d.Client.DeleteAllOf(ctx, obj, ns, sel); err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("delete synced %T: %w", obj, err)
		}
	}
	return nil
}

// Destroy uninstalls the release and removes everything vcluster created
// outside it. ErrInProgress until the control-plane and synced pods are gone.
func (d *VClusterDriver) Destroy(ctx context.Context, ref NodeRef) error {
	release := VClusterRelease(ref.Session, ref.Node.Name)
	wl, err := d.workload(ctx, ref, release)
	switch {
	case err != nil:
		return err
	case wl != nil:
		if wl.GetLabels()[LabelSessionUID] != string(ref.Session.UID) {
			return nil // not ours
		}
		if d.Helm == nil {
			return &NotImplementedError{Driver: labsv1.DriverK8sCluster, Backend: "vcluster", Op: "uninstall without helm"}
		}
		if out, err := d.Helm.Helm(ctx, "uninstall", release, "--namespace", ref.Namespace(), "--ignore-not-found"); err != nil {
			return fmt.Errorf("%w: %s", err, out)
		}
	}
	if err := d.deleteSynced(ctx, ref, release); err != nil {
		return err
	}
	for _, obj := range []client.Object{
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: "vc-" + release}},
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: "vc-config-" + release}},
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: release + "-certs"}},
		&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: "vc-" + release}},
	} {
		if err := d.Client.Delete(ctx, obj); err != nil && !apierrors.IsNotFound(err) {
			return err
		}
	}
	// The chart's cluster-scoped RBAC: helm uninstall misses it when the
	// release record went first (e.g. the whole namespace is being deleted).
	crName := "vc-" + release + "-v-" + ref.Namespace()
	for _, obj := range []client.Object{
		&rbacv1.ClusterRoleBinding{ObjectMeta: metav1.ObjectMeta{Name: crName}},
		&rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: crName}},
	} {
		if err := d.Client.Delete(ctx, obj); err != nil && !apierrors.IsNotFound(err) {
			return err
		}
	}
	for _, obj := range []client.Object{
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: KubeconfigSecretName(ref)}},
		&networkingv1.NetworkPolicy{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: d.policyName(release)}},
	} {
		if _, err := deleteIfOwned(ctx, d.Client, d.reader(), ref.Session, obj); err != nil {
			return err
		}
	}
	// The database PVC (retentionPolicy Delete covers a clean uninstall; a
	// release that went first leaves it behind).
	dataGone, err := d.deleteData(ctx, ref, release)
	if err != nil {
		return err
	}
	pods := &corev1.PodList{}
	if err := d.reader().List(ctx, pods, client.InNamespace(ref.Namespace()), client.MatchingLabels{LabelVClusterManagedBy: release}); err != nil {
		return err
	}
	cps, err := d.controlPlanePods(ctx, ref, release)
	if err != nil {
		return err
	}
	if len(pods.Items) > 0 || len(cps) > 0 {
		return inProgress("vcluster %s pods are terminating", release)
	}
	if !dataGone {
		return inProgress("vcluster %s data volume is being deleted", release)
	}
	return nil
}

// DataClaimName is the PVC of a persistent vcluster's embedded database
// (volumeClaimTemplate "data" of StatefulSet <release>, ordinal 0).
func DataClaimName(release string) string { return "data-" + release + "-0" }

// instance is the vcluster's state identity: the database PVC's UID when
// persistent (stable across restarts and hibernation), else the pod UID
// (an emptyDir database dies with the pod).
func (d *VClusterDriver) instance(ctx context.Context, ref NodeRef, release string, pod *corev1.Pod) (string, error) {
	pvc := &corev1.PersistentVolumeClaim{}
	err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: DataClaimName(release)}, pvc)
	switch {
	case err == nil:
		return "pvc:" + string(pvc.UID), nil
	case apierrors.IsNotFound(err):
		return string(pod.UID), nil
	default:
		return "", err
	}
}

func replicas(wl client.Object) int32 {
	switch w := wl.(type) {
	case *appsv1.StatefulSet:
		if w.Spec.Replicas != nil {
			return *w.Spec.Replicas
		}
	case *appsv1.Deployment:
		if w.Spec.Replicas != nil {
			return *w.Spec.Replicas
		}
	}
	return 1
}

// scale sets the control plane's replica count.
func (d *VClusterDriver) scale(ctx context.Context, wl client.Object, n int32) error {
	patch := []byte(fmt.Sprintf(`{"spec":{"replicas":%d}}`, n))
	return d.Client.Patch(ctx, wl, client.RawPatch("application/merge-patch+json", patch))
}

// Hibernate scales a persistent vcluster's control plane to zero and deletes
// the workload pods it synced into the host namespace (they hold compute;
// on resume vcluster drops the virtual pods whose host pods vanished and
// their controllers, e.g. Deployments, recreate them). Bare pods created
// directly by the learner therefore do not survive; every API object
// (Deployments, Services, ConfigMaps, RBAC, ...) does. A vcluster without
// persistence keeps running.
func (d *VClusterDriver) Hibernate(ctx context.Context, ref NodeRef) error {
	release := VClusterRelease(ref.Session, ref.Node.Name)
	wl, err := d.workload(ctx, ref, release)
	if err != nil || wl == nil {
		return err
	}
	if wl.GetLabels()[LabelSessionUID] != string(ref.Session.UID) {
		return fmt.Errorf("StatefulSet %s does not belong to session %s: %w", release, ref.Session.Name, ErrConflict)
	}
	if _, ok := wl.(*appsv1.StatefulSet); !ok {
		return fmt.Errorf("vcluster %s has no persistent database: %w", release, ErrUnsupported)
	}
	if replicas(wl) != 0 {
		if err := d.scale(ctx, wl, 0); err != nil {
			return err
		}
	}
	pods := &corev1.PodList{}
	if err := d.reader().List(ctx, pods, client.InNamespace(ref.Namespace()), client.MatchingLabels{LabelVClusterManagedBy: release}); err != nil {
		return err
	}
	for i := range pods.Items {
		if err := d.Client.Delete(ctx, &pods.Items[i]); err != nil && !apierrors.IsNotFound(err) {
			return err
		}
	}
	return nil
}

// hibernateState reports Hibernated once the control plane and the synced
// pods are gone.
func (d *VClusterDriver) hibernateState(ctx context.Context, ref NodeRef, release string) (NodeState, error) {
	wl, err := d.workload(ctx, ref, release)
	if err != nil {
		return NodeState{}, err
	}
	if wl != nil && replicas(wl) != 0 {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: "vcluster control plane still scaled up"}, nil
	}
	cps, err := d.controlPlanePods(ctx, ref, release)
	if err != nil {
		return NodeState{}, err
	}
	pods := &corev1.PodList{}
	if err := d.reader().List(ctx, pods, client.InNamespace(ref.Namespace()), client.MatchingLabels{LabelVClusterManagedBy: release}); err != nil {
		return NodeState{}, err
	}
	if n := len(cps) + len(pods.Items); n > 0 {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: fmt.Sprintf("vcluster stopping (%d pod(s) left)", n)}, nil
	}
	return NodeState{Phase: labsv1.NodeHibernated, Message: "vcluster scaled to zero; database volume kept"}, nil
}

// resetPersistent scales the StatefulSet to zero and deletes its database
// PVC; ErrInProgress until both the pod and the PVC are gone.
func (d *VClusterDriver) resetPersistent(ctx context.Context, ref NodeRef, release string, sts *appsv1.StatefulSet) error {
	if replicas(sts) != 0 {
		if err := d.scale(ctx, sts, 0); err != nil {
			return err
		}
	}
	cps, err := d.controlPlanePods(ctx, ref, release)
	if err != nil {
		return err
	}
	if len(cps) > 0 {
		return inProgress("vcluster %s stopping for reset", release)
	}
	gone, err := d.deleteData(ctx, ref, release)
	if err != nil {
		return err
	}
	if !gone {
		return inProgress("vcluster %s database volume is being deleted", release)
	}
	return nil
}

// deleteData deletes the database PVC of release; gone reports whether it
// no longer exists. The PVC carries the chart's labels, not the session's:
// it is identified by name and by the release's StatefulSet selector labels.
func (d *VClusterDriver) deleteData(ctx context.Context, ref NodeRef, release string) (bool, error) {
	pvc := &corev1.PersistentVolumeClaim{}
	err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: DataClaimName(release)}, pvc)
	if apierrors.IsNotFound(err) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if pvc.Labels["release"] != release && pvc.Labels[LabelSessionUID] != string(ref.Session.UID) {
		return true, nil // not this release's volume
	}
	if pvc.DeletionTimestamp == nil {
		uid := pvc.UID
		if err := d.Client.Delete(ctx, pvc, client.Preconditions{UID: &uid}); err != nil {
			return apierrors.IsNotFound(err), client.IgnoreNotFound(err)
		}
		// Without a protection finalizer the claim is gone right away.
		if err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: DataClaimName(release)}, pvc); apierrors.IsNotFound(err) {
			return true, nil
		}
	}
	return false, nil
}
