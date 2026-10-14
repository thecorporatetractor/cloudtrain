# Interim tier-A Linux learner pod, Enterprise Linux family (catalog ref linux-pod-el:10),
# AlmaLinux 10. Built by tools/images/linux-pod-interim/build.sh until the foundations stream
# ships the user-namespace version; same contract as ../deb/Dockerfile.
FROM almalinux:10@sha256:838c2fafefb1a8a0d7f8cdbc3b0551c2a2b1eb0cd87aad6d62aecadb18311f1b
# tsflags=nodocs is the container default; drop it so man pages and docs install.
RUN sed -i '/^tsflags=nodocs/d' /etc/dnf/dnf.conf \
 && dnf -y install --setopt=install_weak_deps=False \
      bash-completion vim-enhanced nano less man-db man-pages info file tree bc time \
      xz bzip2 zstd zip unzip procps-ng psmisc lsof strace findutils diffutils which \
      iproute iputils bind-utils nmap-ncat curl openssh-clients openssh-server \
      sudo cronie logrotate acl git python3 gnupg2 openssl tar gzip shadow-utils passwd \
      util-linux-core hostname \
 && dnf -y reinstall coreutils findutils grep sed tar gzip bash util-linux-core shadow-utils procps-ng diffutils \
 && mandb -q \
 && dnf clean all && rm -rf /var/cache/dnf
COPY bashrc /etc/cloudtrain/bashrc
RUN useradd -m -u 1000 -U -s /bin/bash learner \
 && echo '[ -f /etc/cloudtrain/bashrc ] && . /etc/cloudtrain/bashrc' | tee -a /etc/skel/.bashrc >> /home/learner/.bashrc \
 && install -d -m 0700 -o learner -g learner /home/learner/.ssh \
 && rm -f /etc/ssh/ssh_host_* \
 && printf 'CLOUDTRAIN_IMAGE=linux-pod-el\nINTERIM=1\n' > /etc/cloudtrain-release
WORKDIR /root
CMD ["sleep", "infinity"]
