#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces a kubeadm-ready
# node: containerd (systemd cgroups), kubeadm/kubelet/kubectl pinned + held, kernel
# prerequisites, and every control-plane, CNI and lab workload image already in
# containerd's k8s.io store, so `kubeadm init/join` and the labs' Pods need no registry.
#
# With STAGED_K8S_VERSION set (upgrade image) the node also carries that release
# OFFLINE: its kubeadm/kubelet/kubectl debs in a local, signed apt repo that is the
# only apt source, and its control-plane images in containerd, so
# `apt-get install kubeadm=<staged>-*` and `kubeadm upgrade apply <staged>` work with
# no network.
source /opt/cloudtrain/build/guest-common.sh

grow_root
base_setup conntrack socat ethtool ipset ebtables apt-utils

install -m 0755 -d /etc/apt/keyrings
fetch_key https://download.docker.com/linux/ubuntu/gpg "$DOCKER_APT_KEY_FPR" /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
k8s_repo() {  # k8s_repo <minor> <list file>
  echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/$1/deb/ /" > "$2"
}
# Every pkgs.k8s.io minor repo is signed with the same key.
fetch_key "https://pkgs.k8s.io/core:/stable:/${K8S_MINOR}/deb/Release.key" "$K8S_APT_KEY_FPR" \
  /etc/apt/keyrings/kubernetes-apt-keyring.gpg
k8s_repo "$K8S_MINOR" /etc/apt/sources.list.d/kubernetes.list
apt-get -o APT::Update::Error-Mode=any update

# pkg_version <package> <vX.Y.Z>: the repo's revision of that upstream version (e.g. 1.37.1-1.1).
pkg_version() {
  apt-cache madison "$1" | awk -v v="${2#v}" '$3 ~ "^"v"-" && !f {print $3; f=1}'  # no early exit: SIGPIPE + pipefail
}
KV=$(pkg_version kubeadm "$K8S_VERSION")
[ -n "$KV" ] || { echo "kubeadm ${K8S_VERSION} not in repo"; exit 1; }
apt-get install -y "containerd.io=${CONTAINERD_VERSION}" "kubelet=$KV" "kubeadm=$KV" "kubectl=$KV" \
  "cri-tools=${K8S_CRI_TOOLS_VERSION}" "kubernetes-cni=${KUBERNETES_CNI_VERSION}"
apt-mark hold kubelet kubeadm kubectl containerd.io cri-tools kubernetes-cni

# --- staged upgrade target: local signed apt repo, the only apt source --------------
if [ -n "${STAGED_K8S_VERSION}" ]; then
  REPO=/opt/cloudtrain/apt
  install -d "$REPO"
  # The installed release, so `apt-cache madison` shows both and a reinstall works.
  (cd "$REPO" && apt-get download "kubeadm=$KV" "kubelet=$KV" "kubectl=$KV" \
     "cri-tools=${K8S_CRI_TOOLS_VERSION}" "kubernetes-cni=${KUBERNETES_CNI_VERSION}")
  # The target release, downloaded through the signed pkgs.k8s.io repo (apt checks the
  # Release signature and every .deb's sha256).
  k8s_repo "$STAGED_K8S_MINOR" /etc/apt/sources.list.d/kubernetes-staged.list
  apt-get -o APT::Update::Error-Mode=any update
  SV=$(pkg_version kubeadm "$STAGED_K8S_VERSION")
  [ -n "$SV" ] || { echo "kubeadm ${STAGED_K8S_VERSION} not in repo"; exit 1; }
  (cd "$REPO" && apt-get download "kubeadm=$SV" "kubelet=$SV" "kubectl=$SV")
  rm -f /etc/apt/sources.list.d/kubernetes-staged.list

  # Sign the repo with a throwaway key: only its public half stays in the image.
  (cd "$REPO" && apt-ftparchive packages . > Packages && gzip -9kf Packages \
     && apt-ftparchive -o APT::FTPArchive::Release::Origin=CloudTrain \
          -o APT::FTPArchive::Release::Label="CloudTrain offline Kubernetes" release . > Release)
  GNUPGHOME=$(mktemp -d); export GNUPGHOME
  gpg --batch --pinentry-mode loopback --passphrase '' --quick-gen-key "CloudTrain offline apt repo" ed25519 sign never
  gpg --batch --yes --clearsign -o "$REPO/InRelease" "$REPO/Release"
  gpg --batch --export > /etc/apt/keyrings/cloudtrain-offline.gpg
  gpgconf --kill all || true
  rm -rf "$GNUPGHOME"; unset GNUPGHOME

  # Lab VMs have no internet: the local repo is the only source, so `apt-get update`
  # succeeds offline and quickly. The online sources are kept, disabled, for reference.
  cat > /etc/apt/sources.list.d/kubernetes.list <<EOF
# CloudTrain offline Kubernetes repository (staged upgrade ${STAGED_K8S_VERSION}).
# Online equivalent: https://pkgs.k8s.io/core:/stable:/${K8S_MINOR}/deb/ and :/${STAGED_K8S_MINOR}/deb/
deb [signed-by=/etc/apt/keyrings/cloudtrain-offline.gpg] file:${REPO} ./
EOF
  for f in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/docker.list; do
    if [ -f "$f" ]; then mv "$f" "$f.disabled"; fi
  done
  if grep -q '^deb ' /etc/apt/sources.list 2>/dev/null; then mv /etc/apt/sources.list /etc/apt/sources.list.disabled; fi
  # A dependency missing from the local repo would show up here, not in the lab.
  rm -f /etc/apt/apt.conf.d/99-build-snapshot
  # Prove it: the staged versions resolve from the local repo alone.
  apt-get -o APT::Update::Error-Mode=any update
  apt-cache madison kubeadm kubelet kubectl | tee "$REPO/MADISON"
  apt-get install -s --allow-change-held-packages "kubeadm=$SV" "kubelet=$SV" "kubectl=$SV" | grep -E '^Inst '
  echo "$SV" > "$REPO/STAGED_VERSION"
fi

# --- containerd: systemd cgroups, CRI enabled, sandbox image = kubeadm's pause ---
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sed -i "s#registry.k8s.io/pause:[0-9.]*#${PAUSE_IMAGE}#" /etc/containerd/config.toml
grep -q 'SystemdCgroup = true' /etc/containerd/config.toml
cat > /etc/crictl.yaml <<'EOF'
runtime-endpoint: unix:///run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
EOF

# --- kernel prerequisites ---
cat > /etc/modules-load.d/k8s.conf <<'EOF'
overlay
br_netfilter
EOF
cat > /etc/sysctl.d/99-kubernetes.conf <<'EOF'
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sed -i '/\sswap\s/d' /etc/fstab
systemctl enable containerd kubelet || true

# --- pre-load images into containerd (k8s.io namespace) ---
install -d /opt/cloudtrain/images /opt/cloudtrain/manifests
cp /opt/cloudtrain/build/images.txt /opt/cloudtrain/images/images.txt
cp /opt/cloudtrain/build/kube-flannel.yml /opt/cloudtrain/manifests/kube-flannel.yml
containerd >/tmp/containerd.log 2>&1 &
CPID=$!
for i in $(seq 1 30); do ctr version >/dev/null 2>&1 && break; sleep 1; done
# images.txt lines are <name>:<tag>@<digest>: pull by digest, then name it by tag
# (what kubeadm, the Flannel manifest and the labs' Pods reference).
while read -r ref; do
  [ -n "$ref" ] || continue
  tagged=${ref%@*}; bydigest=${tagged%:*}@${ref#*@}
  for try in 1 2 3; do
    ctr -n k8s.io images pull --platform linux/amd64 "$bydigest" >/dev/null && break
    [ "$try" = 3 ] && { echo "pull failed: $bydigest"; exit 1; }; sleep 5
  done
  ctr -n k8s.io images tag --force "$bydigest" "$tagged" >/dev/null
  ctr -n k8s.io images rm "$bydigest" >/dev/null
  # kubelet/CRI only see images with a CRI-managed label
  ctr -n k8s.io images label "$tagged" io.cri-containerd.image=managed >/dev/null
done < /opt/cloudtrain/images/images.txt
ctr -n k8s.io images ls -q | grep -v '^sha256:' | sort | tee /opt/cloudtrain/images/IMAGES
# every locked image must be present by name
sed 's/@.*//' /opt/cloudtrain/images/images.txt | sort -u | comm -23 - /opt/cloudtrain/images/IMAGES | tee /tmp/missing
[ ! -s /tmp/missing ]
kill $CPID; wait $CPID || true

# kubectl completion for learners
kubectl completion bash > /etc/bash_completion.d/kubectl

write_release \
  "KUBERNETES_VERSION=${K8S_VERSION}" \
  "STAGED_KUBERNETES_VERSION=${STAGED_K8S_VERSION}" \
  "FLANNEL_VERSION=${FLANNEL_VERSION}" \
  "CONTAINERD_VERSION=$(containerd --version | awk '{print $3}')" \
  "CONTAINERD_PACKAGE=${CONTAINERD_VERSION}"

generalize
