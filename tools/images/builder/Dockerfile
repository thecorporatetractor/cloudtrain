# Image-builder toolbox: libguestfs (virt-customize) + qemu-img.
# Runs with /dev/kvm passed through so the libguestfs appliance is accelerated.
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
ENV DEBIAN_FRONTEND=noninteractive
# snapshot.ubuntu.com point in time (UBUNTU_APT_SNAPSHOT in deploy/versions.env).
ARG UBUNTU_APT_SNAPSHOT
# The base image has no CA bundle, so ca-certificates is bootstrapped from the
# live archive first (https to snapshot.ubuntu.com needs it); every other
# package then comes from the pinned snapshot.
RUN test -n "$UBUNTU_APT_SNAPSHOT" \
 && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/80-retries \
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
