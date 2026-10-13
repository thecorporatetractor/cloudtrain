package network

import (
	"context"
	"errors"
	"fmt"
	"sort"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Object kinds managed here (unstructured: no Kube-OVN / Multus Go deps).
var (
	VpcGVK    = schema.GroupVersionKind{Group: "kubeovn.io", Version: "v1", Kind: "Vpc"}
	SubnetGVK = schema.GroupVersionKind{Group: "kubeovn.io", Version: "v1", Kind: "Subnet"}
	NADGVK    = schema.GroupVersionKind{Group: "k8s.cni.cncf.io", Version: "v1", Kind: "NetworkAttachmentDefinition"}
)

// Labels on every network object.
const (
	LabelSession    = "labs.cloudtrain.dev/session"
	LabelSessionNS  = "labs.cloudtrain.dev/session-namespace"
	LabelSessionUID = "labs.cloudtrain.dev/session-uid"
	LabelSegment    = "labs.cloudtrain.dev/segment"
	LabelManagedBy  = "app.kubernetes.io/managed-by"
	ManagedBy       = "cloudtrain-lab-orchestrator"
)

// ErrConflict: an object with a session network name exists but belongs to
// something else. It is never adopted or deleted.
var ErrConflict = errors.New("network object name conflict")

// Manager creates and deletes session networks. It needs RBAC for
// kubeovn.io vpcs/subnets and k8s.cni.cncf.io network-attachment-definitions.
type Manager struct {
	Client client.Client
}


func labelValue(s string) string {
	if len(s) <= 63 {
		return s
	}
	return dnsName(s[:40], s)
}

func (m *Manager) labels(s Session, segment string) map[string]string {
	l := map[string]string{
		LabelSession:   labelValue(s.Name),
		LabelSessionNS: labelValue(s.Namespace),
		LabelManagedBy: ManagedBy,
	}
	if s.UID != "" {
		l[LabelSessionUID] = string(s.UID)
	}
	if segment != "" {
		l[LabelSegment] = segment
	}
	return l
}

func (m *Manager) owns(s Session, obj *unstructured.Unstructured) bool {
	got := obj.GetLabels()
	for k, v := range m.labels(s, "") {
		if got[k] != v {
			return false
		}
	}
	return true
}

// Objects renders every object of the plan, VPC first.
func (m *Manager) Objects(p *Plan) []*unstructured.Unstructured {
	s := p.Session
	var out []*unstructured.Unstructured
	vpc := newObj(VpcGVK, "", p.VPC, m.labels(s, "vpc"))
	vpc.Object["spec"] = map[string]any{}
	out = append(out, vpc, m.subnet(p, p.Mgmt, "mgmt", nil))
	for i := range p.Links {
		l := &p.Links[i]
		out = append(out, m.subnet(p, l.Segment, l.ID, l.Impair))
		nad := newObj(NADGVK, s.Namespace, l.Segment.NAD, m.labels(s, l.ID))
		nad.Object["spec"] = map[string]any{
			"config": fmt.Sprintf(`{"cniVersion":"0.3.1","type":"kube-ovn","server_socket":"/run/openvswitch/kube-ovn-daemon.sock","provider":%q}`, l.Segment.Provider),
		}
		out = append(out, nad)
	}
	return out
}

func (m *Manager) subnet(p *Plan, seg Segment, id string, _ *labsv1.LinkImpairment) *unstructured.Unstructured {
	o := newObj(SubnetGVK, "", seg.Subnet, m.labels(p.Session, id))
	spec := map[string]any{
		"vpc":        p.VPC,
		"protocol":   "IPv4",
		"cidrBlock":  seg.CIDR.String(),
		"gateway":    seg.Gateway.String(),
		"excludeIps": []any{seg.Gateway.String()},
		"namespaces": []any{p.Session.Namespace},
	}
	if seg.Provider != "" {
		spec["provider"] = seg.Provider
	}
	o.Object["spec"] = spec
	return o
}

func newObj(gvk schema.GroupVersionKind, ns, name string, labels map[string]string) *unstructured.Unstructured {
	o := &unstructured.Unstructured{Object: map[string]any{}}
	o.SetGroupVersionKind(gvk)
	o.SetName(name)
	o.SetNamespace(ns)
	o.SetLabels(labels)
	return o
}

// Ensure creates the session network (idempotent) and reports whether every
// segment is Ready. A plan that needs no network is ready at once.
func (m *Manager) Ensure(ctx context.Context, p *Plan) (bool, error) {
	if !p.Needed() {
		return true, nil
	}
	ready := true
	for _, want := range m.Objects(p) {
		got := &unstructured.Unstructured{}
		got.SetGroupVersionKind(want.GroupVersionKind())
		err := m.Client.Get(ctx, client.ObjectKeyFromObject(want), got)
		switch {
		case apierrors.IsNotFound(err):
			if err := m.Client.Create(ctx, want); err != nil && !apierrors.IsAlreadyExists(err) {
				return false, fmt.Errorf("create %s %s: %w", want.GetKind(), want.GetName(), err)
			}
			ready = false
			continue
		case err != nil:
			return false, err
		}
		if !m.owns(p.Session, got) {
			return false, fmt.Errorf("%s %s exists but does not belong to session %s/%s: %w",
				got.GetKind(), got.GetName(), p.Session.Namespace, p.Session.Name, ErrConflict)
		}
		if got.GetKind() == SubnetGVK.Kind && !subnetReady(got) {
			ready = false
		}
	}
	return ready, nil
}

func subnetReady(o *unstructured.Unstructured) bool {
	conds, _, _ := unstructured.NestedSlice(o.Object, "status", "conditions")
	var cs []metav1.Condition
	for _, c := range conds {
		cm, ok := c.(map[string]any)
		if !ok {
			continue
		}
		t, _ := cm["type"].(string)
		st, _ := cm["status"].(string)
		cs = append(cs, metav1.Condition{Type: t, Status: metav1.ConditionStatus(st)})
	}
	return meta.IsStatusConditionTrue(cs, "Ready")
}

// Delete removes every network object of the session (NADs, link subnets,
// management subnet, VPC, in that order). It is safe to call for sessions
// that never had a network. It finds objects by label, so it works without
// the topology, and only deletes objects carrying the session's labels.
// It returns done=false while objects are still terminating.
func (m *Manager) Delete(ctx context.Context, s Session) (bool, error) {
	sel := client.MatchingLabels(m.labels(s, ""))
	done := true
	for _, step := range []struct {
		gvk schema.GroupVersionKind
		ns  string
	}{{NADGVK, s.Namespace}, {SubnetGVK, ""}, {VpcGVK, ""}} {
		list := &unstructured.UnstructuredList{}
		list.SetGroupVersionKind(step.gvk.GroupVersion().WithKind(step.gvk.Kind + "List"))
		opts := []client.ListOption{sel}
		if step.ns != "" {
			opts = append(opts, client.InNamespace(step.ns))
		}
		if err := m.Client.List(ctx, list, opts...); err != nil {
			if meta.IsNoMatchError(err) {
				continue // Kube-OVN / Multus not installed: nothing to delete
			}
			return false, err
		}
		items := list.Items
		sort.Slice(items, func(i, j int) bool { return items[i].GetName() < items[j].GetName() })
		for i := range items {
			done = false
			if items[i].GetDeletionTimestamp() != nil {
				continue
			}
			uid := items[i].GetUID()
			if err := m.Client.Delete(ctx, &items[i], client.Preconditions{UID: &uid}); client.IgnoreNotFound(err) != nil {
				return false, err
			}
		}
		if !done {
			// Subnets must be gone before the VPC, NADs before their subnets.
			return false, nil
		}
	}
	return done, nil
}
