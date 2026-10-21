package drivers

// The entry node (topology.entry, a container node such as the learner's
// jumphost) is where the learner works and where the platform reaches the
// rest of the topology from:
//
//	pod <session>-<entry>-<hash>
//	 ├─ container "node"   learner shell. Runs as root so admin actions can
//	 │                     prepare files; learner commands and terminals run
//	 │                     as the non-root user "learner" (runuser,
//	 │                     no_new_privs). Holds only learner credentials:
//	 │                     ~/.kube/config (one context per cluster) and
//	 │                     ~/.ssh (key, config, known_hosts).
//	 └─ container "admin"  out-of-band admin channel: cluster-admin
//	                       kubeconfigs (/root/.kube/<node>.conf) and the root
//	                       ssh key for every VM. Its filesystem is not visible
//	                       from "node" (no shared process namespace, no shared
//	                       volume), so the learner can never read them.
//
// Both containers share the pod network: eth0 (platform network, isolated by
// EntryNetworkPolicy) and, for topologies with VMs, net1 on the session's lab
// network access subnet. The credentials are not mounted from Secrets: they
// are written into the containers by exec once available ("wiring"), so the
// learner's kubeconfig stays writable and a vcluster that comes up later is
// added without restarting the pod.

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/network"
)

const (
	// AdminContainerName is the entry pod's admin sidecar.
	AdminContainerName = "admin"
	// AnnotationWired records what was written into the entry pod
	// ("<instance>/<digest>").
	AnnotationWired = "labs.cloudtrain.dev/wired"
	learnerUID      = 1000
	// AnnotationLearnerSudo marks entry pods whose learner may escalate
	// privileges (lab topology learnerSudo: true).
	AnnotationLearnerSudo = "labs.cloudtrain.dev/learner-sudo"
)

// isEntry reports whether ref is the topology's entry node.
func isEntry(ref NodeRef) bool {
	return ref.Template != nil && ref.Template.Topology.Entry == ref.Node.Name && ref.Node.Driver == labsv1.DriverContainer
}

// decorateEntryPod adds the admin sidecar, host aliases and the lab network
// attachment to the entry node's pod.
func (d *ContainerDriver) decorateEntryPod(ref NodeRef, pod *corev1.Pod) {
	topo := &ref.Template.Topology
	root := ptr.To[int64](0)
	node := &pod.Spec.Containers[0]
	node.SecurityContext = &corev1.SecurityContext{
		RunAsUser: root, RunAsGroup: root,
		// Setuid binaries cannot raise the learner's privileges, unless the
		// lab opts in with learnerSudo (security trade-off: the learner can
		// become root in this unprivileged container; Provision refuses it
		// when the operator disallows learner sudo).
		AllowPrivilegeEscalation: ptr.To(ref.Node.LearnerSudo),
	}
	if ref.Node.LearnerSudo {
		if pod.Annotations == nil {
			pod.Annotations = map[string]string{}
		}
		pod.Annotations[AnnotationLearnerSudo] = "true"
	}
	adminImage := d.AdminImage
	if adminImage == "" {
		adminImage = node.Image
	}
	pod.Spec.Containers = append(pod.Spec.Containers, corev1.Container{
		Name:    AdminContainerName,
		Image:   adminImage,
		Command: []string{"sleep", "infinity"},
		SecurityContext: &corev1.SecurityContext{
			RunAsUser: root, RunAsGroup: root,
			AllowPrivilegeEscalation: ptr.To(false),
			Capabilities:             &corev1.Capabilities{Drop: []corev1.Capability{"ALL"}},
		},
		Resources: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("10m"), corev1.ResourceMemory: resource.MustParse("32Mi")},
			Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("256Mi")},
		},
	})
	hosts := HostPlan(topo)
	for _, h := range hosts {
		pod.Spec.HostAliases = append(pod.Spec.HostAliases, corev1.HostAlias{IP: h.IP, Hostnames: []string{h.Name}})
	}
	if len(hosts) > 0 {
		n := NewLabNet(ref.Session)
		if pod.Annotations == nil {
			pod.Annotations = map[string]string{}
		}
		pod.Annotations["k8s.v1.cni.cncf.io/networks"] = n.NAD()
		pod.Annotations[n.Provider()+".kubernetes.io/ip_address"] = EntryIP
		pod.Annotations[n.Provider()+".kubernetes.io/routes"] = fmt.Sprintf(`[{"dst":%q,"gw":%q}]`, LabCIDR, AccessGateway)
	}
}

// EntryRef returns the NodeRef of the session's entry node.
func EntryRef(ref NodeRef) (NodeRef, error) {
	if ref.Template == nil || ref.Template.Topology.Entry == "" {
		return NodeRef{}, fmt.Errorf("topology has no entry node: %w", ErrUnsupported)
	}
	for _, n := range ref.Template.Topology.Nodes {
		if n.Name == ref.Template.Topology.Entry {
			if n.Driver != labsv1.DriverContainer {
				return NodeRef{}, fmt.Errorf("entry node %q must be a container node: %w", n.Name, ErrUnsupported)
			}
			return NodeRef{Session: ref.Session, Template: ref.Template, Node: n}, nil
		}
	}
	return NodeRef{}, fmt.Errorf("entry node %q not in topology: %w", ref.Template.Topology.Entry, ErrUnsupported)
}

// AdminExec runs req.Command as root in the entry pod's admin sidecar.
func (d *ContainerDriver) AdminExec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error) {
	e, err := EntryRef(ref)
	if err != nil {
		return ExecResult{}, err
	}
	req.User = labsv1.ActionAsAdmin
	return d.ExecIn(ctx, e, AdminContainerName, req)
}

// LearnerExec runs req.Command as the learner in the entry node container.
func (d *ContainerDriver) LearnerExec(ctx context.Context, ref NodeRef, req ExecRequest) (ExecResult, error) {
	e, err := EntryRef(ref)
	if err != nil {
		return ExecResult{}, err
	}
	req.User = labsv1.ActionAsLearner
	return d.ExecIn(ctx, e, ContainerName, req)
}

// HostAccess is a VM-backed host the entry node reaches over ssh.
type HostAccess struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
	// HostKey is the host's public key (authorized_keys format).
	HostKey []byte `json:"hostKey"`
}

// ClusterAccess is a Kubernetes cluster the entry node has contexts for.
type ClusterAccess struct {
	// Node is the topology node name of the cluster (admin kubeconfig file name).
	Node string `json:"node"`
	// Context is cluster.context, the learner's context name.
	Context string `json:"context"`
	// Learner and Admin are single-context kubeconfigs named Context.
	Learner []byte `json:"learner"`
	Admin   []byte `json:"admin"`
}

// NodeAccess is what a node contributes to the entry node.
type NodeAccess struct {
	Hosts    []HostAccess    `json:"hosts,omitempty"`
	Clusters []ClusterAccess `json:"clusters,omitempty"`
}

// AccessProvider is implemented by drivers whose nodes the entry node must
// reach. ok=false means the access material is not available yet.
type AccessProvider interface {
	Access(ctx context.Context, ref NodeRef) (access NodeAccess, ok bool, err error)
}

// EntryAccess is everything wired into the entry pod.
type EntryAccess struct {
	LearnerKey SSHKeyPair      `json:"learnerKey"`
	AdminKey   SSHKeyPair      `json:"adminKey"`
	Hosts      []HostAccess    `json:"hosts,omitempty"`
	Clusters   []ClusterAccess `json:"clusters,omitempty"`
}

// Digest identifies the wired content.
func (a EntryAccess) Digest() string {
	b, _ := json.Marshal(a)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])[:16]
}

type tarFile struct {
	path     string
	mode     int64
	uid, gid int
	dir      bool
	data     []byte
}

func buildTar(files []tarFile) ([]byte, error) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	now := time.Now()
	for _, f := range files {
		h := &tar.Header{Name: f.path, Mode: f.mode, Uid: f.uid, Gid: f.gid, ModTime: now, Format: tar.FormatPAX}
		if f.dir {
			h.Typeflag, h.Name = tar.TypeDir, strings.TrimSuffix(f.path, "/")+"/"
		} else {
			h.Typeflag, h.Size = tar.TypeReg, int64(len(f.data))
		}
		if err := tw.WriteHeader(h); err != nil {
			return nil, err
		}
		if !f.dir {
			if _, err := tw.Write(f.data); err != nil {
				return nil, err
			}
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// sshConfig renders an ssh client config for the session's hosts. UpdateHostKeys
// no: known_hosts pins each host's key, and a VM's sshd lists its ed25519 key
// twice (graderDropIn), which the hostkeys extension reports on every login
// as "received duplicated ssh-ed25519 host key".
func sshConfig(hosts []HostAccess, user, identity, knownHosts string, batch bool) []byte {
	var b strings.Builder
	for _, h := range hosts {
		fmt.Fprintf(&b, "Host %s\n  HostName %s\n", h.Name, h.IP)
	}
	fmt.Fprintf(&b, "Host *\n  User %s\n  IdentityFile %s\n  UserKnownHostsFile %s\n  StrictHostKeyChecking yes\n  UpdateHostKeys no\n  ConnectTimeout 5\n  LogLevel ERROR\n", user, identity, knownHosts)
	if batch {
		b.WriteString("  BatchMode yes\n  ServerAliveInterval 10\n")
	}
	return []byte(b.String())
}

func knownHosts(hosts []HostAccess) []byte {
	var b strings.Builder
	for _, h := range hosts {
		if line := KnownHostsLine([]string{h.Name, h.IP}, h.HostKey); line != "" {
			b.WriteString(line + "\n")
		}
	}
	return []byte(b.String())
}

// learnerFiles renders the learner's home files.
func learnerFiles(a EntryAccess) ([]tarFile, error) {
	var kcs [][]byte
	for _, c := range a.Clusters {
		kcs = append(kcs, c.Learner)
	}
	kube, err := MergeKubeconfigs("", kcs...)
	if err != nil {
		return nil, err
	}
	home := "home/" + LearnerUser
	f := func(p string, mode int64, data []byte) tarFile {
		return tarFile{path: home + "/" + p, mode: mode, uid: learnerUID, gid: learnerUID, data: data}
	}
	d := func(p string) tarFile {
		return tarFile{path: home + "/" + p, mode: 0o700, uid: learnerUID, gid: learnerUID, dir: true}
	}
	files := []tarFile{d(".ssh"), f(".ssh/id_ed25519", 0o600, a.LearnerKey.Private), f(".ssh/id_ed25519.pub", 0o644, a.LearnerKey.Public),
		f(".ssh/config", 0o644, sshConfig(a.Hosts, LearnerUser, "~/.ssh/id_ed25519", "~/.ssh/known_hosts", false)),
		f(".ssh/known_hosts", 0o644, knownHosts(a.Hosts))}
	if len(a.Clusters) > 0 {
		files = append(files, d(".kube"), f(".kube/config", 0o600, kube))
	}
	return files, nil
}

// adminFiles renders the admin sidecar's files.
func adminFiles(a EntryAccess) []tarFile {
	f := func(p string, mode int64, data []byte) tarFile {
		return tarFile{path: "root/" + p, mode: mode, data: data}
	}
	files := []tarFile{{path: "root/.ssh", mode: 0o700, dir: true}, {path: "root/.kube", mode: 0o700, dir: true},
		f(".ssh/id_ed25519", 0o600, a.AdminKey.Private),
		f(".ssh/config", 0o600, sshConfig(a.Hosts, "root", "/root/.ssh/id_ed25519", "/root/.ssh/known_hosts", true)),
		f(".ssh/known_hosts", 0o600, knownHosts(a.Hosts))}
	for _, c := range a.Clusters {
		files = append(files, f(".kube/"+c.Node+".conf", 0o600, c.Admin))
	}
	return files
}

// wiredMarker records the access digest last written into the learner's home.
const wiredMarker = LearnerHome + "/.cloudtrain-wired"

// learnerWireScript extracts the learner's files (tar on stdin) unless the
// home already carries the same access ($1 = digest).
const learnerWireScript = `m=` + wiredMarker + `
if [ "$(cat "$m" 2>/dev/null)" = "$1" ]; then cat >/dev/null; exit 0; fi
tar -x -C / -f - && printf '%s' "$1" > "$m"`

// AdminKubeconfigPath is where the admin sidecar keeps a cluster's admin kubeconfig.
func AdminKubeconfigPath(clusterNode string) string { return "/root/.kube/" + clusterNode + ".conf" }

// Wire writes access into the entry pod unless the pod already carries it
// (AnnotationWired). wired=false means the pod is not running yet.
func (d *ContainerDriver) Wire(ctx context.Context, ref NodeRef, access EntryAccess) (bool, error) {
	pod := &corev1.Pod{}
	if err := d.Client.Get(ctx, client.ObjectKey{Namespace: ref.Namespace(), Name: ref.ResourceName()}, pod); err != nil {
		if apierrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	if st, _ := podState(pod); st.Phase != labsv1.NodeReady || !d.owns(ref, pod) {
		return false, nil
	}
	marker := podInstanceID(pod) + "/" + access.Digest()
	if pod.Annotations[AnnotationWired] == marker {
		return true, nil
	}
	lf, err := learnerFiles(access)
	if err != nil {
		return false, err
	}
	for _, w := range []struct {
		container string
		files     []tarFile
		args      []string
	}{
		// The learner's files are skipped when the (persistent) home already
		// holds exactly this access: a resumed pod must not overwrite the
		// learner's kubeconfig (current context, namespaces) or ssh config.
		{ContainerName, lf, []string{"/bin/sh", "-c", learnerWireScript, "sh", access.Digest()}},
		{AdminContainerName, adminFiles(access), []string{"tar", "--no-same-owner", "-x", "-C", "/", "-f", "-"}},
	} {
		data, err := buildTar(w.files)
		if err != nil {
			return false, err
		}
		res, err := d.ExecIn(ctx, ref, w.container, ExecRequest{Command: w.args, Stdin: data, Timeout: time.Minute})
		if err != nil {
			return false, fmt.Errorf("wire %s: %w", w.container, err)
		}
		if res.ExitCode != 0 {
			return false, fmt.Errorf("wire %s: tar exited %d: %s", w.container, res.ExitCode, strings.TrimSpace(res.Stderr))
		}
	}
	patch := client.MergeFrom(pod.DeepCopy())
	if pod.Annotations == nil {
		pod.Annotations = map[string]string{}
	}
	pod.Annotations[AnnotationWired] = marker
	if err := d.Client.Patch(ctx, pod, patch); err != nil {
		return false, err
	}
	return true, nil
}

// SessionRuntime holds the session-scoped parts of the runtime: the SSH
// keys of the session, the entry isolation policy, the lab network for
// VM-backed nodes, and the wiring of the entry node.
type SessionRuntime struct {
	Client    client.Client
	Reader    client.Reader
	Container *ContainerDriver
	Network   *LabNetwork
	// Registry finds the AccessProviders of the topology's nodes.
	Registry *Registry
}

func (r *SessionRuntime) reader() client.Reader {
	if r.Reader != nil {
		return r.Reader
	}
	return r.Client
}

// labNet returns the session's network names in the runtime's network mode.
func (r *SessionRuntime) labNet(s *labsv1.LabSession) LabNet {
	if r == nil {
		return NewLabNet(s)
	}
	return r.Network.LabNet(s)
}

// networkMode is the runtime's network mode (primary without a lab network).
func (r *SessionRuntime) networkMode() network.Mode {
	if r == nil || r.Network == nil || r.Network.Options.Mode == "" {
		return network.ModePrimary
	}
	return r.Network.Options.Mode
}

// SSHSecretName is the session's SSH key Secret.
func SSHSecretName(s *labsv1.LabSession) string { return "ct-" + SessionHash(s) + "-ssh" }

// ProvisionTopology creates the session keys, the entry policy, the lab peer
// Service and policy (labpeers.go) and (if the topology has VM-backed hosts)
// the lab network.
func (r *SessionRuntime) ProvisionTopology(ctx context.Context, ref SessionRef) (bool, error) {
	if _, err := r.keys(ctx, ref.Session, true); err != nil {
		return false, err
	}
	topo := &ref.Template.Topology
	if entry, err := EntryRef(NodeRef{Session: ref.Session, Template: ref.Template}); err == nil {
		np := EntryNetworkPolicy(ref.Session, entry.Node.Name, VClusterReleases(ref.Session, topo))
		if nets := EntryPolicyNetworks(ref.Session, topo, entry.Node.Name, r.networkMode()); nets != "" {
			np.Annotations = map[string]string{AnnotationNetworkPolicyFor: nets}
		}
		if err := setOwner(ref.Session, np, r.Client); err != nil {
			return false, err
		}
		if err := ensure(ctx, r.Client, r.reader(), ref.Session, np); err != nil {
			return false, err
		}
	}
	if len(LabPeers(topo)) > 0 {
		svc, np := PeerService(ref.Session), PeerNetworkPolicy(ref.Session)
		for _, obj := range []client.Object{svc, np} {
			if err := setOwner(ref.Session, obj, r.Client); err != nil {
				return false, err
			}
			if err := ensure(ctx, r.Client, r.reader(), ref.Session, obj); err != nil {
				return false, err
			}
		}
	}
	if NeedsLabNetwork(topo) && r.Network != nil {
		return r.Network.Ensure(ctx, ref.Session)
	}
	return true, nil
}

// DestroyTopology removes the session objects once no session pod is left.
func (r *SessionRuntime) DestroyTopology(ctx context.Context, ref SessionRef) error {
	s := ref.Session
	pods := &corev1.PodList{}
	if s.UID != "" {
		if err := r.reader().List(ctx, pods, client.InNamespace(s.Namespace), client.MatchingLabels{LabelSessionUID: string(s.UID)}); err != nil {
			return err
		}
		if len(pods.Items) > 0 {
			return inProgress("%d pod(s) of session %s/%s still terminating", len(pods.Items), s.Namespace, s.Name)
		}
	}
	for _, obj := range []client.Object{
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: s.Namespace, Name: SSHSecretName(s)}},
		EntryNetworkPolicy(s, "", nil),
		PeerService(s),
		PeerNetworkPolicy(s),
	} {
		if _, err := deleteIfOwned(ctx, r.Client, r.reader(), s, obj); err != nil {
			return err
		}
	}
	if r.Network != nil && NeedsLabNetwork(&ref.Template.Topology) {
		return r.Network.Destroy(ctx, s)
	}
	return nil
}

type sessionKeys struct{ learner, admin SSHKeyPair }

// keys returns the session's learner and admin SSH keys, creating them once.
func (r *SessionRuntime) keys(ctx context.Context, s *labsv1.LabSession, create bool) (sessionKeys, error) {
	sec := &corev1.Secret{}
	key := client.ObjectKey{Namespace: s.Namespace, Name: SSHSecretName(s)}
	err := r.reader().Get(ctx, key, sec)
	if err == nil {
		if !ownedBySession(s, sec) {
			return sessionKeys{}, fmt.Errorf("secret %s does not belong to session %s: %w", key.Name, s.Name, ErrConflict)
		}
		return sessionKeys{
			learner: SSHKeyPair{Private: sec.Data["learner"], Public: sec.Data["learner.pub"]},
			admin:   SSHKeyPair{Private: sec.Data["admin"], Public: sec.Data["admin.pub"]},
		}, nil
	}
	if !apierrors.IsNotFound(err) || !create {
		return sessionKeys{}, err
	}
	learner, err := NewSSHKeyPair("learner@cloudtrain")
	if err != nil {
		return sessionKeys{}, err
	}
	admin, err := NewSSHKeyPair("admin@cloudtrain")
	if err != nil {
		return sessionKeys{}, err
	}
	sec = &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Namespace: s.Namespace, Name: key.Name, Labels: SessionLabels(s)},
		Data: map[string][]byte{"learner": learner.Private, "learner.pub": learner.Public,
			"admin": admin.Private, "admin.pub": admin.Public},
	}
	if err := setOwner(s, sec, r.Client); err != nil {
		return sessionKeys{}, err
	}
	if err := r.Client.Create(ctx, sec); err != nil {
		if apierrors.IsAlreadyExists(err) {
			return r.keys(ctx, s, false)
		}
		return sessionKeys{}, err
	}
	return sessionKeys{learner: learner, admin: admin}, nil
}

// SessionKeys returns the session's learner and admin public keys (for VM
// cloud-init). It fails until ProvisionTopology created them.
func (r *SessionRuntime) SessionKeys(ctx context.Context, s *labsv1.LabSession) (learnerPub, adminPub []byte, err error) {
	k, err := r.keys(ctx, s, false)
	if err != nil {
		return nil, nil, err
	}
	return k.learner.Public, k.admin.Public, nil
}

// WireEntry writes every available access into the entry node. done is
// true once the entry is wired with every node's access; msg says what is
// still missing.
func (r *SessionRuntime) WireEntry(ctx context.Context, ref SessionRef) (bool, string, error) {
	entry, err := EntryRef(NodeRef{Session: ref.Session, Template: ref.Template})
	if err != nil {
		return true, "", nil // nothing to wire
	}
	k, err := r.keys(ctx, ref.Session, false)
	if err != nil {
		return false, "", err
	}
	access := EntryAccess{LearnerKey: k.learner, AdminKey: k.admin}
	var missing []string
	for _, n := range ref.Template.Topology.Nodes {
		if n.Name == entry.Node.Name || r.Registry == nil {
			continue
		}
		d, err := r.Registry.Get(n.Driver)
		if err != nil {
			continue
		}
		ap, ok := d.(AccessProvider)
		if !ok {
			continue
		}
		na, ok, err := ap.Access(ctx, NodeRef{Session: ref.Session, Template: ref.Template, Node: n})
		if err != nil {
			return false, "", fmt.Errorf("access to %s: %w", n.Name, err)
		}
		if !ok {
			missing = append(missing, n.Name)
			continue
		}
		access.Hosts = append(access.Hosts, na.Hosts...)
		access.Clusters = append(access.Clusters, na.Clusters...)
	}
	sort.Slice(access.Hosts, func(i, j int) bool { return access.Hosts[i].Name < access.Hosts[j].Name })
	sort.Slice(access.Clusters, func(i, j int) bool { return access.Clusters[i].Node < access.Clusters[j].Node })
	wired, err := r.Container.Wire(ctx, entry, access)
	if err != nil {
		return false, "", err
	}
	if !wired {
		return false, "waiting for entry node " + entry.Node.Name, nil
	}
	if len(missing) > 0 {
		return false, "waiting for access to " + strings.Join(missing, ", "), nil
	}
	return true, "", nil
}

// SessionProvisioner is the session-scoped part of the runtime the
// reconciler drives: topology-wide resources plus wiring of the entry node.
type SessionProvisioner interface {
	TopologyProvisioner
	// WireEntry gives the entry node access to every other node. done is
	// false (with a reason) until all access material is in place.
	WireEntry(ctx context.Context, ref SessionRef) (done bool, msg string, err error)
}

var _ SessionProvisioner = (*SessionRuntime)(nil)
