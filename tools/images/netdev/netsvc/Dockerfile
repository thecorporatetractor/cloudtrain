# cloudtrain/netsvc:1 - Linux services host and Linux router/firewall/switch for
# network labs (driver: container): DHCP (dnsmasq, Kea), DNS (BIND, dig), NTP
# (chrony), syslog (rsyslog), SNMP (net-snmp), SSH, nftables/iptables, WireGuard,
# strongSwan, Linux bridge/bond/VLAN tooling, tc, python3 with Jinja2/PyYAML.
# No daemon starts by itself: labs start what they need from setup actions.
# No SSH host keys are baked in (a published image would share them): a lab that
# starts sshd runs `ssh-keygen -A` first, like the other lab images.
# Built by tools/images/netdev/build.sh; base pinned by digest, packages to exact versions.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
RUN apk add --no-cache \
      bash=5.2.37-r0 iproute2=6.15.0-r0 iputils-ping=20240905-r0 traceroute=2.1.6-r0 \
      tcpdump=4.99.5-r1 iperf3=3.19.1-r0 ethtool=6.14.1-r0 mtr=0.96-r0 \
      nftables=1.1.3-r0 iptables=1.8.11-r1 bridge-utils=1.7.1-r2 \
      wireguard-tools=1.0.20250521-r0 strongswan=5.9.14-r1 \
      dnsmasq=2.91-r1 kea-dhcp4=2.6.5-r0 dhcpcd=10.2.3-r0 \
      bind=9.20.29-r0 bind-tools=9.20.29-r0 chrony=4.6.1-r1 rsyslog=8.2410.0-r1 \
      net-snmp=5.9.4-r1 net-snmp-tools=5.9.4-r1 \
      openssh-server=10.0_p1-r10 openssh-client-default=10.0_p1-r10 \
      curl=8.14.1-r3 socat=1.8.1.3-r0 nmap=7.97-r0 nmap-ncat=7.97-r0 busybox-extras=1.37.0-r20 \
      python3=3.12.15-r0 py3-jinja2=3.1.6-r0 py3-yaml=6.0.2-r0 jq=1.8.2-r0 vim=9.1.1566-r0 nano=8.4-r0 \
 && adduser -D -u 1000 -s /bin/bash learner \
 && printf 'cloudtrain/netsvc:1\n' > /etc/cloudtrain-release
CMD ["sleep", "infinity"]
