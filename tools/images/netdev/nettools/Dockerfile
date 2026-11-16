# cloudtrain/nettools:1 - small Linux host for network labs (driver: container)
# and the platform's link sidecar (capture, impairment). Built by
# tools/images/netdev/build.sh; base pinned by digest; packages come from that Alpine branch
# (unpinned: Alpine drops superseded releases, so exact pins break rebuilds).
FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
RUN apk add --no-cache \
      bash iproute2 iputils-ping traceroute \
      tcpdump iperf3 ethtool \
 && adduser -D -u 1000 -s /bin/bash learner \
 && printf 'cloudtrain/nettools:1\n' > /etc/cloudtrain-release
CMD ["sleep", "infinity"]
