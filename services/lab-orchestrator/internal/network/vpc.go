package network

// SessionVPCSpec is the spec of every session VPC (link segments and the VM
// lab/access subnets). The VPC has no static routes, no external gateway and
// no NAT, so nothing in it routes out; as a second layer its logical router
// drops link-local (169.254.0.0/16: instance metadata) and the Azure
// wireserver (168.63.129.16) outright, so no future route or gateway on a
// secondary NIC can reach them (security review network-4). Kube-OVN Vpc
// spec.policyRoutes, action drop, at the highest priority.
func SessionVPCSpec() map[string]any {
	routes := []any{}
	for _, dst := range MetadataDenyCIDRs {
		routes = append(routes, map[string]any{
			"priority": int64(MetadataDenyPriority),
			"match":    "ip4.dst == " + dst,
			"action":   "drop",
		})
	}
	return map[string]any{"policyRoutes": routes}
}

// MetadataDenyCIDRs are the destinations every session VPC drops.
var MetadataDenyCIDRs = []string{"169.254.0.0/16", "168.63.129.16/32"}

// MetadataDenyPriority is above Kube-OVN's own policy routes (31000 and below).
const MetadataDenyPriority = 32000
