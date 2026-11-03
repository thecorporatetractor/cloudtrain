package controller

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/go-logr/logr"
	"github.com/prometheus/client_golang/prometheus"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/metrics"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

const (
	// DefaultOrphanSweep is how often cluster-scoped session objects are
	// checked for a missing session.
	DefaultOrphanSweep = 10 * time.Minute
	// orphanMinAge: younger objects are never swept (a session and its
	// objects are being created right now).
	orphanMinAge = 10 * time.Minute

	// labelPreflight marks objects of labctl preflight (never swept).
	labelPreflight = "labs.cloudtrain.dev/preflight"
	// preflightUIDPrefix: the fake session UIDs of labctl preflight.
	preflightUIDPrefix = "preflight"
)

// Cluster-scoped objects the orchestrator creates per session. Namespaced
// session objects carry an owner reference to their LabSession and are
// garbage-collected by Kubernetes; these cannot be, and are deleted only by
// the session's finalizer. A removed finalizer, a manager reinstall or an
// etcd restore leaves them behind with addresses, OVN state or a whole
// vcluster in them.
//
// The manager may not list namespaces: vcluster host namespaces are found
// through their control-plane pods and services (both are listed
// cluster-wide already) and read one by one. The service outlives a
// hibernated control plane (scaled to zero, no pod), so such a namespace,
// whose PVC still holds storage, is found too.
//
// labctl preflight creates networks for fake sessions (UID "preflight-*",
// label labs.cloudtrain.dev/preflight): they are never swept, a probe may
// run longer than orphanMinAge and cleans up after itself.

// OrphanSweeper periodically deletes cluster-scoped session objects (vcluster
// host namespaces, Kube-OVN VPCs and subnets) whose LabSession no longer
// exists. It runs on the leader only.
type OrphanSweeper struct {
	Client client.Client
	// Reader lists uncached (mgr.GetAPIReader()): every LabSession of every
	// manager counts, not only those this manager's cache selects.
	Reader   client.Reader
	Interval time.Duration
	Log      logr.Logger
	Now      func() time.Time

	deleted *prometheus.CounterVec
}

// orphanKinds are the cluster-scoped kinds swept, deleted in this order
// (subnets before their VPC).
var orphanKinds = []struct {
	kind string
	list func() client.ObjectList
}{
	{"Subnet", func() client.ObjectList {
		l := &unstructured.UnstructuredList{}
		l.SetGroupVersionKind(drivers.GVKSubnet.GroupVersion().WithKind("SubnetList"))
		return l
	}},
	{"Vpc", func() client.ObjectList {
		l := &unstructured.UnstructuredList{}
		l.SetGroupVersionKind(drivers.GVKVpc.GroupVersion().WithKind("VpcList"))
		return l
	}},
}

// NewOrphanSweeper creates the sweeper and registers its metric.
func NewOrphanSweeper(c client.Client, r client.Reader, interval time.Duration, log logr.Logger) *OrphanSweeper {
	s := &OrphanSweeper{Client: c, Reader: r, Interval: interval, Log: log,
		deleted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "cloudtrain_orphaned_session_objects_deleted_total",
			Help: "Cluster-scoped lab session objects (vcluster namespaces, Kube-OVN VPCs and subnets) deleted because their LabSession was gone.",
		}, []string{"kind"}),
	}
	metrics.Registry.MustRegister(s.deleted)
	return s
}

// NeedLeaderElection: only the leader sweeps.
func (s *OrphanSweeper) NeedLeaderElection() bool { return true }

// Start runs the sweep every Interval until ctx ends.
func (s *OrphanSweeper) Start(ctx context.Context) error {
	if s.Interval <= 0 {
		return nil
	}
	t := time.NewTicker(s.Interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			if n, err := s.Sweep(ctx); err != nil {
				s.Log.Error(err, "orphan sweep failed", "deleted", n)
			} else if n > 0 {
				s.Log.Info("orphaned session objects deleted", "deleted", n)
			}
		}
	}
}

// vclusterNamespaces returns the vcluster host namespaces (ct-vc-*) that
// still hold a vcluster pod or service and carry the orchestrator's session
// labels.
func (s *OrphanSweeper) vclusterNamespaces(ctx context.Context) ([]client.Object, error) {
	sel := client.MatchingLabels{"app": "vcluster"}
	pods := &corev1.PodList{}
	if err := s.Reader.List(ctx, pods, sel); err != nil {
		return nil, err
	}
	svcs := &corev1.ServiceList{}
	if err := s.Reader.List(ctx, svcs, sel); err != nil {
		return nil, err
	}
	var names []string
	for _, p := range pods.Items {
		names = append(names, p.Namespace)
	}
	for _, sv := range svcs.Items {
		names = append(names, sv.Namespace)
	}
	seen := map[string]bool{}
	var out []client.Object
	for _, name := range names {
		if seen[name] || !strings.HasPrefix(name, "ct-vc-") {
			continue
		}
		seen[name] = true
		ns := &corev1.Namespace{}
		if err := s.Reader.Get(ctx, client.ObjectKey{Name: name}, ns); err != nil {
			if apierrors.IsNotFound(err) {
				continue
			}
			return nil, err
		}
		if l := ns.Labels; l[drivers.LabelManagedBy] == drivers.ManagedBy && l[drivers.LabelSessionUID] != "" {
			out = append(out, ns)
		}
	}
	return out, nil
}

// preflightObject reports an object of labctl preflight.
func preflightObject(o client.Object) bool {
	return o.GetLabels()[labelPreflight] == "true" ||
		strings.HasPrefix(o.GetLabels()[drivers.LabelSessionUID], preflightUIDPrefix)
}

func (s *OrphanSweeper) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Sweep deletes every cluster-scoped session object older than
// orphanMinAge whose session UID matches no LabSession. Objects are listed
// before the sessions, so an object's session, if it exists, is in the
// session list.
func (s *OrphanSweeper) Sweep(ctx context.Context) (int, error) {
	sel := client.MatchingLabels{drivers.LabelManagedBy: drivers.ManagedBy}
	type candidate struct {
		kind string
		obj  client.Object
	}
	var found []candidate
	nss, err := s.vclusterNamespaces(ctx)
	if err != nil {
		return 0, err
	}
	for _, ns := range nss {
		found = append(found, candidate{"Namespace", ns})
	}
	for _, k := range orphanKinds {
		list := k.list()
		if err := s.Reader.List(ctx, list, sel, client.HasLabels{drivers.LabelSessionUID}); err != nil {
			if meta.IsNoMatchError(err) || apierrors.IsNotFound(err) {
				continue // Kube-OVN not installed
			}
			return 0, err
		}
		_ = meta.EachListItem(list, func(o runtime.Object) error {
			if obj, ok := o.(client.Object); ok {
				found = append(found, candidate{k.kind, obj})
			}
			return nil
		})
	}
	if len(found) == 0 {
		return 0, nil
	}
	sessions := &labsv1.LabSessionList{}
	if err := s.Reader.List(ctx, sessions); err != nil {
		return 0, err
	}
	live := make(map[types.UID]bool, len(sessions.Items))
	for i := range sessions.Items {
		live[sessions.Items[i].UID] = true
	}
	n := 0
	var errs error
	for _, c := range found {
		uid := types.UID(c.obj.GetLabels()[drivers.LabelSessionUID])
		if uid == "" || live[uid] || c.obj.GetDeletionTimestamp() != nil || preflightObject(c.obj) ||
			s.now().Sub(c.obj.GetCreationTimestamp().Time) < orphanMinAge {
			continue
		}
		u := c.obj.GetUID()
		err := s.Client.Delete(ctx, c.obj, client.Preconditions{UID: &u},
			client.PropagationPolicy(metav1.DeletePropagationBackground))
		if err != nil && !apierrors.IsNotFound(err) {
			errs = errors.Join(errs, err)
			continue
		}
		n++
		s.deleted.WithLabelValues(c.kind).Inc()
		s.Log.Info("deleted orphaned session object", "kind", c.kind, "name", c.obj.GetName(),
			"session", c.obj.GetLabels()[drivers.LabelSession], "sessionUID", uid)
	}
	return n, errs
}
