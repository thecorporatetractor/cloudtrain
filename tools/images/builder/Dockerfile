# Image-builder toolbox: libguestfs (virt-customize) + qemu-img.
# Runs with /dev/kvm passed through so the libguestfs appliance is accelerated.
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libguestfs-tools qemu-utils linux-image-generic guestfs-tools \
      curl ca-certificates xz-utils \
      dhcpcd-base isc-dhcp-client \
 && rm -rf /var/lib/apt/lists/*
# direct backend: no libvirtd needed inside the container
ENV LIBGUESTFS_BACKEND=direct
WORKDIR /work
