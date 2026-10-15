# Interim tier-A Linux learner pod, Debian family (catalog ref linux-pod-deb:24.04).
# Built by tools/images/linux-pod-interim/build.sh until the foundations stream ships the
# user-namespace version; keep the contract below when replacing it.
# Contract: user `learner` (uid/gid 1000, bash, no sudo rule: labs that are about
# privileges add one in setup), man pages and /usr/share/doc present (the image is
# "unminimized"), sshd installed but not started, PID 1 `sleep infinity`.
FROM ubuntu:24.10@sha256:cdf755952ed117f6126ff4e65810bf93767d4c38f5c7185b50ec1f1078b464cc
ENV DEBIAN_FRONTEND=noninteractive
# Interim build: packages come from the live Ubuntu archive (snapshot.ubuntu.com was
# returning 5xx errors on 2026-10-14). The foundations image pins a snapshot.
# Man pages and docs are kept (ubuntu:24.04 excludes them via dpkg path-exclude); the
# packages whose manuals labs use are reinstalled so their pages come back.
RUN rm -f /etc/dpkg/dpkg.cfg.d/excludes \
 && echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-retries \
 && apt-get -o Acquire::ForceIPv4=true update \
 && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
      ca-certificates bash-completion vim nano less man-db manpages info file tree bc time \
      xz-utils bzip2 zstd zip unzip procps psmisc lsof strace \
      iproute2 iputils-ping dnsutils netcat-openbsd curl openssh-client openssh-server \
      sudo cron logrotate acl git python3 python3-venv gnupg openssl \
 && apt-get -o Acquire::ForceIPv4=true install -y --reinstall --no-install-recommends \
      coreutils findutils grep sed tar gzip bash util-linux passwd login procps diffutils \
 && mandb -q \
 && rm -rf /var/lib/apt/lists/*
COPY bashrc /etc/cloudtrain/bashrc
# The ubuntu base user has uid 1000, so it goes.
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -U -s /bin/bash learner \
 && echo '[ -f /etc/cloudtrain/bashrc ] && . /etc/cloudtrain/bashrc' | tee -a /etc/skel/.bashrc >> /home/learner/.bashrc \
 && install -d -m 0700 -o learner -g learner /home/learner/.ssh \
 && rm -f /etc/ssh/ssh_host_* && mkdir -p /run/sshd \
 && printf 'CLOUDTRAIN_IMAGE=linux-pod-deb\nINTERIM=1\n' > /etc/cloudtrain-release
WORKDIR /root
CMD ["sleep", "infinity"]
