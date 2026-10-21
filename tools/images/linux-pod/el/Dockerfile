# Tier-A Linux learner pod, Enterprise Linux family (catalog ref el-lab:10): AlmaLinux 10
# userland, run unprivileged in a Kubernetes user namespace (hostUsers: false) by the
# container driver. Built by tools/images/build-linux-pod.sh; versions from deploy/versions.env.
ARG ALMA_BASE_IMAGE
FROM ${ALMA_BASE_IMAGE}
ARG ALMA_REPO
ARG TINI_VERSION
ARG TINI_STATIC_SHA256
ARG MIRROR_URL
# Packages from the AlmaLinux point release (ALMA_REPO); documentation is kept (tsflags=nodocs off); coreutils and curl replace
# the container base's coreutils-single and curl-minimal (which ship no man pages). haproxy is baked in because wired pods
# (topology links) sit in the session VPC with no route to the package mirror, so a lab balancer cannot `dnf install` it.
RUN set -eux; rm -f /etc/yum.repos.d/*.repo; \
    for r in BaseOS AppStream CRB; do \
      printf '[%s]\nname=AlmaLinux %s (point release)\nbaseurl=%s/%s/x86_64/os/\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-10\n' \
        "$r" "$r" "$ALMA_REPO" "$r" >> /etc/yum.repos.d/build-alma.repo; done; \
    sed -i '/^tsflags=nodocs/d' /etc/dnf/dnf.conf; \
    printf 'retries=10\ntimeout=30\n' >> /etc/dnf/dnf.conf; \
    dnf -y --setopt=install_weak_deps=False --allowerasing install coreutils curl \
      man-db man-pages bash-completion vim-enhanced nano less tree which file findutils \
      procps-ng psmisc lsof strace iproute iputils bind-utils traceroute nmap-ncat curl wget \
      openssh-clients openssh-server rsync git tmux tar gzip bzip2 xz zip unzip zstd acl attr \
      diffutils patch bc words jq python3 python3-pip gcc make cronie at sudo shadow-utils \
      openssl hostname util-linux cpio sqlite logrotate glibc-langpack-en haproxy; \
    dnf -y reinstall $(rpm -qa --qf '%{NAME}\n' | grep -vE '^(gpg-pubkey|filesystem|setup)$') >/dev/null 2>&1 || true; \
    mandb -q || true; \
    dnf clean all; rm -rf /var/cache/dnf /var/log/dnf*
COPY common/ /tmp/common/
RUN set -eux; sh /tmp/common/setup.sh el "$MIRROR_URL" "$TINI_VERSION" "$TINI_STATIC_SHA256"; rm -rf /tmp/common
ENV LANG=C.UTF-8
WORKDIR /root
ENTRYPOINT ["/usr/local/sbin/tini", "--"]
CMD ["/usr/local/sbin/cloudtrain-init"]
