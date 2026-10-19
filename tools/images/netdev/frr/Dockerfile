# cloudtrain/frr:10 - FRRouting 10 as a lab network device (driver: netdev).
# Built by tools/images/netdev/build.sh. Upstream pinned by digest; Alpine
# packages unpinned (Alpine drops superseded releases, so exact pins break rebuilds).
FROM quay.io/frrouting/frr:10.7.1@sha256:e995beaa50fdc9edb35eadcfefa29b7f062cc06f2b812613789b68fa541554d2
# The upstream base lags Alpine security fixes: upgrade everything it ships to the
# branch's current releases (OpenSSL, Python; images.yml gates on fixable CRITICALs).
# openssh-server, sudo, shadow (useradd) and python3 (in the base) are for network-automation
# labs: their setup creates the automation account and starts sshd; nothing starts it by
# default, so routing labs see the same router (no sshd, no extra account).
RUN apk upgrade --no-cache \
 && apk add --no-cache tcpdump iperf3 openssh-server sudo shadow \
 && for c in python3 sshd sudo useradd chpasswd ssh-keygen; do command -v "$c" >/dev/null || { echo "missing $c" >&2; exit 1; }; done \
 && rm -f /etc/ssh/ssh_host_*
COPY daemons vtysh.conf frr.conf /etc/frr/
RUN chown frr:frr /etc/frr/frr.conf /etc/frr/vtysh.conf && chmod 0640 /etc/frr/frr.conf \
 && printf 'cloudtrain/frr:10 frr=10.7.1\n' > /etc/cloudtrain-release
# The upstream entrypoint (tini + docker-start) runs watchfrr with the daemons
# enabled in /etc/frr/daemons. vtysh talks to them over /var/run/frr.
