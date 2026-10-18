// Package network builds the per-session lab network on Kube-OVN + Multus:
// one isolated VPC per session, a management segment that carries the
// primary interface (eth0) of every node wired into the lab, and one L2
// segment per topology link (a Kube-OVN Subnet in the session VPC plus a
// Multus NetworkAttachmentDefinition).
//
// Planning (this file) is pure: Build turns a session and its resolved
// topology into a Plan with deterministic names and addresses. Manager
// (manager.go) creates and deletes the Kubernetes objects, and pod.go
// renders the pod-side wiring (Multus annotations, the net-init container
// that applies addresses, MTU and tc netem, and the link sidecar used for
// capture).
//
// Link segments are pure L2 wires for the lab. Kube-OVN requires every
// Subnet to have a CIDR, a gateway on the VPC router and an IP per port, so
// each link segment gets a small "carrier" CIDR from 198.18.0.0/16
// (RFC 2544 benchmarking space) that no lab address uses. net-init removes
// the carrier address from the pod interface before the node starts, so the
// VPC router never routes lab traffic: frames between the two ends are
// switched by the segment's logical switch and every L3 decision is made by
// the lab's own nodes (routers, hosts).
package network

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"strconv"
	"strings"

	"k8s.io/apimachinery/pkg/types"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Reserved address space. Labs must not use it for link subnets.
var (
	// CarrierPool holds one /28 per link (4096 links).
	CarrierPool = netip.MustParsePrefix("198.18.0.0/16")
	// MgmtCIDR is the management segment of every session VPC (eth0 of
	// routers and link hosts). VPCs are isolated, so every session reuses it.
	MgmtCIDR = netip.MustParsePrefix("198.19.255.0/24")
	// Reserved is everything above; link subnets overlapping it are rejected.
	Reserved = netip.MustParsePrefix("198.18.0.0/15")
)

const carrierBits = 28

// AddressMode says who configures the lab address of a link end.
type AddressMode string

const (
	// AddressPlatform: the platform assigns Address (host-only links with a subnet).
	AddressPlatform AddressMode = "platform"
	// AddressLab: the lab configures the end itself (device config or setup);
	// used on every end of a link that touches a netdev node.
	AddressLab AddressMode = "lab"
	// AddressNone: the link has no subnet; nothing is assigned.
	AddressNone AddressMode = "none"
)

// Session identifies the owning LabSession.
type Session struct {
	Namespace string
	Name      string
	UID       types.UID
}

// SessionOf returns the Session of a LabSession.
func SessionOf(s *labsv1.LabSession) Session {
	return Session{Namespace: s.Namespace, Name: s.Name, UID: s.UID}
}

// Segment is one Kube-OVN Subnet of the session VPC. Segments with a NAD
// are secondary networks (attached through Multus, provider
// "<nad>.<namespace>.ovn"); a segment without NAD is a primary network
// (selected with the ovn.kubernetes.io/logical_switch annotation).
type Segment struct {
	// Subnet is the cluster-scoped Kube-OVN Subnet (= logical switch) name.
	Subnet  string
	CIDR    netip.Prefix
	Gateway netip.Addr
	// NAD is the NetworkAttachmentDefinition name in the session namespace.
	NAD string
	// Provider is the Kube-OVN provider of a NAD segment.
	Provider string
}

// Attachment returns the Multus network-selection element for iface.
func (s Segment) Attachment(namespace, iface string) map[string]string {
	return map[string]string{"name": s.NAD, "namespace": namespace, "interface": iface}
}

// End is one end of a link.
type End struct {
	Node      string
	Interface string
	Driver    labsv1.DriverName
	Mode      AddressMode
	// Address (CIDR notation) when Mode is AddressPlatform.
	Address netip.Prefix
}

// LinkPlan is the plan for one topology link.
type LinkPlan struct {
	Index int
	// ID is "link-<index>", stable for the lab version.
	ID      string
	Segment Segment
	// Subnet is the lab subnet (may be invalid when the link has none).
	Subnet netip.Prefix
	Impair *labsv1.LinkImpairment
	Ends   [2]End
}

// Plan is the network of one session.
type Plan struct {
	Session Session
	// Options: network mode and segment MTU.
	Options Options
	VPC     string
	// Mgmt carries eth0 of wired nodes. In ModeSecondary it is a NAD segment
	// too (the pods' Multus default network).
	Mgmt  Segment
	Links []LinkPlan
	// Wired lists, sorted by topology order, the nodes that live on the
	// session network: netdev nodes and every node with a link end.
	Wired []string
}

// Needed reports whether the session needs a network at all.
func (p *Plan) Needed() bool { return len(p.Wired) > 0 }

// IsWired reports whether node lives on the session network.
func (p *Plan) IsWired(node string) bool {
	for _, n := range p.Wired {
		if n == node {
			return true
		}
	}
	return false
}

// NodeEnd is a link end as seen from its node.
type NodeEnd struct {
	Link *LinkPlan
	End  End
}

// EndsOf returns the link ends of node, in link order.
func (p *Plan) EndsOf(node string) []NodeEnd {
	var out []NodeEnd
	for i := range p.Links {
		l := &p.Links[i]
		for _, e := range l.Ends {
			if e.Node == node {
				out = append(out, NodeEnd{Link: l, End: e})
			}
		}
	}
	return out
}

// FindEnd returns the end "node:iface".
func (p *Plan) FindEnd(node, iface string) (NodeEnd, bool) {
	for _, ne := range p.EndsOf(node) {
		if ne.End.Interface == iface {
			return ne, true
		}
	}
	return NodeEnd{}, false
}

// ErrInvalid marks topologies the network cannot be built for; retrying
// cannot help.
var ErrInvalid = errors.New("invalid lab network")

// Build plans the network of a session from its resolved topology in
// ModePrimary with the CNI's default MTU.
func Build(s Session, topo *labsv1.Topology) (*Plan, error) {
	return BuildWith(s, topo, Options{Mode: ModePrimary})
}

// MgmtSegment is the management segment of a session in mode.
func MgmtSegment(s Session, mode Mode) Segment {
	seg := Segment{
		Subnet:  ClusterName(s, "mgmt"),
		CIDR:    MgmtCIDR,
		Gateway: MgmtCIDR.Addr().Next(),
	}
	if mode == ModeSecondary {
		seg.NAD = NamespacedName(s, "mgmt")
		seg.Provider = ProviderOf(seg.NAD, s.Namespace)
	}
	return seg
}

// BuildWith plans the network of a session from its resolved topology.
func BuildWith(s Session, topo *labsv1.Topology, o Options) (*Plan, error) {
	if o.Mode == "" {
		o.Mode = ModePrimary
	}
	p := &Plan{Session: s, Options: o, VPC: ClusterName(s, "vpc")}
	p.Mgmt = MgmtSegment(s, o.Mode)
	drv := map[string]labsv1.DriverName{}
	for _, n := range topo.Nodes {
		drv[n.Name] = n.Driver
	}
	wired := map[string]bool{}
	for _, n := range topo.Nodes {
		if n.Driver == labsv1.DriverNetdev {
			wired[n.Name] = true
		}
	}
	maxLinks := 1 << (carrierBits - CarrierPool.Bits())
	if len(topo.Links) > maxLinks {
		return nil, fmt.Errorf("%d links exceed the limit of %d: %w", len(topo.Links), maxLinks, ErrInvalid)
	}
	for i, l := range topo.Links {
		lp := LinkPlan{Index: i, ID: fmt.Sprintf("link-%d", i), Impair: l.Impair}
		for j, raw := range []string{l.A, l.B} {
			node, iface, ok := strings.Cut(raw, ":")
			if !ok || node == "" || iface == "" {
				return nil, fmt.Errorf("link %d end %q: want node:interface: %w", i, raw, ErrInvalid)
			}
			d, known := drv[node]
			if !known {
				return nil, fmt.Errorf("link %d: unknown node %q: %w", i, node, ErrInvalid)
			}
			if iface == "eth0" || len(iface) > 15 {
				return nil, fmt.Errorf("link %d: interface %q of %s is reserved or too long: %w", i, iface, node, ErrInvalid)
			}
			lp.Ends[j] = End{Node: node, Interface: iface, Driver: d, Mode: AddressNone}
			wired[node] = true
		}
		if l.Subnet != "" {
			pfx, err := netip.ParsePrefix(l.Subnet)
			if err != nil || !pfx.Addr().Is4() {
				return nil, fmt.Errorf("link %d: subnet %q is not an IPv4 prefix: %w", i, l.Subnet, ErrInvalid)
			}
			if pfx != pfx.Masked() {
				return nil, fmt.Errorf("link %d: subnet %q has host bits set: %w", i, l.Subnet, ErrInvalid)
			}
			if pfx.Overlaps(Reserved) {
				return nil, fmt.Errorf("link %d: subnet %s overlaps the platform range %s: %w", i, pfx, Reserved, ErrInvalid)
			}
			lp.Subnet = pfx
			if err := assignAddresses(&lp); err != nil {
				return nil, fmt.Errorf("link %d: %v: %w", i, err, ErrInvalid)
			}
		}
		if im := l.Impair; im != nil && im.LossPct != "" {
			if v, err := strconv.ParseFloat(im.LossPct, 64); err != nil || v < 0 || v > 100 {
				return nil, fmt.Errorf("link %d: lossPct %q out of range 0-100: %w", i, im.LossPct, ErrInvalid)
			}
		}
		if im := l.Impair; im != nil && im.LatencyMs != nil && (*im.LatencyMs < 0 || *im.LatencyMs > 10000) {
			return nil, fmt.Errorf("link %d: latencyMs %d out of range 0-10000: %w", i, *im.LatencyMs, ErrInvalid)
		}
		if im := l.Impair; im != nil && im.MTU != nil && (*im.MTU < 576 || *im.MTU > 9000) {
			return nil, fmt.Errorf("link %d: mtu %d out of range 576-9000: %w", i, *im.MTU, ErrInvalid)
		}
		lp.Segment = linkSegment(s, i)
		p.Links = append(p.Links, lp)
	}
	for _, n := range topo.Nodes {
		if wired[n.Name] {
			p.Wired = append(p.Wired, n.Name)
		}
	}
	return p, nil
}

// assignAddresses applies the addressing rule (see README "Lab network"):
// on a link with a subnet and no netdev end, the platform assigns end a the
// first and end b the second usable address; on a link touching a netdev
// node every end is left to the lab (device config, setup actions).
func assignAddresses(lp *LinkPlan) error {
	for _, e := range lp.Ends {
		if e.Driver == labsv1.DriverNetdev {
			lp.Ends[0].Mode, lp.Ends[1].Mode = AddressLab, AddressLab
			return nil
		}
	}
	bits := lp.Subnet.Bits()
	first := lp.Subnet.Addr()
	switch {
	case bits == 32:
		return fmt.Errorf("subnet %s has no room for two ends", lp.Subnet)
	case bits < 31:
		first = first.Next() // skip the network address
	}
	second := first.Next()
	for j, a := range []netip.Addr{first, second} {
		lp.Ends[j].Mode = AddressPlatform
		lp.Ends[j].Address = netip.PrefixFrom(a, bits)
	}
	return nil
}

func linkSegment(s Session, i int) Segment {
	base := CarrierPool.Addr().As4()
	off := uint32(i) << (32 - carrierBits)
	v := uint32(base[0])<<24 | uint32(base[1])<<16 | uint32(base[2])<<8 | uint32(base[3])
	v += off
	addr := netip.AddrFrom4([4]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)})
	nad := NamespacedName(s, fmt.Sprintf("link-%d", i))
	return Segment{
		Subnet:   ClusterName(s, fmt.Sprintf("link-%d", i)),
		CIDR:     netip.PrefixFrom(addr, carrierBits),
		Gateway:  addr.Next(),
		NAD:      nad,
		Provider: ProviderOf(nad, s.Namespace),
	}
}

// ClusterName is the name of a cluster-scoped object (Vpc, Subnet) of the
// session: "<namespace>-<session>-<suffix>-<hash>", at most 63 characters.
// The hash covers namespace, session, UID and suffix.
func ClusterName(s Session, suffix string) string {
	return dnsName(s.Namespace+"-"+s.Name+"-"+suffix, s.Namespace, s.Name, string(s.UID), suffix)
}

// NamespacedName is the name of a namespaced object (NAD) of the session.
func NamespacedName(s Session, suffix string) string {
	return dnsName(s.Name+"-"+suffix, s.Namespace, s.Name, string(s.UID), suffix)
}

func dnsName(base string, parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	h := "-" + hex.EncodeToString(sum[:])[:8]
	base = strings.ReplaceAll(strings.ToLower(base), ".", "-")
	if base == "" || base[0] < 'a' || base[0] > 'z' {
		base = "ct-" + base
	}
	if max := 63 - len(h); len(base) > max {
		base = base[:max]
	}
	return strings.TrimRight(base, "-") + h
}
