# cloudtrain/nettools:1 - small Linux host for network labs (driver: container)
# and the platform's link sidecar (capture, impairment). Built by
# tools/images/netdev/build.sh; base pinned by digest, packages to exact versions.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
RUN apk add --no-cache \
      bash=5.2.37-r0 iproute2=6.15.0-r0 iputils-ping=20240905-r0 traceroute=2.1.6-r0 \
      tcpdump=4.99.5-r1 iperf3=3.19.1-r0 ethtool=6.14.1-r0 \
 && adduser -D -u 1000 -s /bin/bash learner \
 && printf 'cloudtrain/nettools:1\n' > /etc/cloudtrain-release
CMD ["sleep", "infinity"]
