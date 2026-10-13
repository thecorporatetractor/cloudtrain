package drivers

import (
	"context"
	"errors"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func TestContainerPersistentHomeHibernateResume(t *testing.T) {
	ctx := context.Background()
	d, c := newContainerDriver(t)
	d.PersistentHome, d.HomeStorageClass = true, "standard"
	ref := jumphostRef()
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	podKey := client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}
	pvcKey := client.ObjectKey{Namespace: "labs", Name: HomeClaimName(ref)}
	pvc := &corev1.PersistentVolumeClaim{}
	if err := c.Get(ctx, pvcKey, pvc); err != nil {
		t.Fatalf("home PVC: %v", err)
	}
	if *pvc.Spec.StorageClassName != "standard" || pvc.Labels[LabelSessionUID] != "uid-1" || len(pvc.OwnerReferences) != 1 {
		t.Errorf("pvc = %+v", pvc.ObjectMeta)
	}
	pod := &corev1.Pod{}
	if err := c.Get(ctx, podKey, pod); err != nil {
		t.Fatal(err)
	}
	if len(pod.Spec.InitContainers) != 1 || pod.Spec.InitContainers[0].Name != "home-init" ||
		!strings.Contains(pod.Spec.InitContainers[0].Command[2], "cp -a /home/learner/.") {
		t.Errorf("init containers = %+v", pod.Spec.InitContainers)
	}
	if m := pod.Spec.Containers[0].VolumeMounts; len(m) != 1 || m[0].MountPath != "/home/learner" {
		t.Errorf("mounts = %+v", m)
	}

	// Hibernate: pod gone, Service and home volume kept.
	ref.Session.Spec.Hibernate = true
	if err := d.Hibernate(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, podKey, &corev1.Pod{}); !apierrors.IsNotFound(err) {
		t.Errorf("pod still there: %v", err)
	}
	for _, obj := range []client.Object{&corev1.Service{}, &corev1.PersistentVolumeClaim{}} {
		key := podKey
		if _, ok := obj.(*corev1.PersistentVolumeClaim); ok {
			key = pvcKey
		}
		if err := c.Get(ctx, key, obj); err != nil {
			t.Errorf("%T lost on hibernate: %v", obj, err)
		}
	}
	st, err := d.Status(ctx, ref)
	if err != nil || st.Phase != labsv1.NodeHibernated {
		t.Errorf("status = %+v %v", st, err)
	}
	// Resume: Provision recreates the pod on the same claim.
	ref.Session.Spec.Hibernate = false
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	pod = &corev1.Pod{}
	if err := c.Get(ctx, podKey, pod); err != nil || pod.Spec.Volumes[len(pod.Spec.Volumes)-1].PersistentVolumeClaim.ClaimName != HomeClaimName(ref) {
		t.Errorf("pod not recreated on the home volume: %v", err)
	}
	got := &corev1.PersistentVolumeClaim{}
	if err := c.Get(ctx, pvcKey, got); err != nil || got.UID != pvc.UID {
		t.Errorf("home volume replaced on resume: %v", err)
	}

	// Reset deletes the home volume too.
	if err := d.Reset(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, pvcKey, &corev1.PersistentVolumeClaim{}); !apierrors.IsNotFound(err) {
		t.Errorf("home volume survived reset: %v", err)
	}
	if err := d.Destroy(ctx, ref); err != nil {
		t.Errorf("destroy: %v", err)
	}
}

func TestContainerWaitsForTerminatingHome(t *testing.T) {
	ctx := context.Background()
	ref := jumphostRef()
	d0, _ := newContainerDriver(t)
	d0.PersistentHome = true
	pvc := d0.BuildHomeClaim(ref)
	pvc.Finalizers = []string{"kubernetes.io/pvc-protection"}
	d, c := newContainerDriver(t, pvc)
	d.PersistentHome = true
	if err := c.Delete(ctx, pvc); err != nil {
		t.Fatal(err)
	}
	st, err := d.Provision(ctx, ref)
	if err != nil || st.Phase != labsv1.NodeProvisioning {
		t.Fatalf("provision = %+v %v", st, err)
	}
	if err := c.Get(ctx, client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}, &corev1.Pod{}); !apierrors.IsNotFound(err) {
		t.Error("pod created on a terminating home volume")
	}
	if err := d.Destroy(ctx, ref); !errors.Is(err, ErrInProgress) {
		t.Errorf("destroy with the home volume still terminating: %v", err)
	}
}

func TestHibernateUnsupportedWithoutPersistence(t *testing.T) {
	ctx := context.Background()
	d, _ := newContainerDriver(t)
	if err := d.Hibernate(ctx, jumphostRef()); !errors.Is(err, ErrUnsupported) {
		t.Errorf("container without home volume: %v", err)
	}
	if err := (&NetdevDriver{ContainerDriver: d}).Hibernate(ctx, jumphostRef()); !errors.Is(err, ErrUnsupported) {
		t.Errorf("netdev: %v", err)
	}
	vm := &VMDriver{Client: d.Client}
	if err := vm.Hibernate(ctx, jumphostRef()); !errors.Is(err, ErrUnsupported) {
		t.Errorf("vm on containerDisk: %v", err)
	}
	cd := &ClusterDriver{Virtual: NewVClusterDriver(), Kubeadm: NewKubeadmDriver()}
	if err := cd.Hibernate(ctx, jumphostRef()); !errors.Is(err, ErrUnsupported) {
		t.Errorf("stub cluster backend: %v", err)
	}
}

func TestLearnerWiringSkipsUnchangedHome(t *testing.T) {
	if !strings.Contains(learnerWireScript, wiredMarker) || !strings.Contains(learnerWireScript, `= "$1" ]; then cat >/dev/null; exit 0`) {
		t.Errorf("script = %s", learnerWireScript)
	}
	ex := &scriptExecutor{}
	d := &ContainerDriver{Executor: ex}
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[0]}
	access := EntryAccess{LearnerKey: SSHKeyPair{Private: []byte("k"), Public: []byte("p")}}
	files, err := learnerFiles(access)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := buildTar(files)
	if _, err := d.ExecIn(context.Background(), ref, ContainerName, ExecRequest{
		Command: []string{"/bin/sh", "-c", learnerWireScript, "sh", access.Digest()}, Stdin: data}); err != nil {
		t.Fatal(err)
	}
	if got := ex.calls[0]; got[len(got)-1] != access.Digest() {
		t.Errorf("digest not passed: %v", got)
	}
}

// vclusterFixture is a persistent vcluster of a session as the chart leaves it.
func vclusterFixture(t *testing.T, replicas int32) (*VClusterDriver, client.Client, NodeRef, string) {
	t.Helper()
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
	rel := VClusterRelease(ref.Session, ref.Node.Name)
	sts := &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: rel, Namespace: VClusterNamespace(ref.Session, ref.Node.Name), Labels: SessionLabels(ref.Session)},
		Spec: appsv1.StatefulSetSpec{Replicas: ptr.To(replicas)}}
	cp := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: rel + "-0", Namespace: VClusterNamespace(ref.Session, ref.Node.Name), UID: "cp-uid",
		Labels: map[string]string{"app": "vcluster", "release": rel}}}
	synced := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "web-x-dock-" + rel, Namespace: VClusterNamespace(ref.Session, ref.Node.Name),
		Labels: map[string]string{LabelVClusterManagedBy: rel}}}
	data := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: DataClaimName(rel), Namespace: VClusterNamespace(ref.Session, ref.Node.Name), UID: "data-uid",
		Labels: map[string]string{"app": "vcluster", "release": rel}}}
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(sts, cp, synced, data).Build()
	return &VClusterDriver{Client: c, Persistent: true}, c, ref, rel
}

func TestVClusterPersistentValues(t *testing.T) {
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
	d := &VClusterDriver{Persistent: true, StorageClass: "standard"}
	v, err := d.values(ref, VClusterRelease(ref.Session, ref.Node.Name))
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range []string{"enabled: true", "retentionPolicy: Delete", "storageClass: standard", "size: 1Gi"} {
		if !strings.Contains(string(v), w) {
			t.Errorf("values lack %q:\n%s", w, v)
		}
	}
}

func TestVClusterHibernateResume(t *testing.T) {
	ctx := context.Background()
	d, c, ref, rel := vclusterFixture(t, 1)
	ref.Session.Spec.Hibernate = true
	if err := d.Hibernate(ctx, ref); err != nil {
		t.Fatal(err)
	}
	sts := &appsv1.StatefulSet{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: VClusterNamespace(ref.Session, ref.Node.Name), Name: rel}, sts); err != nil || *sts.Spec.Replicas != 0 {
		t.Fatalf("statefulset not scaled to zero: %v %v", err, sts.Spec.Replicas)
	}
	if err := c.Get(ctx, client.ObjectKey{Namespace: VClusterNamespace(ref.Session, ref.Node.Name), Name: "web-x-dock-" + rel}, &corev1.Pod{}); !apierrors.IsNotFound(err) {
		t.Errorf("synced workload pod kept running: %v", err)
	}
	// The StatefulSet controller removes the control-plane pod.
	st, _ := d.Status(ctx, ref)
	if st.Phase != labsv1.NodeProvisioning {
		t.Errorf("status with pod left = %+v", st)
	}
	if err := c.Delete(ctx, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: rel + "-0", Namespace: VClusterNamespace(ref.Session, ref.Node.Name)}}); err != nil {
		t.Fatal(err)
	}
	if st, _ := d.Status(ctx, ref); st.Phase != labsv1.NodeHibernated {
		t.Errorf("status = %+v", st)
	}
	if err := c.Get(ctx, client.ObjectKey{Namespace: VClusterNamespace(ref.Session, ref.Node.Name), Name: DataClaimName(rel)}, &corev1.PersistentVolumeClaim{}); err != nil {
		t.Errorf("database volume lost on hibernate: %v", err)
	}
	// Resume scales back up.
	ref.Session.Spec.Hibernate = false
	st, err := d.Provision(ctx, ref)
	if err != nil || st.Phase != labsv1.NodeProvisioning {
		t.Fatalf("provision = %+v %v", st, err)
	}
	if err := c.Get(ctx, client.ObjectKey{Namespace: VClusterNamespace(ref.Session, ref.Node.Name), Name: rel}, sts); err != nil || *sts.Spec.Replicas != 1 {
		t.Errorf("not scaled up: %v", sts.Spec.Replicas)
	}
}

func TestVClusterInstanceIsTheDatabaseVolume(t *testing.T) {
	d, _, ref, rel := vclusterFixture(t, 1)
	id, err := d.instance(context.Background(), ref, rel, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{UID: types.UID("pod-a")}})
	if err != nil || id != "pvc:data-uid" {
		t.Errorf("instance = %q %v", id, err)
	}
}

func TestVClusterResetDeletesDatabase(t *testing.T) {
	ctx := context.Background()
	d, c, ref, rel := vclusterFixture(t, 1)
	if err := d.Reset(ctx, ref); !errors.Is(err, ErrInProgress) {
		t.Fatalf("reset with the control plane still running: %v", err)
	}
	_ = c.Delete(ctx, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: rel + "-0", Namespace: VClusterNamespace(ref.Session, ref.Node.Name)}})
	if err := d.Reset(ctx, ref); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if err := c.Get(ctx, client.ObjectKey{Namespace: VClusterNamespace(ref.Session, ref.Node.Name), Name: DataClaimName(rel)}, &corev1.PersistentVolumeClaim{}); !apierrors.IsNotFound(err) {
		t.Errorf("database volume survived reset: %v", err)
	}
	sts := &appsv1.StatefulSet{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: VClusterNamespace(ref.Session, ref.Node.Name), Name: rel}, sts); err != nil || *sts.Spec.Replicas != 0 {
		t.Errorf("replicas = %v", sts.Spec.Replicas)
	}
}

func TestVClusterWithoutPersistenceKeepsRunning(t *testing.T) {
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
	rel := VClusterRelease(ref.Session, ref.Node.Name)
	dep := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: rel, Namespace: VClusterNamespace(ref.Session, ref.Node.Name), Labels: SessionLabels(ref.Session)}}
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(dep).Build()
	if err := (&VClusterDriver{Client: c}).Hibernate(context.Background(), ref); !errors.Is(err, ErrUnsupported) {
		t.Errorf("emptyDir vcluster: %v", err)
	}
}

func TestBuildVMPersistentDisk(t *testing.T) {
	s := testSession()
	v := buildVM(s, NewLabNet(s), vmSpec{Name: "vm-a", Hostname: "a", IP: "192.168.100.10", Image: "cloudtrain/kubeadm-node:v1.37.1",
		Cores: 1, MemMiB: 1024, CISecret: "ci", Labels: SessionLabels(s), Disk: VMDiskOptions{Persistent: true, StorageClass: "standard"}})
	dvs, _, _ := unstructured.NestedSlice(v.Object, "spec", "dataVolumeTemplates")
	if len(dvs) != 1 {
		t.Fatalf("dataVolumeTemplates = %v", dvs)
	}
	dv := dvs[0].(map[string]any)
	if name, _, _ := unstructured.NestedString(dv, "metadata", "name"); name != "vm-a-root" {
		t.Errorf("dv name = %s", name)
	}
	if url, _, _ := unstructured.NestedString(dv, "spec", "source", "registry", "url"); url != "docker://cloudtrain/kubeadm-node:v1.37.1" {
		t.Errorf("url = %s", url)
	}
	if pm, _, _ := unstructured.NestedString(dv, "spec", "source", "registry", "pullMethod"); pm != "node" {
		t.Errorf("pullMethod = %s", pm)
	}
	if size, _, _ := unstructured.NestedString(dv, "spec", "storage", "resources", "requests", "storage"); size != DefaultVMDiskSize {
		t.Errorf("size = %s", size)
	}
	vols, _, _ := unstructured.NestedSlice(v.Object, "spec", "template", "spec", "volumes")
	if n, _, _ := unstructured.NestedString(vols[0].(map[string]any), "dataVolume", "name"); n != "vm-a-root" {
		t.Errorf("root volume = %v", vols[0])
	}
	eph := buildVM(s, NewLabNet(s), vmSpec{Name: "vm-b", Image: "img", CISecret: "ci"})
	if _, ok, _ := unstructured.NestedSlice(eph.Object, "spec", "dataVolumeTemplates"); ok {
		t.Error("ephemeral VM has a DataVolume")
	}
}

func vmObj(s *labsv1.LabSession, name, uid string) *unstructured.Unstructured {
	vm := newObj(GVKVirtualMachine, s.Namespace, name)
	vm.SetLabels(SessionLabels(s))
	vm.SetUID(types.UID(uid))
	_ = unstructured.SetNestedField(vm.Object, "Always", "spec", "runStrategy")
	return vm
}

func TestVMHibernateResumeAndIdentity(t *testing.T) {
	ctx := context.Background()
	s := testSession()
	tpl := &labsv1.LabTemplateSpec{Topology: labsv1.Topology{Nodes: []labsv1.Node{{Name: "etcd", Driver: labsv1.DriverVM, Image: "etcd-host:3.6"}}}}
	ref := NodeRef{Session: s, Template: tpl, Node: tpl.Topology.Nodes[0]}
	name := ref.ResourceName()
	vmi := newObj(GVKVMI, s.Namespace, name)
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(vmObj(s, name, "vm-uid-1"), vmi).Build()
	d := &VMDriver{Client: c, Disks: VMDiskOptions{Persistent: true}}

	id1, err := vmIdentity(ctx, c, s.Namespace, []string{name})
	if err != nil {
		t.Fatal(err)
	}
	s.Spec.Hibernate = true
	if err := d.Hibernate(ctx, ref); err != nil {
		t.Fatal(err)
	}
	vm := newObj(GVKVirtualMachine, s.Namespace, name)
	if err := c.Get(ctx, client.ObjectKeyFromObject(vm), vm); err != nil {
		t.Fatal(err)
	}
	if rs, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy"); rs != "Halted" {
		t.Errorf("runStrategy = %s", rs)
	}
	if st, _ := d.Status(ctx, ref); st.Phase != labsv1.NodeProvisioning {
		t.Errorf("status with VMI left = %+v", st)
	}
	if err := c.Delete(ctx, vmi); err != nil { // KubeVirt stops the VMI
		t.Fatal(err)
	}
	if st, _ := d.Status(ctx, ref); st.Phase != labsv1.NodeHibernated {
		t.Errorf("status = %+v", st)
	}
	if err := setRunStrategy(ctx, c, c, s.Namespace, []string{name}, "Always"); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, client.ObjectKeyFromObject(vm), vm); err != nil {
		t.Fatal(err)
	}
	if rs, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy"); rs != "Always" {
		t.Errorf("runStrategy after resume = %s", rs)
	}
	id2, _ := vmIdentity(ctx, c, s.Namespace, []string{name})
	if id1 != id2 {
		t.Error("VM identity changed across stop/start")
	}
}

func TestDeleteVMsWaitsForDisks(t *testing.T) {
	ctx := context.Background()
	s := testSession()
	dv := newObj(GVKDataVolume, s.Namespace, "vm-a-root")
	dv.SetLabels(SessionLabels(s))
	pvc := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "vm-a-root", Namespace: s.Namespace,
		Finalizers: []string{"kubernetes.io/pvc-protection"}}}
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(vmObj(s, "vm-a", "u1"), dv, pvc).Build()
	gone, err := deleteVMs(ctx, c, c, s, []string{"vm-a"})
	if err != nil || gone {
		t.Fatalf("gone = %v err = %v", gone, err)
	}
	// VM deleted first; the DataVolume only once the VM is gone.
	if err := c.Get(ctx, client.ObjectKeyFromObject(dv), newObj(GVKDataVolume, s.Namespace, "vm-a-root")); err != nil {
		t.Errorf("data volume deleted together with its VM: %v", err)
	}
	gone, err = deleteVMs(ctx, c, c, s, []string{"vm-a"})
	if err != nil || gone {
		t.Fatalf("second pass: gone = %v err = %v", gone, err)
	}
	if err := c.Get(ctx, client.ObjectKeyFromObject(dv), newObj(GVKDataVolume, s.Namespace, "vm-a-root")); !apierrors.IsNotFound(err) {
		t.Errorf("data volume not deleted: %v", err)
	}
	pvc.Finalizers = nil
	if err := c.Update(ctx, pvc); err != nil {
		t.Fatal(err)
	}
	_ = c.Delete(ctx, pvc)
	if gone, err = deleteVMs(ctx, c, c, s, []string{"vm-a"}); err != nil || !gone {
		t.Errorf("after the disk is gone: gone = %v err = %v", gone, err)
	}
}

func TestKubeadmResumeScript(t *testing.T) {
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[1]}
	l, err := (&KubeadmDriver{}).layout(ref)
	if err != nil {
		t.Fatal(err)
	}
	s := resumeScript(ref, l)
	for _, w := range []string{"KUBECONFIG=/root/.kube/qm-yard.conf", "/readyz", "ssh -T 'yard-wk-2' true", "echo READY"} {
		if !strings.Contains(s, w) {
			t.Errorf("resume script lacks %q:\n%s", w, s)
		}
	}
	if strings.Contains(s, "kubectl label") {
		t.Error("resume must not re-apply template labels over learner changes")
	}
}

func TestVClusterOwnHostNamespace(t *testing.T) {
	ctx := context.Background()
	tpl := kubeadmTopology()
	ref := NodeRef{Session: testSession(), Template: tpl, Node: tpl.Topology.Nodes[3]}
	c := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	d := &VClusterDriver{Client: c}
	if ready, err := d.ensureHostNamespace(ctx, ref); err != nil || !ready {
		t.Fatalf("ensure = %v %v", ready, err)
	}
	ns := &corev1.Namespace{}
	if err := c.Get(ctx, client.ObjectKey{Name: VClusterNamespace(ref.Session, ref.Node.Name)}, ns); err != nil {
		t.Fatal(err)
	}
	if ns.Labels[LabelSessionUID] != "uid-1" || ns.Labels[LabelSessionNamespace] != "labs" {
		t.Errorf("labels = %v", ns.Labels)
	}
	if err := d.Destroy(ctx, ref); !errors.Is(err, ErrInProgress) {
		t.Fatalf("first destroy pass: %v", err)
	}
	if err := d.Destroy(ctx, ref); err != nil {
		t.Fatalf("destroy: %v", err)
	}
	if err := c.Get(ctx, client.ObjectKey{Name: ns.Name}, &corev1.Namespace{}); !apierrors.IsNotFound(err) {
		t.Errorf("host namespace survived destroy: %v", err)
	}
	// Two sessions in one namespace get two host namespaces.
	other := testSession()
	other.Name, other.UID = "s2", "uid-2"
	if VClusterNamespace(other, "qm-virt") == ns.Name {
		t.Error("host namespaces collide")
	}
}
