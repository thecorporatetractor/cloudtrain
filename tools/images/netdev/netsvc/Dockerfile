# cloudtrain/netsvc:1 - Linux services host and Linux router/firewall/switch for
# network labs (driver: container): DHCP (dnsmasq, Kea), DNS (BIND, dig), NTP
# (chrony), syslog (rsyslog), SNMP (net-snmp), SSH, nftables/iptables, WireGuard,
# strongSwan, Linux bridge/bond/VLAN tooling, tc, python3 with Jinja2/PyYAML.
# No daemon starts by itself: labs start what they need from setup actions.
# No SSH host keys are baked in (a published image would share them): a lab that
# starts sshd runs `ssh-keygen -A` first, like the other lab images.
# Built by tools/images/netdev/build.sh; base pinned by digest; packages come from that Alpine branch
# (unpinned: Alpine drops superseded releases, so exact pins break rebuilds).
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache \
      bash iproute2 iputils-ping traceroute \
      tcpdump iperf3 ethtool mtr \
      nftables iptables bridge-utils \
      wireguard-tools strongswan \
      dnsmasq kea-dhcp4 dhcpcd \
      bind bind-tools chrony rsyslog \
      net-snmp net-snmp-tools \
      openssh-server openssh-client-default \
      curl socat nmap nmap-ncat busybox-extras \
      python3 py3-jinja2 py3-yaml jq vim nano \
 && adduser -D -u 1000 -s /bin/bash learner \
 && printf 'cloudtrain/netsvc:1\n' > /etc/cloudtrain-release
CMD ["sleep", "infinity"]
