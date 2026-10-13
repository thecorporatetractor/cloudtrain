package drivers

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	utilexec "k8s.io/utils/exec"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

func testScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(s); err != nil {
		t.Fatal(err)
	}
	if err := labsv1.AddToScheme(s); err != nil {
		t.Fatal(err)
	}
	return s
}

func jumphostRef() NodeRef {
	cpu := resource.MustParse("500m")
	return NodeRef{
		Session: &labsv1.LabSession{ObjectMeta: metav1.ObjectMeta{Name: "s-abc", Namespace: "labs", UID: "uid-1"}},
		Node: labsv1.Node{
			Name: "workstation", Driver: labsv1.DriverContainer, Image: "jumphost:1",
			Access:    []labsv1.AccessType{labsv1.AccessShell, labsv1.AccessWeb},
			Resources: &labsv1.NodeResources{CPU: &cpu, MemoryMiB: ptr.To[int64](512)},
		},
	}
}

func newContainerDriver(t *testing.T, objs ...client.Object) (*ContainerDriver, client.Client) {
	s := testScheme(t)
	c := fake.NewClientBuilder().WithScheme(s).WithObjects(objs...).Build()
	return &ContainerDriver{Client: c, Scheme: s, ImageRegistry: "registry.cloudtrain.local/images", RuntimeClassName: "kata"}, c
}

func TestContainerProvisionCreatesPodAndService(t *testing.T) {
	ctx := context.Background()
	d, c := newContainerDriver(t)
	ref := jumphostRef()

	st, err := d.Provision(ctx, ref)
	if err != nil {
		t.Fatal(err)
	}
	if st.Phase != labsv1.NodeProvisioning {
		t.Errorf("phase = %s", st.Phase)
	}

	pod := &corev1.Pod{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: "labs", Name: "s-abc-workstation"}, pod); err != nil {
		t.Fatal(err)
	}
	ctr := pod.Spec.Containers[0]
	if ctr.Image != "registry.cloudtrain.local/images/jumphost:1" {
		t.Errorf("image = %s", ctr.Image)
	}
	if got := ctr.Resources.Limits.Memory().String(); got != "512Mi" {
		t.Errorf("memory = %s", got)
	}
	if got := ctr.Resources.Requests.Cpu().String(); got != "500m" {
		t.Errorf("cpu = %s", got)
	}
	if pod.Spec.Hostname != "workstation" || *pod.Spec.RuntimeClassName != "kata" || *pod.Spec.AutomountServiceAccountToken {
		t.Errorf("pod spec = %+v", pod.Spec)
	}
	if pod.Labels[LabelSession] != "s-abc" || pod.Labels[LabelNode] != "workstation" {
		t.Errorf("labels = %v", pod.Labels)
	}
	if len(pod.OwnerReferences) != 1 || pod.OwnerReferences[0].Kind != "LabSession" || !*pod.OwnerReferences[0].Controller {
		t.Errorf("owner refs = %+v", pod.OwnerReferences)
	}

	svc := &corev1.Service{}
	if err := c.Get(ctx, client.ObjectKey{Namespace: "labs", Name: "s-abc-workstation"}, svc); err != nil {
		t.Fatal(err)
	}
	var ports []string
	for _, p := range svc.Spec.Ports {
		ports = append(ports, p.Name)
	}
	if strings.Join(ports, ",") != "ssh,web" {
		t.Errorf("ports = %v", ports)
	}
	if svc.Spec.Selector[LabelNode] != "workstation" {
		t.Errorf("selector = %v", svc.Spec.Selector)
	}

	// Idempotent.
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatalf("second provision: %v", err)
	}
}

func TestContainerStatus(t *testing.T) {
	ref := jumphostRef()
	pod := func(mut func(p *corev1.Pod)) *corev1.Pod {
		p := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "labs", Name: ref.ResourceName()}}
		mut(p)
		return p
	}
	tests := []struct {
		name    string
		objs    []client.Object
		want    labsv1.NodePhase
		wantMsg string
	}{
		{"absent", nil, labsv1.NodePending, "pod not created"},
		{"pending image pull", []client.Object{pod(func(p *corev1.Pod) {
			p.Status.Phase = corev1.PodPending
			p.Status.ContainerStatuses = []corev1.ContainerStatus{{State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ImagePullBackOff"}}}}
		})}, labsv1.NodeProvisioning, "ImagePullBackOff"},
		{"running not ready", []client.Object{pod(func(p *corev1.Pod) { p.Status.Phase = corev1.PodRunning })}, labsv1.NodeProvisioning, "running"},
		{"ready", []client.Object{pod(func(p *corev1.Pod) {
			p.Status.Phase = corev1.PodRunning
			p.Status.Conditions = []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}
		})}, labsv1.NodeReady, ""},
		{"failed", []client.Object{pod(func(p *corev1.Pod) { p.Status.Phase = corev1.PodFailed; p.Status.Message = "OOMKilled" })}, labsv1.NodeFailed, "OOMKilled"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, _ := newContainerDriver(t, tt.objs...)
			st, err := d.Status(context.Background(), ref)
			if err != nil {
				t.Fatal(err)
			}
			if st.Phase != tt.want || !strings.Contains(st.Message, tt.wantMsg) {
				t.Errorf("got %+v, want %s / %q", st, tt.want, tt.wantMsg)
			}
		})
	}
}

func TestContainerConnect(t *testing.T) {
	d, _ := newContainerDriver(t)
	ref := jumphostRef()
	tests := []struct {
		access  labsv1.AccessType
		want    labsv1.Endpoint
		wantErr error
	}{
		{labsv1.AccessShell, labsv1.Endpoint{Node: "workstation", Access: "shell", Protocol: "k8s-exec", Target: "labs/s-abc-workstation/node"}, nil},
		{labsv1.AccessSSH, labsv1.Endpoint{Node: "workstation", Access: "ssh", Protocol: "ssh", Host: "s-abc-workstation.labs.svc.cluster.local", Port: 22}, nil},
		{labsv1.AccessWeb, labsv1.Endpoint{Node: "workstation", Access: "web", Protocol: "http", Host: "s-abc-workstation.labs.svc.cluster.local", Port: 80, URL: "http://s-abc-workstation.labs.svc.cluster.local:80/"}, nil},
		{labsv1.AccessRDP, labsv1.Endpoint{}, ErrUnsupported},
	}
	for _, tt := range tests {
		t.Run(string(tt.access), func(t *testing.T) {
			got, err := d.Connect(context.Background(), ref, tt.access)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v", err)
			}
			if got != tt.want {
				t.Errorf("got %+v\nwant %+v", got, tt.want)
			}
		})
	}
}

func TestContainerResetDestroy(t *testing.T) {
	ctx := context.Background()
	d, c := newContainerDriver(t)
	ref := jumphostRef()
	if _, err := d.Provision(ctx, ref); err != nil {
		t.Fatal(err)
	}
	key := client.ObjectKey{Namespace: "labs", Name: ref.ResourceName()}

	if err := d.Reset(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, key, &corev1.Pod{}); !apierrors.IsNotFound(err) {
		t.Errorf("pod should be gone after reset: %v", err)
	}
	if err := c.Get(ctx, key, &corev1.Service{}); err != nil {
		t.Errorf("service should survive reset: %v", err)
	}
	if _, err := d.Provision(ctx, ref); err != nil { // recreate
		t.Fatal(err)
	}
	if err := c.Get(ctx, key, &corev1.Pod{}); err != nil {
		t.Errorf("pod should be recreated: %v", err)
	}
	if err := d.Destroy(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err := c.Get(ctx, key, &corev1.Service{}); !apierrors.IsNotFound(err) {
		t.Errorf("service should be gone: %v", err)
	}
	if err := d.Destroy(ctx, ref); err != nil {
		t.Errorf("destroy must be idempotent: %v", err)
	}
}

type recordingExecutor struct {
	cmd   []string
	stdin string
	err   error
}

func (r *recordingExecutor) Exec(_ context.Context, ns, pod, container string, cmd []string, stdin io.Reader, stdout, stderr io.Writer) error {
	r.cmd = append([]string{ns, pod, container}, cmd...)
	if stdin != nil {
		b, _ := io.ReadAll(stdin)
		r.stdin = string(b)
	}
	_, _ = io.WriteString(stdout, "out")
	_, _ = io.WriteString(stderr, "err")
	return r.err
}

func TestContainerExec(t *testing.T) {
	ctx := context.Background()
	ref := jumphostRef()
	tests := []struct {
		name     string
		req      ExecRequest
		execErr  error
		noExec   bool
		wantCmd  string
		wantExit int
		wantErr  error
	}{
		{name: "admin shell", req: ExecRequest{Command: []string{"sh", "-c", "id"}, Stdin: []byte("in")}, wantCmd: "labs s-abc-workstation node sh -c id"},
		{name: "as learner", req: ExecRequest{User: labsv1.ActionAsLearner, Command: []string{"whoami"}}, wantCmd: "labs s-abc-workstation node runuser -u learner -- whoami"},
		{name: "non-zero exit", req: ExecRequest{Command: []string{"false"}}, execErr: utilexec.CodeExitError{Err: errors.New("x"), Code: 3}, wantCmd: "labs s-abc-workstation node false", wantExit: 3},
		{name: "apply unsupported", req: ExecRequest{Kind: ExecKubeApply, Command: []string{"x"}}, wantErr: ErrUnsupported},
		{name: "no executor", req: ExecRequest{Command: []string{"x"}}, noExec: true, wantErr: ErrNotImplemented},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, _ := newContainerDriver(t)
			rec := &recordingExecutor{err: tt.execErr}
			if !tt.noExec {
				d.Executor = rec
			}
			res, err := d.Exec(ctx, ref, tt.req)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr != nil {
				return
			}
			if got := strings.Join(rec.cmd, " "); got != tt.wantCmd {
				t.Errorf("cmd = %q", got)
			}
			if res.ExitCode != tt.wantExit || res.Stdout != "out" || res.Stderr != "err" {
				t.Errorf("res = %+v", res)
			}
			if tt.req.Stdin != nil && rec.stdin != string(tt.req.Stdin) {
				t.Errorf("stdin = %q", rec.stdin)
			}
		})
	}
}

func TestImageFor(t *testing.T) {
	d := &ContainerDriver{ImageRegistry: "reg.example/images/"}
	tests := map[string]string{
		"jumphost:1":                 "reg.example/images/jumphost:1",
		"library/ubuntu:24.04":       "reg.example/images/library/ubuntu:24.04",
		"ghcr.io/acme/tool:2":        "ghcr.io/acme/tool:2",
		"localhost/dev:1":            "localhost/dev:1",
		"registry:5000/images/frr:1": "registry:5000/images/frr:1",
	}
	for in, want := range tests {
		if got := d.ImageFor(in); got != want {
			t.Errorf("ImageFor(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestResourceName(t *testing.T) {
	if got := ResourceName("s1", "ws"); got != "s1-ws" {
		t.Errorf("got %q", got)
	}
	if got := ResourceName("1s", "ws"); got != "ls-1s-ws" {
		t.Errorf("got %q", got)
	}
	long := ResourceName(strings.Repeat("a", 60), "workstation")
	if len(long) != 63 || long != ResourceName(strings.Repeat("a", 60), "workstation") {
		t.Errorf("long name %q (%d)", long, len(long))
	}
}

func TestRegistry(t *testing.T) {
	d, _ := newContainerDriver(t)
	r, err := NewDefaultRegistry(d)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(r.Names()); got != 4 {
		t.Errorf("names = %v", r.Names())
	}
	if err := r.Register(NewVMDriver()); err == nil {
		t.Error("duplicate register must fail")
	}
	if _, err := r.Get("lxc"); !errors.Is(err, ErrUnsupported) {
		t.Errorf("unknown driver err = %v", err)
	}
	got, _ := r.Get(labsv1.DriverContainer)
	if got != d {
		t.Error("container driver not returned")
	}
}

func TestStubsReturnNotImplemented(t *testing.T) {
	ctx := context.Background()
	kubeadm := NodeRef{Session: jumphostRef().Session, Node: labsv1.Node{Name: "k", Driver: labsv1.DriverK8sCluster, Cluster: &labsv1.ClusterSpec{Mode: labsv1.ClusterModeKubeadm}}}
	virtual := NodeRef{Session: kubeadm.Session, Node: labsv1.Node{Name: "v", Driver: labsv1.DriverK8sCluster, Cluster: &labsv1.ClusterSpec{Mode: labsv1.ClusterModeVirtual}}}
	vm := NodeRef{Session: kubeadm.Session, Node: labsv1.Node{Name: "m", Driver: labsv1.DriverVM}}
	tests := []struct {
		name    string
		d       NodeDriver
		ref     NodeRef
		backend string
	}{
		{"vm", NewVMDriver(), vm, "kubevirt"},
		{"netdev", NewNetdevDriver(), vm, "clabernetes"},
		{"cluster kubeadm", NewClusterDriver(), kubeadm, "kubeadm"},
		{"cluster virtual", NewClusterDriver(), virtual, "vcluster"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st, err := tt.d.Provision(ctx, tt.ref)
			if !errors.Is(err, ErrNotImplemented) || !IsPermanent(err) || st.Phase != labsv1.NodeFailed {
				t.Fatalf("provision: %+v %v", st, err)
			}
			if !strings.Contains(err.Error(), tt.backend) {
				t.Errorf("error should name backend %q: %v", tt.backend, err)
			}
			if _, err := tt.d.Status(ctx, tt.ref); !errors.Is(err, ErrNotImplemented) {
				t.Errorf("status: %v", err)
			}
			if _, err := tt.d.Exec(ctx, tt.ref, ExecRequest{}); !errors.Is(err, ErrNotImplemented) {
				t.Errorf("exec: %v", err)
			}
			if _, err := tt.d.Connect(ctx, tt.ref, labsv1.AccessSSH); !errors.Is(err, ErrNotImplemented) {
				t.Errorf("connect: %v", err)
			}
			if err := tt.d.Reset(ctx, tt.ref); !errors.Is(err, ErrNotImplemented) {
				t.Errorf("reset: %v", err)
			}
			if err := tt.d.Destroy(ctx, tt.ref); err != nil {
				t.Errorf("destroy must succeed for stubs: %v", err)
			}
		})
	}
}
