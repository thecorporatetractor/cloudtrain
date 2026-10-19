# Tier-B systemd pod, Enterprise Linux family (catalog ref el-sys:10): el-lab:10 plus systemd as
# PID 1 and the admin tooling of the el-vm labs. Runs only in a Kata sandbox (privileged inside
# the guest VM; docs/kata-spike.md). Built by tools/images/build-linux-pod.sh el-sys.
ARG BASE_IMAGE
# hadolint ignore=DL3006
FROM ${BASE_IMAGE}
ARG ALMA_REPO
ARG KATA_LAB_RELEASE
ENV container=other
# Packages from the AlmaLinux point release (ALMA_REPO), as el-lab; the mirror stays the only
# package source of the running pod.
RUN set -eux; mkdir /tmp/repo-off; mv /etc/yum.repos.d/*.repo /tmp/repo-off/; \
    for r in BaseOS AppStream CRB; do \
      printf '[%s]\nname=AlmaLinux %s (point release)\nbaseurl=%s/%s/x86_64/os/\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-10\n' \
        "$r" "$r" "$ALMA_REPO" "$r" >> /etc/yum.repos.d/build-alma.repo; done; \
    dnf -y --setopt=install_weak_deps=False install \
      systemd systemd-udev dbus-broker kmod chrony nftables iptables-nft iproute-tc ethtool tcpdump \
      wireguard-tools lvm2 mdadm device-mapper xfsprogs parted; \
    rm -f /etc/yum.repos.d/build-alma.repo; mv /tmp/repo-off/*.repo /etc/yum.repos.d/; rmdir /tmp/repo-off; \
    dnf clean all; rm -rf /var/cache/dnf /var/log/dnf*
COPY sys/ /tmp/sys/
COPY --from=kernel modules.builtin /tmp/sys/modules.builtin
RUN set -eux; sh /tmp/sys/setup.sh el el-sys "$KATA_LAB_RELEASE"; rm -rf /tmp/sys
STOPSIGNAL SIGRTMIN+3
HEALTHCHECK NONE
ENTRYPOINT ["/usr/local/sbin/ct-sysinit"]
CMD []
