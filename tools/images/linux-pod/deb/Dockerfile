# Tier-A Linux learner pod, Debian family (catalog ref deb-lab:24.04): Ubuntu 24.04
# userland (unminimized: man pages and docs), run unprivileged in a Kubernetes user
# namespace (hostUsers: false). Built by tools/images/build-linux-pod.sh.
ARG UBUNTU_BASE_IMAGE
FROM ${UBUNTU_BASE_IMAGE}
ARG TINI_VERSION
ARG TINI_STATIC_SHA256
ARG MIRROR_URL
ENV DEBIAN_FRONTEND=noninteractive
# Packages come from the CloudTrain noble mirror snapshot (tools/mirrors, the same signed
# repo the pod uses at runtime), bind-mounted from the build context `noble`
# (build-linux-pod.sh passes --build-context noble=<mirror>/noble), so the image's
# versions are exactly the mirror's. The base image excludes /usr/share/man and docs
# (dpkg path-exclude); drop the excludes and reinstall, so every package has its man pages.
RUN --mount=type=bind,from=noble,target=/mnt/noble --mount=type=bind,source=common/cloudtrain-mirror.asc,target=/mnt/key.asc \
    set -eux; rm -f /etc/dpkg/dpkg.cfg.d/excludes; \
    # the minimized image diverts /usr/bin/man to man.REAL behind a stub; undo it like
    # `unminimize` does, else man-db's postinst fails (chown /usr/bin/man) and apt exits 100
    if dpkg-divert --list /usr/bin/man | grep -q .; then rm -f /usr/bin/man; dpkg-divert --quiet --local --rename --remove /usr/bin/man; fi; \
    mv /etc/apt/sources.list.d/ubuntu.sources /tmp/ubuntu.sources; \
    printf 'Types: deb\nURIs: file:/mnt/noble/\nSuites: ./\nSigned-By: /mnt/key.asc\n' > /etc/apt/sources.list.d/build.sources; \
    printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\n' > /etc/apt/apt.conf.d/80-retries; \
    apt-get -o APT::Update::Error-Mode=any update; \
    apt-get install -y --no-install-recommends \
      man-db manpages manpages-dev bash-completion vim nano less tree file \
      procps psmisc lsof strace iproute2 iputils-ping dnsutils traceroute netcat-openbsd curl wget \
      openssh-client openssh-server rsync git tmux tar gzip bzip2 xz-utils zip unzip zstd acl attr \
      diffutils patch bc wamerican jq python3 python3-pip python3-venv gcc make libc6-dev cron at sudo passwd \
      openssl hostname util-linux cpio sqlite3 logrotate locales tzdata ca-certificates; \
    apt-get -y upgrade; \
    dpkg -l | awk '/^ii/{print $2}' | xargs apt-get install -y --reinstall --no-install-recommends >/dev/null; \
    mandb -q || true; \
    rm -f /etc/apt/sources.list.d/build.sources /tmp/ubuntu.sources; apt-get clean; rm -rf /var/lib/apt/lists/*
COPY common/ /tmp/common/
RUN set -eux; sh /tmp/common/setup.sh deb "$MIRROR_URL" "$TINI_VERSION" "$TINI_STATIC_SHA256"; rm -rf /tmp/common
ENV LANG=C.UTF-8
WORKDIR /root
ENTRYPOINT ["/usr/local/sbin/tini", "--"]
CMD ["/usr/local/sbin/cloudtrain-init"]
