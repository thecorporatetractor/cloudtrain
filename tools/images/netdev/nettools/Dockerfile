# cloudtrain/nettools:1 - small Linux host for network labs (driver: container)
# and the platform's link sidecar (capture, impairment). Built by
# tools/images/netdev/build.sh; base pinned by digest; packages come from that Alpine branch
# (unpinned: Alpine drops superseded releases, so exact pins break rebuilds).
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
RUN apk add --no-cache \
      bash iproute2 iputils-ping traceroute \
      tcpdump iperf3 ethtool \
 && adduser -D -u 1000 -s /bin/bash learner \
 && printf 'cloudtrain/nettools:1\n' > /etc/cloudtrain-release
CMD ["sleep", "infinity"]
