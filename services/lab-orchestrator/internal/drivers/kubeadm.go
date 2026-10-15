package drivers

// k8s-cluster mode=kubeadm: one KubeVirt VM per cluster.nodes[] member, booted
// from the catalog's golden containerDisk on the session's lab network.
// The orchestrator owns the cluster PKI: it generates the CA, a bootstrap
// token, the admin and learner client certificates and every host key, so
// the control plane runs `kubeadm init` with a pre-seeded CA, workers join
// with a pinned CA hash, and kubeconfigs exist before the VMs boot.

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Kubeadm cluster defaults. Node resources of the cluster node apply to the
// control plane; workers use the worker defaults.
const (
	kubeadmCPCores      = 2
	kubeadmCPMemMiB     = 2048
	kubeadmWorkerCores  = 1
	kubeadmWorkerMemMiB = 1024
	certValidity        = 365 * 24 * time.Hour
	// Groups of the generated client certificates. The platform's admin is
	// system:masters (cannot be locked out by learner RBAC changes); the
	// learner is a regular cluster admin like kubeadm's admin.conf.
	adminGroup   = "system:masters"
	learnerGroup = "kubeadm:cluster-admins"
)

// KubeadmDriver is the k8s-cluster mode=kubeadm backend.
type KubeadmDriver struct {
	Client        client.Client
	Reader        client.Reader
	Catalog       *ImageCatalog
	Container     *ContainerDriver
	Session       *SessionRuntime
	ImageRegistry string
	// Disks selects ephemeral (containerDisk) or persistent root disks.
	Disks VMDiskOptions
}

var (
	_ NodeDriver     = (*KubeadmDriver)(nil)
	_ AccessProvider = (*KubeadmDriver)(nil)
	_ Hibernator     = (*KubeadmDriver)(nil)
)

func (d *KubeadmDriver) Name() labsv1.DriverName { return labsv1.DriverK8sCluster }

func (d *KubeadmDriver) reader() client.Reader {
	if d.Reader != nil {
		return d.Reader
	}
	return d.Client
}

func clusterContext(n labsv1.Node) string {
	if n.Cluster != nil && n.Cluster.Context != "" {
		return n.Cluster.Context
	}
	return n.Name
}

// PKISecretName holds the cluster CA, token and host keys.
func PKISecretName(ref NodeRef) string { return ref.ResourceName() + "-pki" }

// KubeconfigSecretName is the published kubeconfig Secret of a cluster node
// (keys admin.conf and learner.conf, one context named cluster.context).
func KubeconfigSecretName(ref NodeRef) string { return ref.ResourceName() + "-kubeconfig" }

// memberVM is the VM object name of a member.
func memberVM(ref NodeRef, member string) string {
	return ResourceName(ref.Session.Name, string(ref.Session.UID), ref.Node.Name+"-"+member)
}

type kubeadmLayout struct {
	cp      labsv1.ClusterNode
	cpHost  PlannedHost
	members []labsv1.ClusterNode
	hosts   map[string]PlannedHost
	vms     []string
}

func (d *KubeadmDriver) layout(ref NodeRef) (kubeadmLayout, error) {
	l := kubeadmLayout{hosts: map[string]PlannedHost{}}
	if ref.Node.Cluster == nil || len(ref.Node.Cluster.Nodes) == 0 {
		return l, fmt.Errorf("kubeadm cluster %s has no nodes: %w", ref.Node.Name, ErrUnsupported)
	}
	cps := 0
	for _, m := range ref.Node.Cluster.Nodes {
		if m.Role == "control-plane" {
			cps++
			l.cp = m
		}
	}
	if cps != 1 {
		return l, fmt.Errorf("kubeadm cluster %s needs exactly one control-plane node, has %d: %w", ref.Node.Name, cps, ErrUnsupported)
	}
	for _, h := range HostPlan(&ref.Template.Topology) {
		if h.Node == ref.Node.Name {
			l.hosts[h.Member] = h
		}
	}
	l.cpHost = l.hosts[l.cp.Name]
	l.members = ref.Node.Cluster.Nodes
	for _, m := range l.members {
		l.vms = append(l.vms, memberVM(ref, m.Name))
	}
	return l, nil
}

// Provision creates the PKI, kubeconfigs, cloud-init and member VMs, then
// waits for the cluster to converge to its spec (members registered, ready
// or not ready as declared, labels applied, CoreDNS available).
func (d *KubeadmDriver) Provision(ctx context.Context, ref NodeRef) (NodeState, error) {
	fail := func(err error) (NodeState, error) {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	img, err := d.Catalog.Resolve(ref.Node.Image, ImageKindContainerDisk)
	if err != nil {
		return fail(err)
	}
	l, err := d.layout(ref)
	if err != nil {
		return fail(err)
	}
	pki, err := d.pki(ctx, ref, l)
	if err != nil {
		if IsPermanent(err) {
			return fail(err)
		}
		return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
	}
	learnerPub, adminPub, err := d.Session.SessionKeys(ctx, ref.Session)
	if err != nil {
		return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
	}
	net := NewLabNet(ref.Session)
	for i, m := range l.members {
		h := l.hosts[m.Name]
		ud, err := d.userdata(ref, l, m, pki, learnerPub, adminPub)
		if err != nil {
			return fail(err)
		}
		ci := l.vms[i] + "-cloudinit"
		if err := ensureSecret(ctx, d.Client, d.reader(), ref.Session, ci, map[string][]byte{"userdata": ud}); err != nil {
			return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
		}
		cores, mem := kubeadmWorkerCores, int64(kubeadmWorkerMemMiB)
		if m.Role == "control-plane" {
			c, mm := vmResources(ref.Node.Resources, kubeadmCPCores, kubeadmCPMemMiB)
			cores, mem = int(c), mm
		}
		vm := buildVM(ref.Session, net, vmSpec{
			Name: l.vms[i], Hostname: m.Name, IP: h.IP, Image: imageWithRegistry(d.ImageRegistry, img.Image),
			Cores: int64(cores), MemMiB: mem, CISecret: ci, Labels: vmLabels(ref, m.Name),
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
	}
	if d.Disks.Persistent { // resume after hibernate
		if err := setRunStrategy(ctx, d.Client, d.reader(), ref.Namespace(), l.vms, "Always"); err != nil {
			return NodeState{Phase: labsv1.NodeProvisioning, Message: err.Error()}, err
		}
	}
	return d.observe(ctx, ref, l, true)
}

type clusterPKI struct {
	ca      CertKey
	token   string
	caHash  string
	hostKey map[string]SSHKeyPair
}

// pki creates (once) the cluster's PKI Secret and the published kubeconfig
// Secret, and returns the PKI.
func (d *KubeadmDriver) pki(ctx context.Context, ref NodeRef, l kubeadmLayout) (clusterPKI, error) {
	name := PKISecretName(ref)
	sec := &corev1.Secret{}
	err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: name}, sec)
	if apierrors.IsNotFound(err) {
		sec, err = d.newPKI(ctx, ref, l)
	}
	if err != nil {
		return clusterPKI{}, err
	}
	if !ownedBySession(ref.Session, sec) {
		return clusterPKI{}, fmt.Errorf("secret %s does not belong to session %s: %w", name, ref.Session.Name, ErrConflict)
	}
	p := clusterPKI{ca: CertKey{Cert: sec.Data["ca.crt"], Key: sec.Data["ca.key"]}, token: string(sec.Data["token"]), hostKey: map[string]SSHKeyPair{}}
	for _, m := range l.members {
		p.hostKey[m.Name] = SSHKeyPair{Private: sec.Data["host."+m.Name], Public: sec.Data["host."+m.Name+".pub"]}
	}
	if p.caHash, err = CAPublicKeyHash(p.ca.Cert); err != nil {
		return clusterPKI{}, err
	}
	return p, nil
}

func (d *KubeadmDriver) newPKI(ctx context.Context, ref NodeRef, l kubeadmLayout) (*corev1.Secret, error) {
	ctxName := clusterContext(ref.Node)
	ca, err := NewCA("kubernetes", certValidity)
	if err != nil {
		return nil, err
	}
	token, err := NewBootstrapToken()
	if err != nil {
		return nil, err
	}
	data := map[string][]byte{"ca.crt": ca.Cert, "ca.key": ca.Key, "token": []byte(token)}
	for _, m := range l.members {
		hk, err := NewSSHKeyPair("root@" + m.Name)
		if err != nil {
			return nil, err
		}
		data["host."+m.Name], data["host."+m.Name+".pub"] = hk.Private, hk.Public
	}
	server := fmt.Sprintf("https://%s:6443", l.cpHost.IP)
	admin, err := NewClientCert(ca, "cloudtrain-admin", []string{adminGroup}, certValidity)
	if err != nil {
		return nil, err
	}
	learner, err := NewClientCert(ca, "kubernetes-admin", []string{learnerGroup}, certValidity)
	if err != nil {
		return nil, err
	}
	adminKC, err := ClientKubeconfig(ctxName, server, ca.Cert, admin)
	if err != nil {
		return nil, err
	}
	learnerKC, err := ClientKubeconfig(ctxName, server, ca.Cert, learner)
	if err != nil {
		return nil, err
	}
	// Kubeconfigs first: the PKI Secret marks the whole set as created.
	if err := ensureSecret(ctx, d.Client, d.reader(), ref.Session, KubeconfigSecretName(ref),
		map[string][]byte{"admin.conf": adminKC, "learner.conf": learnerKC}); err != nil {
		return nil, err
	}
	sec := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: PKISecretName(ref), Labels: SessionLabels(ref.Session)}, Data: data}
	if err := setOwner(ref.Session, sec, d.Client); err != nil {
		return nil, err
	}
	if err := d.Client.Create(ctx, sec); err != nil {
		if apierrors.IsAlreadyExists(err) {
			got := &corev1.Secret{}
			return got, d.reader().Get(ctx, client.ObjectKeyFromObject(sec), got)
		}
		return nil, err
	}
	return sec, nil
}

// kubeadmTaint is a kubeadm nodeRegistration taint.
type kubeadmTaint struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Effect string `json:"effect"`
}

// ParseTaint parses "key[=value]:Effect".
func ParseTaint(s string) (kubeadmTaint, error) {
	kv, effect, ok := strings.Cut(s, ":")
	if !ok || kv == "" {
		return kubeadmTaint{}, fmt.Errorf("taint %q: want key[=value]:Effect", s)
	}
	switch effect {
	case "NoSchedule", "PreferNoSchedule", "NoExecute":
	default:
		return kubeadmTaint{}, fmt.Errorf("taint %q: unknown effect %q", s, effect)
	}
	k, v, _ := strings.Cut(kv, "=")
	return kubeadmTaint{Key: k, Value: v, Effect: effect}, nil
}

// memberTaints are the declared taints (exactly those: an empty list means
// an untainted node, also for the control plane).
func memberTaints(m labsv1.ClusterNode) ([]kubeadmTaint, error) {
	out := []kubeadmTaint{}
	for _, t := range m.Taints {
		kt, err := ParseTaint(t)
		if err != nil {
			return nil, fmt.Errorf("member %s: %v: %w", m.Name, err, ErrUnsupported)
		}
		out = append(out, kt)
	}
	return out, nil
}

func yamlDocs(docs ...any) (string, error) {
	var parts []string
	for _, d := range docs {
		b, err := yaml.Marshal(d)
		if err != nil {
			return "", err
		}
		parts = append(parts, string(b))
	}
	return strings.Join(parts, "---\n"), nil
}

const criSocket = "unix:///run/containerd/containerd.sock"

// Bounded retries of the cluster bootstrap in the node userdata.
const (
	KubeadmInitAttempts = 3
	KubeadmJoinAttempts = 8
)

// kubeadmTimeouts (kubeadm.k8s.io/v1beta4 Timeouts) for init and join.
var kubeadmTimeouts = map[string]any{
	"controlPlaneComponentHealthCheck": "10m0s",
	"kubeletHealthCheck":               "8m0s",
	"kubernetesAPICall":                "3m0s",
	"etcdAPICall":                      "5m0s",
	"tlsBootstrap":                     "10m0s",
	"discovery":                        "10m0s",
}

// PodCIDR of kubeadm lab clusters. It must not overlap the lab network
// (192.168.99.0/24, 192.168.100.0/24), so a CNI default such as Calico's
// 192.168.0.0/16 is never used: the image's cni-install gets this CIDR.
const PodCIDR = "10.244.0.0/16"

// userdata renders a member's cloud-config.
func (d *KubeadmDriver) userdata(ref NodeRef, l kubeadmLayout, m labsv1.ClusterNode, p clusterPKI, learnerPub, adminPub []byte) ([]byte, error) {
	taints, err := memberTaints(m)
	if err != nil {
		return nil, err
	}
	cpIP := l.cpHost.IP
	h := l.hosts[m.Name]
	ci := cloudInit{Hostname: m.Name, LearnerPub: learnerPub, AdminPub: adminPub, HostKey: p.hostKey[m.Name],
		Hosts: HostPlan(&ref.Template.Topology)}
	nodeReg := map[string]any{"name": m.Name, "criSocket": criSocket, "taints": taints}
	if m.Role == "control-plane" {
		cfg, err := yamlDocs(
			map[string]any{
				"apiVersion": "kubeadm.k8s.io/v1beta4", "kind": "InitConfiguration",
				"bootstrapTokens":  []any{map[string]any{"token": p.token, "ttl": "24h"}},
				"localAPIEndpoint": map[string]any{"advertiseAddress": h.IP, "bindPort": 6443},
				"nodeRegistration": nodeReg,
				// Generous timeouts: on a loaded host the static pods start
				// slowly and early API calls (RBAC bootstrap) time out.
				"timeouts": kubeadmTimeouts,
			},
			map[string]any{
				"apiVersion": "kubeadm.k8s.io/v1beta4", "kind": "ClusterConfiguration",
				// Replaced at boot with the image's own kubeadm version (offline VMs).
				"kubernetesVersion":    "__KUBE_VERSION__",
				"clusterName":          clusterContext(ref.Node),
				"controlPlaneEndpoint": cpIP + ":6443",
				"networking":           map[string]any{"podSubnet": PodCIDR, "serviceSubnet": "10.96.0.0/12"},
				"apiServer":            map[string]any{"certSANs": []any{m.Name, h.IP}},
			},
			map[string]any{
				"apiVersion": "kubelet.config.k8s.io/v1beta1", "kind": "KubeletConfiguration",
				"cgroupDriver": "systemd", "resolvConf": "/etc/cloudtrain/resolv.conf",
			},
		)
		if err != nil {
			return nil, err
		}
		ci.Files = []cloudInitFile{
			{Path: "/etc/kubernetes/pki/ca.crt", Content: string(p.ca.Cert)},
			{Path: "/etc/kubernetes/pki/ca.key", Content: string(p.ca.Key), Permissions: "0600"},
			{Path: "/root/kubeadm.yaml", Content: cfg, Permissions: "0600"},
		}
		ci.RunCmd = []string{strings.NewReplacer("__POD_CIDR__", PodCIDR, "__INIT_ATTEMPTS__", fmt.Sprint(KubeadmInitAttempts), "__CRI__", criSocket).Replace(`set -e
sed -i "s/__KUBE_VERSION__/$(kubeadm version -o short)/" /root/kubeadm.yaml
: > /var/log/kubeadm.log
# kubeadm init fails under host load (wait-control-plane or an API call
# times out). Retry a bounded number of times; kubeadm reset wipes
# /etc/kubernetes/pki, so the pre-seeded CA is restored before each retry.
install -d -m 0700 /root/ca-seed
cp -p /etc/kubernetes/pki/ca.crt /etc/kubernetes/pki/ca.key /root/ca-seed/
ok=0
for i in $(seq 1 __INIT_ATTEMPTS__); do
  echo "cloudtrain: kubeadm init attempt $i/__INIT_ATTEMPTS__" >> /var/log/kubeadm.log
  if kubeadm init --config /root/kubeadm.yaml --skip-token-print >> /var/log/kubeadm.log 2>&1; then ok=1; break; fi
  echo "cloudtrain: kubeadm init attempt $i failed; resetting" >> /var/log/kubeadm.log
  kubeadm reset -f --cri-socket __CRI__ >> /var/log/kubeadm.log 2>&1 || true
  install -d -m 0755 /etc/kubernetes/pki
  install -m 0644 /root/ca-seed/ca.crt /etc/kubernetes/pki/ca.crt
  install -m 0600 /root/ca-seed/ca.key /etc/kubernetes/pki/ca.key
  sleep 20
done
[ "$ok" = 1 ] || { echo "cloudtrain: kubeadm init failed after __INIT_ATTEMPTS__ attempts" >> /var/log/kubeadm.log; exit 1; }
export KUBECONFIG=/etc/kubernetes/admin.conf
# CNI: the image's installer if it ships one (called with the pod CIDR),
# else the legacy Flannel manifest of the golden image.
if [ -x /opt/cloudtrain/bin/cni-install ]; then /opt/cloudtrain/bin/cni-install "__POD_CIDR__" >> /var/log/kubeadm.log 2>&1
else kubectl apply -f /opt/cloudtrain/manifests/kube-flannel.yml >> /var/log/kubeadm.log 2>&1; fi
install -d -o learner -g learner /home/learner/.kube
install -o learner -g learner -m 600 /etc/kubernetes/admin.conf /home/learner/.kube/config`)}
		return ci.Render()
	}
	join, err := yamlDocs(map[string]any{
		"apiVersion": "kubeadm.k8s.io/v1beta4", "kind": "JoinConfiguration",
		"discovery": map[string]any{"bootstrapToken": map[string]any{
			"apiServerEndpoint": cpIP + ":6443", "token": p.token, "caCertHashes": []any{p.caHash},
		}},
		"nodeRegistration": nodeReg,
		"timeouts":         kubeadmTimeouts,
	})
	if err != nil {
		return nil, err
	}
	ci.Files = []cloudInitFile{{Path: "/root/join.yaml", Content: join, Permissions: "0600"}}
	// Workers wait for the API before every attempt: the control plane may
	// itself be retrying kubeadm init (reset takes the API down in between).
	run := fmt.Sprintf(`for i in $(seq 1 %[2]d); do
  for w in $(seq 1 120); do timeout 2 bash -c '</dev/tcp/%[1]s/6443' 2>/dev/null && break; sleep 5; done
  kubeadm join --config /root/join.yaml >> /var/log/kubeadm.log 2>&1 && break
  kubeadm reset -f --cri-socket %[3]s >> /var/log/kubeadm.log 2>&1; sleep 15
done`, cpIP, KubeadmJoinAttempts, criSocket)
	if m.State == "notready" {
		// Declared NotReady: join, wait until registered and Ready once, then
		// stop the kubelet for good (the learner may troubleshoot it).
		run += fmt.Sprintf(`
for i in $(seq 1 120); do
  s=$(kubectl --kubeconfig /etc/kubernetes/kubelet.conf get node %[1]s -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)
  [ "$s" = True ] && break; sleep 5
done
systemctl disable --now kubelet >> /var/log/kubeadm.log 2>&1`, m.Name)
	}
	ci.RunCmd = []string{run}
	return ci.Render()
}

// convergeScript checks (and on success labels) the cluster from the admin
// sidecar. It prints READY or "WAIT <reason>"; it only fails on real errors.
func convergeScript(ref NodeRef, l kubeadmLayout) string {
	var b strings.Builder
	fmt.Fprintf(&b, "export KUBECONFIG=%s\n", AdminKubeconfigPath(ref.Node.Name))
	b.WriteString(`kubectl get --raw=/readyz >/dev/null 2>&1 || { echo "WAIT API server not reachable yet"; exit 0; }
st=$(kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}') || exit 1
want() {
  s=$(printf '%s\n' "$st" | awk -v n="$1" '$1==n{print $2}')
  [ -n "$s" ] || { echo "WAIT node $1 not registered"; exit 0; }
  if [ "$2" = ready ]; then [ "$s" = True ] || { echo "WAIT node $1 not Ready"; exit 0; }
  else [ "$s" != True ] || { echo "WAIT node $1 still Ready"; exit 0; }; fi
}
`)
	needDNS := false
	for _, m := range l.members {
		state := "ready"
		if m.State == "notready" {
			state = "notready"
		}
		fmt.Fprintf(&b, "want %s %s\n", shellQuote([]string{m.Name}), state)
		if state == "ready" {
			untainted := true
			for _, t := range m.Taints {
				if strings.HasSuffix(t, ":NoSchedule") || strings.HasSuffix(t, ":NoExecute") {
					untainted = false
				}
			}
			needDNS = needDNS || untainted
		}
	}
	for _, m := range l.members {
		if len(m.Labels) == 0 {
			continue
		}
		args := []string{"kubectl", "label", "node", m.Name, "--overwrite"}
		for _, k := range sortedKeys(m.Labels) {
			args = append(args, k+"="+m.Labels[k])
		}
		fmt.Fprintf(&b, "%s >/dev/null || exit 1\n", shellQuote(args))
	}
	if needDNS {
		b.WriteString(`[ "$(kubectl -n kube-system get deploy coredns -o jsonpath='{.status.availableReplicas}' 2>/dev/null)" -ge 1 ] 2>/dev/null || { echo "WAIT CoreDNS not available"; exit 0; }
`)
	}
	b.WriteString("echo READY\n")
	return b.String()
}

func (d *KubeadmDriver) observe(ctx context.Context, ref NodeRef, l kubeadmLayout, converge bool) (NodeState, error) {
	st, err := observeVMIs(ctx, d.reader(), ref.Namespace(), l.vms)
	if err != nil {
		return NodeState{}, err
	}
	if st.running < st.total {
		return NodeState{Phase: labsv1.NodeProvisioning,
			Message: fmt.Sprintf("VMs booting (%d/%d running): %s", st.running, st.total, strings.Join(st.waiting, ", "))}, nil
	}
	details := map[string]string{"apiServer": "https://" + l.cpHost.IP + ":6443", "context": clusterContext(ref.Node)}
	for _, m := range l.members {
		details["ip."+m.Name] = l.hosts[m.Name].IP
	}
	boot, instance := st.instance, st.instance
	if d.Disks.Persistent {
		if instance, err = vmIdentity(ctx, d.reader(), ref.Namespace(), l.vms); err != nil {
			return NodeState{}, err
		}
	}
	state := NodeState{Phase: labsv1.NodeReady, InstanceID: instance, Details: details}
	cpVM := memberVM(ref, l.cp.Name)
	done, err := vmAnnotation(ctx, d.reader(), ref.Namespace(), cpVM, AnnotationBootstrapped)
	if err != nil {
		return NodeState{}, err
	}
	script, waitMsg := convergeScript(ref, l), "kubeadm cluster bootstrapping"
	if done == instance {
		if boot == instance {
			return state, nil
		}
		// Bootstrapped disks, new boot (resume): the cluster keeps whatever
		// the learner did to it, so only wait for the API and every member's
		// ssh instead of converging to the template again.
		booted, err := vmAnnotation(ctx, d.reader(), ref.Namespace(), cpVM, AnnotationBooted)
		if err != nil {
			return NodeState{}, err
		}
		if booted == boot {
			return state, nil
		}
		script, waitMsg = resumeScript(ref, l), "kubeadm cluster resuming"
	}
	waiting := NodeState{Phase: labsv1.NodeProvisioning, Message: waitMsg, InstanceID: instance}
	if !converge {
		return waiting, nil
	}
	res, err := execOnCluster(ctx, d.Container, ref, ExecRequest{
		Command: []string{"/bin/sh", "-c", script}, Timeout: 60 * time.Second,
	})
	if err != nil {
		waiting.Message = "waiting for the entry node to reach the cluster"
		return waiting, nil
	}
	out := strings.TrimSpace(res.Stdout)
	if res.ExitCode != 0 || !strings.HasSuffix(out, "READY") {
		if out == "" {
			out = strings.TrimSpace(res.Stderr)
		}
		waiting.Message = waitMsg + ": " + strings.TrimPrefix(lastLine(out), "WAIT ")
		return waiting, nil
	}
	if err := annotateVMWith(ctx, d.Client, ref.Namespace(), cpVM,
		map[string]string{AnnotationBootstrapped: instance, AnnotationBooted: boot}); err != nil {
		return NodeState{}, err
	}
	return state, nil
}

// resumeScript checks a resumed cluster from the admin sidecar: API server
// ready and every member reachable over ssh. Prints READY or "WAIT <reason>".
func resumeScript(ref NodeRef, l kubeadmLayout) string {
	var b strings.Builder
	fmt.Fprintf(&b, "export KUBECONFIG=%s\n", AdminKubeconfigPath(ref.Node.Name))
	b.WriteString(`kubectl get --raw=/readyz >/dev/null 2>&1 || { echo "WAIT API server not reachable yet"; exit 0; }
`)
	for _, m := range l.members {
		q := shellQuote([]string{m.Name})
		fmt.Fprintf(&b, "ssh -T %s true >/dev/null 2>&1 || { echo \"WAIT node %s not reachable\"; exit 0; }\n", q, m.Name)
	}
	b.WriteString("echo READY\n")
	return b.String()
}

// Hibernate stops every member VM (runStrategy Halted) when the disks are
// persistent; the next Provision starts them again. On ephemeral
// containerDisks the cluster keeps running.
func (d *KubeadmDriver) Hibernate(ctx context.Context, ref NodeRef) error {
	if !d.Disks.Persistent {
		return fmt.Errorf("kubeadm cluster %s boots from ephemeral disks: %w", ref.Node.Name, ErrUnsupported)
	}
	l, err := d.layout(ref)
	if err != nil {
		return err
	}
	return client.IgnoreNotFound(setRunStrategy(ctx, d.Client, d.reader(), ref.Namespace(), l.vms, "Halted"))
}

func lastLine(s string) string {
	if i := strings.LastIndexByte(s, '\n'); i >= 0 {
		return s[i+1:]
	}
	return s
}

// Status observes the cluster without changing anything.
func (d *KubeadmDriver) Status(ctx context.Context, ref NodeRef) (NodeState, error) {
	l, err := d.layout(ref)
	if err != nil {
		return NodeState{Phase: labsv1.NodeFailed, Message: err.Error()}, err
	}
	if ref.Session.Spec.Hibernate && d.Disks.Persistent {
		return stoppedState(ctx, d.reader(), ref.Namespace(), l.vms)
	}
	return d.observe(ctx, ref, l, false)
}

// Access contributes every member host and the cluster's kubeconfigs as soon
// as the PKI exists (before the VMs boot).
func (d *KubeadmDriver) Access(ctx context.Context, ref NodeRef) (NodeAccess, bool, error) {
	l, err := d.layout(ref)
	if err != nil {
		return NodeAccess{}, false, err
	}
	pki := &corev1.Secret{}
	if err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: PKISecretName(ref)}, pki); err != nil {
		return NodeAccess{}, false, client.IgnoreNotFound(err)
	}
	kc := &corev1.Secret{}
	if err := d.reader().Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: KubeconfigSecretName(ref)}, kc); err != nil {
		return NodeAccess{}, false, client.IgnoreNotFound(err)
	}
	var a NodeAccess
	for _, m := range l.members {
		h := l.hosts[m.Name]
		a.Hosts = append(a.Hosts, HostAccess{Name: m.Name, IP: h.IP, HostKey: pki.Data["host."+m.Name+".pub"]})
	}
	a.Clusters = []ClusterAccess{{Node: ref.Node.Name, Context: clusterContext(ref.Node),
		Learner: kc.Data["learner.conf"], Admin: kc.Data["admin.conf"]}}
	return a, true, nil
}

// Exec: on the cluster (kubectl with the admin or learner kubeconfig) or,
// with req.Member, on that member over ssh. Apply always targets the cluster.
func (d *KubeadmDriver) Exec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error) {
	if req.Member == "" || req.Kind == ExecKubeApply {
		return execOnCluster(ctx, d.Container, ref, req)
	}
	if ref.Node.Cluster == nil || !hasMember(ref.Node.Cluster, req.Member) {
		return ExecResult{}, fmt.Errorf("cluster %s has no member %q: %w", ref.Node.Name, req.Member, ErrUnsupported)
	}
	return execOnHost(ctx, d.Container, ref, req.Member, req)
}

func hasMember(c *labsv1.ClusterSpec, name string) bool {
	for _, m := range c.Nodes {
		if m.Name == name {
			return true
		}
	}
	return false
}

// Connect: ssh to the control-plane node through the entry node.
func (d *KubeadmDriver) Connect(_ context.Context, ref NodeRef, access labsv1.AccessType) (labsv1.Endpoint, error) {
	if access != labsv1.AccessSSH {
		return labsv1.Endpoint{}, fmt.Errorf("kubeadm cluster: %s access: %w", access, ErrUnsupported)
	}
	l, err := d.layout(ref)
	if err != nil {
		return labsv1.Endpoint{}, err
	}
	return hostEndpoint(ref, l.cpHost.IP)
}

// Reset deletes the member VMs (and their disks); Provision recreates them
// (fresh disks, a new cluster with the same PKI). ErrInProgress until the
// old VMs and disks are gone.
func (d *KubeadmDriver) Reset(ctx context.Context, ref NodeRef) error {
	l, err := d.layout(ref)
	if err != nil {
		return err
	}
	gone, err := deleteVMs(ctx, d.Client, d.reader(), ref.Session, l.vms)
	if err != nil {
		return err
	}
	if !gone {
		return inProgress("kubeadm cluster %s VMs are being deleted for reset", ref.Node.Name)
	}
	return nil
}

// Destroy deletes the VMs and Secrets; ErrInProgress until the VMs are gone.
// It relies only on the recorded topology (ref.Node).
func (d *KubeadmDriver) Destroy(ctx context.Context, ref NodeRef) error {
	var vms []string
	if ref.Node.Cluster != nil {
		for _, m := range ref.Node.Cluster.Nodes {
			vms = append(vms, memberVM(ref, m.Name))
		}
	}
	gone, err := deleteVMs(ctx, d.Client, d.reader(), ref.Session, vms)
	if err != nil {
		return err
	}
	names := []string{PKISecretName(ref), KubeconfigSecretName(ref)}
	for _, vm := range vms {
		names = append(names, vm+"-cloudinit")
	}
	for _, n := range names {
		if _, err := deleteIfOwned(ctx, d.Client, d.reader(), ref.Session,
			&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ref.Namespace(), Name: n}}); err != nil {
			return err
		}
	}
	if !gone {
		return inProgress("kubeadm cluster %s VMs are terminating", ref.Node.Name)
	}
	return nil
}

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
