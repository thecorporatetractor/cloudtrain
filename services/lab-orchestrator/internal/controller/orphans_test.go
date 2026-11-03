package controller

import (
	"context"
	"testing"
	"time"

	"github.com/go-logr/logr"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

func sessionObjLabels(uid string) map[string]string {
	l := map[string]string{drivers.LabelManagedBy: drivers.ManagedBy, drivers.LabelSession: "s"}
	if uid != "" {
		l[drivers.LabelSessionUID] = uid
	}
	return l
}

func clusterObj(gvk schema.GroupVersionKind, name, uid string, created time.Time) *unstructured.Unstructured {
	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(gvk)
	u.SetName(name)
	u.SetLabels(sessionObjLabels(uid))
	u.SetCreationTimestamp(metav1.NewTime(created))
	return u
}

func TestOrphanSweeperDeletesObjectsOfMissingSessions(t *testing.T) {
	now := t0.Add(time.Hour)
	old := t0
	live := session(func(s *labsv1.LabSession) { s.UID = "live-uid" })
	objs := []client.Object{
		live,
		// Orphans: their session is gone.
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ct-vc-gone", Labels: sessionObjLabels("gone-uid"), CreationTimestamp: metav1.NewTime(old)}},
		clusterObj(drivers.GVKSubnet, "lab-gone", "gone-uid", old),
		clusterObj(drivers.GVKVpc, "vpc-gone", "gone-uid", old),
		// A hibernated vcluster (control plane scaled to zero): no pod, only
		// its service; its PVC still holds storage.
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ct-vc-hibernated", Labels: sessionObjLabels("gone2-uid"), CreationTimestamp: metav1.NewTime(old)}},
		// Kept: the session exists.
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ct-vc-live", Labels: sessionObjLabels("live-uid"), CreationTimestamp: metav1.NewTime(old)}},
		clusterObj(drivers.GVKVpc, "vpc-live", "live-uid", old),
		// Kept: too young (its session may be being created).
		clusterObj(drivers.GVKSubnet, "lab-young", "other-uid", now.Add(-time.Minute)),
		// Kept: not a session object (no session UID).
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "cloudtrain-sessions", Labels: sessionObjLabels(""), CreationTimestamp: metav1.NewTime(old)}},
		// Kept: not ours.
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "team-x", Labels: map[string]string{drivers.LabelSessionUID: "gone-uid"}, CreationTimestamp: metav1.NewTime(old)}},
		// Kept: labctl preflight networks (fake session UIDs), even when a
		// probe runs longer than the minimum age.
		clusterObj(drivers.GVKVpc, "vpc-preflight", "preflight-ab12cd", old),
		clusterObj(drivers.GVKSubnet, "lab-preflight", "preflight-sb-ab12cd", old),
		// Kept: an Expired session being collected after its retention
		// (deleted, its finalizer still running teardown) still counts as
		// live, so the sweep never races the finalizer over its objects.
		session(func(s *labsv1.LabSession) {
			s.Name, s.UID = "s-collect", "collect-uid"
			s.Finalizers = []string{Finalizer}
			s.DeletionTimestamp = &metav1.Time{Time: now.Add(-time.Minute)}
			s.Status.Phase = labsv1.SessionExpired
		}),
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ct-vc-collect", Labels: sessionObjLabels("collect-uid"), CreationTimestamp: metav1.NewTime(old)}},
		clusterObj(drivers.GVKVpc, "vpc-collect", "collect-uid", old),
	}
	sch := scheme(t)
	for _, gvk := range []schema.GroupVersionKind{drivers.GVKSubnet, drivers.GVKVpc} {
		sch.AddKnownTypeWithName(gvk, &unstructured.Unstructured{})
		sch.AddKnownTypeWithName(gvk.GroupVersion().WithKind(gvk.Kind+"List"), &unstructured.UnstructuredList{})
	}
	rm := meta.NewDefaultRESTMapper(nil)
	rm.Add(corev1.SchemeGroupVersion.WithKind("Namespace"), meta.RESTScopeRoot)
	rm.Add(corev1.SchemeGroupVersion.WithKind("Pod"), meta.RESTScopeNamespace)
	rm.Add(corev1.SchemeGroupVersion.WithKind("Service"), meta.RESTScopeNamespace)
	rm.Add(drivers.GVKSubnet, meta.RESTScopeRoot)
	rm.Add(drivers.GVKVpc, meta.RESTScopeRoot)
	rm.Add(labsv1.GroupVersion.WithKind("LabSession"), meta.RESTScopeNamespace)
	// vcluster host namespaces are found through their control-plane pods
	// and services.
	var pods []client.Object
	for _, ns := range []string{"ct-vc-gone", "ct-vc-live", "team-x", "ct-vc-collect"} {
		pods = append(pods, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "vc-0", Namespace: ns, Labels: map[string]string{"app": "vcluster"}}})
	}
	for _, ns := range []string{"ct-vc-gone", "ct-vc-hibernated", "ct-vc-live"} {
		pods = append(pods, &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "vc", Namespace: ns, Labels: map[string]string{"app": "vcluster"}}})
	}
	c := fake.NewClientBuilder().WithScheme(sch).WithRESTMapper(rm).WithObjects(append(objs, pods...)...).Build()

	s := &OrphanSweeper{Client: c, Reader: c, Log: logr.Discard(), Now: func() time.Time { return now },
		deleted: prometheus.NewCounterVec(prometheus.CounterOpts{Name: "t"}, []string{"kind"})}
	n, err := s.Sweep(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Errorf("deleted %d, want 4", n)
	}
	gone := func(obj client.Object) bool {
		return apierrors.IsNotFound(c.Get(context.Background(), client.ObjectKeyFromObject(obj), obj))
	}
	for _, o := range objs[1:5] {
		if !gone(o) {
			t.Errorf("orphan %s %s not deleted", o.GetObjectKind().GroupVersionKind().Kind, o.GetName())
		}
	}
	for _, o := range objs[5:] {
		if gone(o) {
			t.Errorf("%s %s deleted, want kept", o.GetObjectKind().GroupVersionKind().Kind, o.GetName())
		}
	}
	if got := testutil.ToFloat64(s.deleted.WithLabelValues("Namespace")); got != 2 {
		t.Errorf("Namespace counter = %v", got)
	}
}
