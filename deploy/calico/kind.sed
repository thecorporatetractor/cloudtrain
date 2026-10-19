# Edits applied to upstream calico-vxlan.yaml for KIND_PROFILE=managed-cni-calico
# (deploy/scripts/dev-up.sh; @POD_CIDR@ = KIND_POD_CIDR). Same edits as the golden image
# (tools/images/build.sh): the IPv4 pool is the cluster podSubnet instead of the default
# 192.168.0.0/16, which overlaps the lab ranges, and VXLAN is Always so pod traffic is always
# encapsulated. veth_mtu stays "0" (auto: node MTU minus 50 for VXLAN); lab interfaces get
# their 1400 from Kube-OVN's Subnet.spec.mtu (--lab-mtu), not from Calico.
s|^            # - name: CALICO_IPV4POOL_CIDR|            - name: CALICO_IPV4POOL_CIDR|
s|^            #   value: "192.168.0.0/16"|              value: "@POD_CIDR@"|
/name: CALICO_IPV4POOL_VXLAN$/{n;s|value: "CrossSubnet"|value: "Always"|}
