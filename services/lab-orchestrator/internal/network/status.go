package network

import (
	"fmt"
	"strconv"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// LinkStatuses are the link facts published in LabSession status.links.
func (p *Plan) LinkStatuses() []labsv1.LinkStatus {
	out := make([]labsv1.LinkStatus, 0, len(p.Links))
	for _, l := range p.Links {
		ls := labsv1.LinkStatus{
			ID:      l.ID,
			Segment: l.Segment.Subnet,
			Network: p.Session.Namespace + "/" + l.Segment.NAD,
			Impair:  l.Impair.DeepCopy(),
		}
		if l.Subnet.IsValid() {
			ls.Subnet = l.Subnet.String()
		}
		for _, e := range l.Ends {
			es := labsv1.LinkEndStatus{Node: e.Node, Interface: e.Interface, AddressMode: string(e.Mode)}
			if e.Mode == AddressPlatform {
				es.Address = e.Address.String()
			}
			ls.Ends = append(ls.Ends, es)
		}
		out = append(out, ls)
	}
	return out
}

// CaptureOptions for a packet capture on a link end.
type CaptureOptions struct {
	// Filter is a tcpdump (BPF) filter expression, e.g. "proto ospf".
	Filter string
	// Count stops after this many packets (0 = until the exec is cancelled).
	Count int
	// Pcap writes a pcap stream to stdout instead of decoded text lines.
	Pcap bool
}

// CaptureCommand is the argv that captures on a link interface. It runs in
// the link sidecar (container SidecarName) of the end's pod, so it works
// whatever the node image ships; the access gateway streams its stdout.
func CaptureCommand(iface string, o CaptureOptions) []string {
	cmd := []string{"tcpdump", "-i", iface, "-n", "-U"}
	if o.Pcap {
		cmd = append(cmd, "-w", "-")
	} else {
		cmd = append(cmd, "-l", "-e")
	}
	if o.Count > 0 {
		cmd = append(cmd, "-c", strconv.Itoa(o.Count))
	}
	if o.Filter != "" {
		cmd = append(cmd, o.Filter)
	}
	return cmd
}

// ImpairCommand re-applies (or with im == nil clears) netem on a link end at
// runtime, e.g. for an instructor changing conditions mid-lab. Runs in the
// sidecar.
func ImpairCommand(iface string, im *labsv1.LinkImpairment) []string {
	if q := NetemArgs(im); q != "" {
		return []string{"/bin/sh", "-c", fmt.Sprintf("tc qdisc replace dev %s root netem %s", iface, q)}
	}
	return []string{"/bin/sh", "-c", fmt.Sprintf("tc qdisc del dev %s root 2>/dev/null || true", iface)}
}
