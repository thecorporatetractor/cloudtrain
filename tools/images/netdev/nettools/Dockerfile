# cloudtrain/nettools:1 - small Linux host for network labs (driver: container)
# and the platform's link sidecar (capture, impairment). Built by
# tools/images/netdev/build.sh; base pinned by digest; packages come from that Alpine branch
# (unpinned: Alpine drops superseded releases, so exact pins break rebuilds).
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
RUN apk add --no-cache \
      bash iproute2 iputils-ping traceroute \
      tcpdump iperf3 ethtool \
 && adduser -D -u 1000 -s /bin/bash learner \
 && printf 'cloudtrain/nettools:1\n' > /etc/cloudtrain-release
CMD ["sleep", "infinity"]
