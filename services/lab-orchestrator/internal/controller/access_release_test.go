package controller

import (
	"context"
	"testing"

	"sigs.k8s.io/controller-runtime/pkg/client"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// staleSessionReader serves its first LabSession list from a snapshot: the
// view of a reconcile that ran while a peer session still held its cleanup
// finalizer.
type staleSessionReader struct {
	client.Reader
	stale *labsv1.LabSessionList
}

func (r *staleSessionReader) List(ctx context.Context, list client.ObjectList, opts ...client.ListOption) error {
	if l, ok := list.(*labsv1.LabSessionList); ok && r.stale != nil {
		r.stale.DeepCopyInto(l)
		r.stale = nil
		return nil
	}
	return r.Reader.List(ctx, list, opts...)
}

// Two sessions of one namespace torn down at the same time each see the
// other still holding the cleanup finalizer before dropping their own. The
// last one must still release the session binding, or the namespace stays
// Terminating on its finalizer (seen live: sim-linux-pro attempt namespaces).
func TestConcurrentTeardownReleasesSessionAccess(t *testing.T) {
	h := newHarness(t, template(), session())
	acc := &heldAccess{}
	h.r.Access = acc
	h.reconcile()
	if !acc.held {
		t.Fatal("the session did not hold the binding")
	}
	peer := h.get().DeepCopy()
	peer.Name = "s2"
	stale := &labsv1.LabSessionList{Items: []labsv1.LabSession{*h.get(), *peer}}
	h.r.Reader = &staleSessionReader{Reader: h.c, stale: stale}
	if err := h.c.Delete(context.Background(), h.get()); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if acc.held {
		t.Error("the last session torn down left the session binding held")
	}
}

// A deleted session that already dropped the cleanup finalizer (a cached
// copy reconciled once more, or one kept by another finalizer) must not hold
// the session binding again: nothing would release it.
func TestDeletedSessionWithoutFinalizerDoesNotHoldAccess(t *testing.T) {
	s := session()
	s.Finalizers = []string{"example.com/other"}
	h := newHarness(t, template(), s)
	acc := &heldAccess{}
	h.r.Access = acc
	if err := h.c.Delete(context.Background(), h.get()); err != nil {
		t.Fatal(err)
	}
	h.reconcile()
	if acc.held || acc.ensureHeld != 0 {
		t.Errorf("held %v after %d EnsureHeld calls", acc.held, acc.ensureHeld)
	}
}
