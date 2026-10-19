# Tier-B systemd pod, Debian family (catalog ref deb-sys:24.04): deb-lab:24.04 plus systemd as
# PID 1 and the admin tooling of the ubuntu-vm labs. Runs only in a Kata sandbox (privileged
# inside the guest VM; docs/kata-spike.md). Built by tools/images/build-linux-pod.sh deb-sys.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG UBUNTU_APT_SNAPSHOT
ARG KATA_LAB_RELEASE
ENV DEBIAN_FRONTEND=noninteractive container=other
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# Packages from the Ubuntu archive at UBUNTU_APT_SNAPSHOT, the point in time the noble mirror
# (and so deb-lab) was taken from; kmod and a few others are not in the mirror's list. The
# mirror stays the only package source of the running pod.
RUN set -eux; test -n "$UBUNTU_APT_SNAPSHOT"; \
    mkdir /tmp/apt-off; mv /etc/apt/sources.list.d/* /tmp/apt-off/; \
    printf 'Types: deb\nURIs: http://archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n' > /etc/apt/sources.list.d/build.sources; \
    apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any update --snapshot "$UBUNTU_APT_SNAPSHOT"; \
    apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends --snapshot "$UBUNTU_APT_SNAPSHOT" \
      systemd systemd-sysv dbus libpam-systemd kmod chrony nftables iptables ethtool tcpdump \
      wireguard-tools lvm2 mdadm dmsetup xfsprogs parted; \
    rm -f /etc/apt/sources.list.d/build.sources; mv /tmp/apt-off/* /etc/apt/sources.list.d/; rmdir /tmp/apt-off; \
    apt-get clean; rm -rf /var/lib/apt/lists/*
COPY sys/ /tmp/sys/
# The lab guest kernel's modules.builtin, from the build context `kernel` (tools/images/kata-kernel).
RUN --mount=type=bind,from=kernel,target=/mnt/kernel \
    set -eux; cp /mnt/kernel/modules.builtin /tmp/sys/modules.builtin; \
    sh /tmp/sys/setup.sh deb deb-sys "$KATA_LAB_RELEASE"; rm -rf /tmp/sys
STOPSIGNAL SIGRTMIN+3
# Readiness comes from the orchestrator (a systemctl is-system-running probe).
HEALTHCHECK NONE
ENTRYPOINT ["/usr/local/sbin/ct-sysinit"]
CMD []
