package drivers

// KubeVirt VirtualMachines on the session's lab network and their cloud-init,
// shared by the vm driver and the kubeadm cluster backend (ported from
// deploy/scripts/lab-demo.sh).

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

const (
	// AnnotationBootstrapped on a VM records the instance id whose bootstrap
	// (cloud-init done, cluster converged, labels applied) was confirmed, so
	// it is done once per incarnation and never re-applied over learner work.
	AnnotationBootstrapped = "labs.cloudtrain.dev/bootstrapped"
	// LabelMember labels the VM of a kubeadm cluster member.
	LabelMember = "labs.cloudtrain.dev/member"
)

// vmSpec describes one VM-backed host.
type vmSpec struct {
	Name     string // object name
	Hostname string
	IP       string
	Image    string // containerDisk image
	Cores    int64
	MemMiB   int64
	CISecret string // Secret with key "userdata"
	Labels   map[string]string
}

// buildVM renders a KubeVirt VirtualMachine on the lab subnet.
func buildVM(s *labsv1.LabSession, net LabNet, v vmSpec) *unstructured.Unstructured {
	vm := newObj(GVKVirtualMachine, s.Namespace, v.Name)
	vm.SetLabels(v.Labels)
	tplLabels := map[string]any{}
	for k, val := range v.Labels {
		tplLabels[k] = val
	}
	mem := fmt.Sprintf("%dMi", v.MemMiB)
	vm.Object["spec"] = map[string]any{
		"runStrategy": "Always",
		"template": map[string]any{
			"metadata": map[string]any{
				"labels": tplLabels,
				"annotations": map[string]any{
					"ovn.kubernetes.io/logical_switch": net.LabSubnet(),
					"ovn.kubernetes.io/ip_address":     v.IP,
				},
			},
			"spec": map[string]any{
				"hostname": v.Hostname,
				"domain": map[string]any{
					"cpu":       map[string]any{"cores": v.Cores},
					"memory":    map[string]any{"guest": mem},
					"resources": map[string]any{"requests": map[string]any{"memory": mem}},
					"devices": map[string]any{
						"disks": []any{
							map[string]any{"name": "root", "disk": map[string]any{"bus": "virtio"}},
							map[string]any{"name": "cloudinit", "disk": map[string]any{"bus": "virtio"}},
						},
						"interfaces": []any{map[string]any{"name": "default", "bridge": map[string]any{}}},
						"rng":        map[string]any{},
					},
				},
				"networks": []any{map[string]any{"name": "default", "pod": map[string]any{}}},
				"volumes": []any{
					map[string]any{"name": "root", "containerDisk": map[string]any{"image": v.Image, "imagePullPolicy": "IfNotPresent"}},
					map[string]any{"name": "cloudinit", "cloudInitNoCloud": map[string]any{"secretRef": map[string]any{"name": v.CISecret}}},
				},
			},
		},
	}
	return vm
}

// vmResources maps node resources to cores and MiB with defaults.
func vmResources(r *labsv1.NodeResources, cores, memMiB int64) (int64, int64) {
	if r != nil {
		if r.CPU != nil {
			if c := int64(math.Ceil(r.CPU.AsApproximateFloat64())); c > 0 {
				cores = c
			}
		}
		if r.MemoryMiB != nil && *r.MemoryMiB > 0 {
			memMiB = *r.MemoryMiB
		}
	}
	return cores, memMiB
}

// cloudInitFile is a cloud-init write_files entry.
type cloudInitFile struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	Permissions string `json:"permissions,omitempty"`
	Encoding    string `json:"encoding,omitempty"`
}

// cloudInit is the per-host cloud-config.
type cloudInit struct {
	Hostname   string
	LearnerPub []byte
	AdminPub   []byte
	HostKey    SSHKeyPair
	Hosts      []PlannedHost
	Files      []cloudInitFile
	RunCmd     []string
}

// Render returns the #cloud-config document: the learner account (sudo
// without password, learner key), root reachable with the admin key only,
// pinned host keys, a static /etc/hosts with every lab host, and a resolver
// for kubelet that is not the host cluster's DNS (see lab-demo.sh).
func (c cloudInit) Render() ([]byte, error) {
	var hosts strings.Builder
	hosts.WriteString("127.0.0.1 localhost\n")
	for _, h := range c.Hosts {
		fmt.Fprintf(&hosts, "%s %s\n", h.IP, h.Name)
	}
	files := []cloudInitFile{
		{Path: "/etc/cloudtrain/resolv.conf", Content: "nameserver " + LabGateway + "\n"},
		{Path: "/etc/hosts", Content: hosts.String()},
		{Path: "/root/.ssh/authorized_keys", Content: string(c.AdminPub), Permissions: "0600"},
	}
	files = append(files, c.Files...)
	runcmd := []any{[]any{"bash", "-c", "date +%s.%N > /var/log/cloudtrain-boot.ts"}}
	for _, r := range c.RunCmd {
		runcmd = append(runcmd, []any{"bash", "-c", r})
	}
	doc := map[string]any{
		"hostname":                 c.Hostname,
		"prefer_fqdn_over_hostname": false,
		"manage_etc_hosts":          false,
		"ssh_pwauth":                false,
		"disable_root":              false,
		"ssh_deletekeys":            true,
		"ssh_genkeytypes":           []any{},
		"ssh_keys": map[string]any{
			"ed25519_private": string(c.HostKey.Private),
			"ed25519_public":  strings.TrimSpace(string(c.HostKey.Public)),
		},
		"users": []any{map[string]any{
			"name": LearnerUser, "gecos": "CloudTrain learner", "groups": []any{"sudo"},
			"sudo": "ALL=(ALL) NOPASSWD:ALL", "shell": "/bin/bash", "lock_passwd": true,
			"ssh_authorized_keys": []any{strings.TrimSpace(string(c.LearnerPub))},
		}},
		"write_files": files,
		"runcmd":      runcmd,
	}
	b, err := yaml.Marshal(doc)
	if err != nil {
		return nil, err
	}
	return append([]byte("#cloud-config\n"), b...), nil
}

// ensureSecret creates a session-owned Secret unless it exists.
func ensureSecret(ctx context.Context, c client.Client, r client.Reader, s *labsv1.LabSession, name string, data map[string][]byte) error {
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Namespace: s.Namespace, Name: name, Labels: SessionLabels(s)},
		Data:       data,
	}
	if err := setOwner(s, sec, c); err != nil {
		return err
	}
	return ensure(ctx, c, r, s, sec)
}

// vmiStatus summarises the VMIs of a set of VMs.
type vmiStatus struct {
	running int
	total   int
	// instance hashes the VMI UIDs (changes when any VM was recreated).
	instance string
	waiting  []string
}

// observeVMIs reads the VMI of each VM name.
func observeVMIs(ctx context.Context, r client.Reader, ns string, names []string) (vmiStatus, error) {
	st := vmiStatus{total: len(names)}
	var uids []string
	for _, n := range names {
		vmi := newObj(GVKVMI, ns, n)
		err := r.Get(ctx, client.ObjectKeyFromObject(vmi), vmi)
		switch {
		case apierrors.IsNotFound(err):
			st.waiting = append(st.waiting, n+" (no instance yet)")
			continue
		case err != nil:
			return st, err
		}
		phase, _, _ := unstructured.NestedString(vmi.Object, "status", "phase")
		if phase == "Running" && vmi.GetDeletionTimestamp() == nil {
			st.running++
			uids = append(uids, n+"="+string(vmi.GetUID()))
		} else {
			if phase == "" {
				phase = "Pending"
			}
			st.waiting = append(st.waiting, n+" ("+phase+")")
		}
	}
	sort.Strings(uids)
	sum := sha256.Sum256([]byte(strings.Join(uids, ",")))
	st.instance = hex.EncodeToString(sum[:])[:16]
	return st, nil
}

// deleteVMs deletes the session's VMs and reports whether VMs and VMIs are gone.
func deleteVMs(ctx context.Context, c client.Client, r client.Reader, s *labsv1.LabSession, names []string) (bool, error) {
	gone := true
	for _, n := range names {
		g, err := deleteIfOwned(ctx, c, r, s, newObj(GVKVirtualMachine, s.Namespace, n))
		if err != nil && !meta.IsNoMatchError(err) {
			return false, err
		}
		if !g {
			gone = false
		}
		vmi := newObj(GVKVMI, s.Namespace, n)
		err = r.Get(ctx, client.ObjectKeyFromObject(vmi), vmi)
		if err == nil {
			gone = false
		} else if !apierrors.IsNotFound(err) && !meta.IsNoMatchError(err) {
			return false, err
		}
	}
	return gone, nil
}

// annotateVM sets AnnotationBootstrapped on a VM.
func annotateVM(ctx context.Context, c client.Client, ns, name, value string) error {
	vm := newObj(GVKVirtualMachine, ns, name)
	patch := []byte(fmt.Sprintf(`{"metadata":{"annotations":{%q:%q}}}`, AnnotationBootstrapped, value))
	return c.Patch(ctx, vm, client.RawPatch("application/merge-patch+json", patch))
}

// vmAnnotation reads one annotation of a VM ("" if absent).
func vmAnnotation(ctx context.Context, r client.Reader, ns, name, key string) (string, error) {
	vm := newObj(GVKVirtualMachine, ns, name)
	if err := r.Get(ctx, client.ObjectKeyFromObject(vm), vm); err != nil {
		return "", client.IgnoreNotFound(err)
	}
	return vm.GetAnnotations()[key], nil
}

// hostEndpoint is the ssh endpoint of a lab host: only reachable through the
// entry node, so Target names the entry's k8s-exec target as the jump host.
func hostEndpoint(ref NodeRef, ip string) (labsv1.Endpoint, error) {
	ep := labsv1.Endpoint{Node: ref.Node.Name, Access: labsv1.AccessSSH, Protocol: "ssh", Host: ip, Port: PortSSH}
	if e, err := EntryRef(ref); err == nil {
		ep.Target = fmt.Sprintf("via:%s/%s/%s", e.Namespace(), e.ResourceName(), ContainerName)
	}
	return ep, nil
}
