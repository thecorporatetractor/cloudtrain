package drivers

// Persistent learner homes for container nodes. Every container node (with
// ContainerDriver.PersistentHome) mounts a session-owned PVC
// "<node resource name>-home" at /home/learner. An init container seeds an
// empty volume from the image's /home/learner once (dotfiles, ownership,
// mode), so the volume survives pod recreation: hibernate deletes the pod,
// resume recreates it on the same volume. Everything else in the container
// (root filesystem outside /home/learner, /tmp, installed packages, running
// processes and shells) is recreated from the image.

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	// LearnerHome is the learner's home directory in container images.
	LearnerHome = "/home/" + LearnerUser
	// HomeVolumeName is the pod volume of the persistent home.
	HomeVolumeName = "learner-home"
	// homeSeededMarker marks a seeded home volume (root-owned).
	homeSeededMarker = ".cloudtrain-home"
	defaultHomeSize  = "1Gi"
)

// HomeClaimName is the PVC holding a container node's /home/learner.
func HomeClaimName(ref NodeRef) string { return ref.ResourceName() + "-home" }

// homeInitScript copies the image's home into a fresh volume once.
const homeInitScript = `set -e
v=/mnt/home
[ -e "$v/` + homeSeededMarker + `" ] && exit 0
if [ -d ` + LearnerHome + ` ]; then
  cp -a ` + LearnerHome + `/. "$v"/
  chown "$(stat -c %u:%g ` + LearnerHome + `)" "$v"
  chmod "$(stat -c %a ` + LearnerHome + `)" "$v"
else
  chown 1000:1000 "$v"; chmod 0755 "$v"
fi
touch "$v/` + homeSeededMarker + `"`

// BuildHomeClaim renders the home PVC of a container node.
func (d *ContainerDriver) BuildHomeClaim(ref NodeRef) *corev1.PersistentVolumeClaim {
	size := d.HomeSize
	if size == "" {
		size = defaultHomeSize
	}
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Name: HomeClaimName(ref), Namespace: ref.Namespace(), Labels: d.labels(ref)},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources:   corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(size)}},
		},
	}
	if d.HomeStorageClass != "" {
		pvc.Spec.StorageClassName = ptr.To(d.HomeStorageClass)
	}
	return pvc
}

// ensureHome creates the home PVC unless it exists. ready=false while a
// previous incarnation (reset) is still being deleted: a pod must not be
// bound to a terminating claim.
func (d *ContainerDriver) ensureHome(ctx context.Context, ref NodeRef) (bool, error) {
	pvc := d.BuildHomeClaim(ref)
	existing := &corev1.PersistentVolumeClaim{}
	err := d.Client.Get(ctx, client.ObjectKeyFromObject(pvc), existing)
	switch {
	case err == nil && !d.owns(ref, existing):
		return false, d.conflict(ref, existing)
	case err == nil:
		return existing.DeletionTimestamp == nil, nil
	case !apierrors.IsNotFound(err):
		return false, err
	}
	return true, d.createIfAbsent(ctx, ref, pvc)
}

// mountHome mounts the home volume at /home/learner and seeds it.
func (d *ContainerDriver) mountHome(ref NodeRef, pod *corev1.Pod) {
	pod.Spec.Volumes = append(pod.Spec.Volumes, corev1.Volume{Name: HomeVolumeName, VolumeSource: corev1.VolumeSource{
		PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: HomeClaimName(ref)},
	}})
	node := &pod.Spec.Containers[0]
	node.VolumeMounts = append(node.VolumeMounts, corev1.VolumeMount{Name: HomeVolumeName, MountPath: LearnerHome})
	root := ptr.To[int64](0)
	pod.Spec.InitContainers = append([]corev1.Container{{
		Name:    "home-init",
		Image:   node.Image,
		Command: []string{"/bin/sh", "-c", homeInitScript},
		SecurityContext: &corev1.SecurityContext{
			RunAsUser: root, RunAsGroup: root, AllowPrivilegeEscalation: ptr.To(false),
			Capabilities: &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}, Add: []corev1.Capability{"CHOWN", "FOWNER", "DAC_OVERRIDE"}},
		},
		VolumeMounts: []corev1.VolumeMount{{Name: HomeVolumeName, MountPath: "/mnt/home"}},
	}}, pod.Spec.InitContainers...)
}

// deleteHome deletes the home PVC; gone reports whether it no longer exists.
func (d *ContainerDriver) deleteHome(ctx context.Context, ref NodeRef) (bool, error) {
	pvc := &corev1.PersistentVolumeClaim{}
	err := d.Client.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: HomeClaimName(ref)}, pvc)
	if apierrors.IsNotFound(err) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if !d.owns(ref, pvc) {
		return true, nil // not ours: leave it alone
	}
	if pvc.DeletionTimestamp == nil {
		uid := pvc.UID
		if err := d.Client.Delete(ctx, pvc, client.Preconditions{UID: &uid}); err != nil {
			return apierrors.IsNotFound(err), client.IgnoreNotFound(err)
		}
		// Without a protection finalizer the claim is gone right away.
		if err := d.Client.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: HomeClaimName(ref)}, pvc); apierrors.IsNotFound(err) {
			return true, nil
		}
	}
	return false, nil
}

// Hibernate deletes the pod and keeps Service and home volume; Provision
// recreates the pod. Without a persistent home the node keeps running
// (deleting the pod would discard the learner's work).
func (d *ContainerDriver) Hibernate(ctx context.Context, ref NodeRef) error {
	if !d.PersistentHome {
		return fmt.Errorf("container node %s has no persistent home: %w", ref.Node.Name, ErrUnsupported)
	}
	return d.deletePod(ctx, ref)
}

// Hibernate: network devices keep running (their running configuration
// lives in the daemons, not on a volume).
func (d *NetdevDriver) Hibernate(context.Context, NodeRef) error {
	return fmt.Errorf("netdev nodes keep running while hibernated: %w", ErrUnsupported)
}

var _ Hibernator = (*NetdevDriver)(nil)
