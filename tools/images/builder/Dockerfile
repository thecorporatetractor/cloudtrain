# Image-builder toolbox: libguestfs (virt-customize) + qemu-img.
# Runs with /dev/kvm passed through so the libguestfs appliance is accelerated.
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ENV DEBIAN_FRONTEND=noninteractive
# snapshot.ubuntu.com point in time (UBUNTU_APT_SNAPSHOT in deploy/versions.env).
ARG UBUNTU_APT_SNAPSHOT
# The base image has no CA bundle, so ca-certificates is bootstrapped from the
# live archive first (https to snapshot.ubuntu.com needs it); every other
# package then comes from the pinned snapshot.
RUN test -n "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any update --snapshot "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends --snapshot "$UBUNTU_APT_SNAPSHOT" \
      libguestfs-tools qemu-utils linux-image-generic guestfs-tools \
      curl xz-utils \
      dhcpcd-base isc-dhcp-client \
 && rm -rf /var/lib/apt/lists/*
# direct backend: no libvirtd needed inside the container
ENV LIBGUESTFS_BACKEND=direct
WORKDIR /work
