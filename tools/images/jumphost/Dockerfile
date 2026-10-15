# Learner workstation ("learner@workstation"), catalog ref jumphost:1.
# Built by tools/images/build-jumphost.sh; every version and checksum comes from
# deploy/versions.env. Ubuntu packages come from a fixed snapshot.ubuntu.com point in
# time; binaries are verified against pinned sha256 sums (kubectl: dl.k8s.io .sha256).
FROM ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7
ARG UBUNTU_APT_SNAPSHOT
ARG KUBECTL_VERSION
ARG HELM_VERSION
ARG HELM_TARBALL_SHA256
ARG ETCD_VERSION
ARG ETCD_TARBALL_SHA256
ARG YQ_VERSION
ARG YQ_BINARY_SHA256
ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# The base image has no CA bundle, so ca-certificates is bootstrapped from the live
# archive first (https to snapshot.ubuntu.com needs it); everything else comes from
# the pinned snapshot.
RUN test -n "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any update --snapshot "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends --snapshot "$UBUNTU_APT_SNAPSHOT" \
      openssh-client bash-completion vim nano less curl jq tar gzip \
      iproute2 iputils-ping dnsutils netcat-openbsd tmux \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; cd /tmp \
 && curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
 && echo "$(curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl.sha256")  /usr/local/bin/kubectl" | sha256sum -c - \
 && curl -fsSLo helm.tgz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
 && echo "${HELM_TARBALL_SHA256}  helm.tgz" | sha256sum -c - \
 && tar -xzf helm.tgz --strip-components=1 -C /usr/local/bin linux-amd64/helm \
 && curl -fsSLo etcd.tgz "https://github.com/etcd-io/etcd/releases/download/${ETCD_VERSION}/etcd-${ETCD_VERSION}-linux-amd64.tar.gz" \
 && echo "${ETCD_TARBALL_SHA256}  etcd.tgz" | sha256sum -c - \
 && tar -xzf etcd.tgz --strip-components=1 -C /usr/local/bin "etcd-${ETCD_VERSION}-linux-amd64/etcdctl" "etcd-${ETCD_VERSION}-linux-amd64/etcdutl" \
 && curl -fsSLo /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_amd64" \
 && echo "${YQ_BINARY_SHA256}  /usr/local/bin/yq" | sha256sum -c - \
 && rm -f helm.tgz etcd.tgz \
 && chmod 0755 /usr/local/bin/* \
 && C=/usr/share/bash-completion/completions \
 && kubectl completion bash > "$C/kubectl" && helm completion bash > "$C/helm" \
 && etcdctl completion bash > "$C/etcdctl" && yq shell-completion bash > "$C/yq" \
 && kubectl version --client && helm version --short && etcdctl version && yq --version

COPY bashrc /etc/cloudtrain/bashrc
COPY vimrc /etc/vim/vimrc.local
# Non-root learner (uid/gid 1000, what the runtime's securityContext uses). The
# ubuntu base user also has uid 1000, so it goes.
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -U -s /bin/bash learner \
 && echo '[ -f /etc/cloudtrain/bashrc ] && . /etc/cloudtrain/bashrc' | tee -a /etc/skel/.bashrc >> /home/learner/.bashrc \
 && install -d -m 0700 -o learner -g learner /home/learner/.ssh /home/learner/.kube \
 && printf 'CLOUDTRAIN_IMAGE=jumphost\nKUBECTL_VERSION=%s\nHELM_VERSION=%s\nETCD_VERSION=%s\nYQ_VERSION=%s\n' \
      "$KUBECTL_VERSION" "$HELM_VERSION" "$ETCD_VERSION" "$YQ_VERSION" > /etc/cloudtrain-release
USER learner
WORKDIR /home/learner
CMD ["sleep", "infinity"]
