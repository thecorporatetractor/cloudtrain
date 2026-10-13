package controller

import (
	"testing"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/drivers"
)

// linkDriver is a topology provisioner that also reports links.
type linkDriver struct{ *topoDriver }

func (d *linkDriver) Links(drivers.SessionRef) ([]labsv1.LinkStatus, error) {
	return []labsv1.LinkStatus{{ID: "link-0", Segment: "seg", Network: "ns/nad",
		Ends: []labsv1.LinkEndStatus{{Node: "edge-1", Interface: "eth1", AddressMode: "lab"}}}}, nil
}

func TestLinksPublishedInStatus(t *testing.T) {
	h := newHarness(t, template(), session())
	ld := &linkDriver{&topoDriver{fakeDriver: h.netdev}}
	reg, err := drivers.NewRegistry(h.cont, ld)
	if err != nil {
		t.Fatal(err)
	}
	h.r.Drivers = reg
	h.reconcile()
	got := h.get().Status.Links
	if len(got) != 1 || got[0].Segment != "seg" || got[0].Ends[0].Interface != "eth1" {
		t.Errorf("status.links = %+v", got)
	}
}
