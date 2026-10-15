# cloudtrain/nettools:1 - small Linux host for network labs (driver: container)
# and the platform's link sidecar (capture, impairment). Built by
# tools/images/netdev/build.sh; base pinned by digest; packages come from that Alpine branch
# (unpinned: Alpine drops superseded releases, so exact pins break rebuilds).
FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache \
      bash iproute2 iputils-ping traceroute \
      tcpdump iperf3 ethtool \
 && adduser -D -u 1000 -s /bin/bash learner \
 && printf 'cloudtrain/nettools:1\n' > /etc/cloudtrain-release
CMD ["sleep", "infinity"]
