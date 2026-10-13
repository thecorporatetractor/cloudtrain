# cloudtrain/frr:10 - FRRouting 10 as a lab network device (driver: netdev).
# Built by tools/images/netdev/build.sh. Upstream pinned by digest; Alpine
# packages pinned to exact versions.
FROM quay.io/frrouting/frr:10.7.1@sha256:e995beaa50fdc9edb35eadcfefa29b7f062cc06f2b812613789b68fa541554d2
RUN apk add --no-cache tcpdump=4.99.5-r1 iperf3=3.19.1-r0
COPY daemons vtysh.conf frr.conf /etc/frr/
RUN chown frr:frr /etc/frr/frr.conf /etc/frr/vtysh.conf && chmod 0640 /etc/frr/frr.conf \
 && printf 'cloudtrain/frr:10 frr=10.7.1\n' > /etc/cloudtrain-release
# The upstream entrypoint (tini + docker-start) runs watchfrr with the daemons
# enabled in /etc/frr/daemons. vtysh talks to them over /var/run/frr.
