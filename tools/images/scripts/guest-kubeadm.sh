#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces a kubeadm-ready
# node: containerd (systemd cgroups), kubeadm/kubelet/kubectl pinned + held, kernel
# prerequisites, and every control-plane, CNI and lab workload image already in
# containerd's k8s.io store, so `kubeadm init/join` and the labs' Pods need no registry.
#
# With STAGED_K8S_VERSION set (upgrade image) the node also carries that release
# OFFLINE: flat signed apt repos /opt/k8s-apt/<minor>/ for the installed and the staged
# minor (no apt source needs the internet) and the staged control-plane images in
# containerd, so `apt-get install kubeadm=<staged>-*` and `kubeadm upgrade apply
# <staged>` work with no network.
source /opt/cloudtrain/build/guest-common.sh

grow_root
base_setup conntrack socat ethtool ipset ebtables apt-utils
create_learner

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

# --- staged upgrade target: offline, signed, flat apt repos -------------------------
# /opt/k8s-apt/<minor>/ mirrors https://pkgs.k8s.io/core:/stable:/<minor>/deb/ for the
# installed and the staged release. kubernetes.list points at the installed minor, the
# same shape as the online repo, so the learner upgrades the way they would online:
#   sed -i 's#/v1.36/#/v1.37/#' /etc/apt/sources.list.d/kubernetes.list
#   apt-get update && apt-get install kubeadm=1.37.1-*
if [ -n "${STAGED_K8S_VERSION}" ]; then
  APTROOT=/opt/k8s-apt
  # stage_repo <minor> <kubernetes version> <cri-tools version>: download through the signed
  # pkgs.k8s.io repo (apt checks the Release signature and every .deb's sha256).
  stage_repo() {
    local minor=$1 v=$2 cri=$3 dir=$APTROOT/$1 pv
    k8s_repo "$minor" /etc/apt/sources.list.d/kubernetes-stage.list
    apt-get -o APT::Update::Error-Mode=any update
    pv=$(pkg_version kubeadm "$v")
    [ -n "$pv" ] || { echo "kubeadm $v not in the $minor repo"; exit 1; }
    install -d "$dir"
    (cd "$dir" && apt-get download "kubeadm=$pv" "kubelet=$pv" "kubectl=$pv" \
       "cri-tools=$cri" "kubernetes-cni=${KUBERNETES_CNI_VERSION}")
    rm -f /etc/apt/sources.list.d/kubernetes-stage.list
  }
  stage_repo "$K8S_MINOR" "$K8S_VERSION" "$K8S_CRI_TOOLS_VERSION"
  stage_repo "$STAGED_K8S_MINOR" "$STAGED_K8S_VERSION" "$STAGED_CRI_TOOLS_VERSION"

  # Sign both repos with a throwaway key (only its public half stays) and add that key to
  # the keyring kubernetes.list already names, next to the pkgs.k8s.io key, so editing
  # the minor in the URL is all a learner has to do.
  GNUPGHOME=$(mktemp -d); export GNUPGHOME
  gpg --batch --pinentry-mode loopback --passphrase '' --quick-gen-key "CloudTrain offline Kubernetes apt repo" ed25519 sign never
  for dir in "$APTROOT"/*/; do
    (cd "$dir" && apt-ftparchive packages . > Packages && gzip -9kf Packages \
       && apt-ftparchive -o APT::FTPArchive::Release::Origin=CloudTrain \
            -o APT::FTPArchive::Release::Label="CloudTrain offline Kubernetes $(basename "$dir")" release . > Release \
       && gpg --batch --yes --clearsign -o InRelease Release)
  done
  gpg --batch --export > /tmp/offline.gpg
  gpgconf --kill all || true
  rm -rf "$GNUPGHOME"; unset GNUPGHOME
  cat /tmp/offline.gpg >> /etc/apt/keyrings/kubernetes-apt-keyring.gpg
  rm -f /tmp/offline.gpg

  cat > /etc/apt/sources.list.d/kubernetes.list <<EOF
deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] file:${APTROOT}/${K8S_MINOR}/ /
EOF
  # Lab VMs have no internet: no apt source may need it, so `apt-get update` succeeds
  # offline. The online sources are kept, disabled, for reference.
  for f in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/docker.list; do
    if [ -f "$f" ]; then mv "$f" "$f.disabled"; fi
  done
  if grep -q '^deb ' /etc/apt/sources.list 2>/dev/null; then mv /etc/apt/sources.list /etc/apt/sources.list.disabled; fi
  rm -f /etc/apt/apt.conf.d/99-build-snapshot
  # Prove it from the local repos alone: the installed minor, then the switch.
  apt-get -o APT::Update::Error-Mode=any update
  apt-cache madison kubeadm
  sed "s#/${K8S_MINOR}/#/${STAGED_K8S_MINOR}/#" /etc/apt/sources.list.d/kubernetes.list > /tmp/staged.list
  mkdir -p /tmp/noparts
  apt-get -o Dir::Etc::SourceList=/tmp/staged.list -o Dir::Etc::SourceParts=/tmp/noparts \
    -o APT::Update::Error-Mode=any update
  apt-get -o Dir::Etc::SourceList=/tmp/staged.list -o Dir::Etc::SourceParts=/tmp/noparts \
    install -s --allow-change-held-packages "kubeadm=${STAGED_K8S_VERSION#v}-*" "kubelet=${STAGED_K8S_VERSION#v}-*" \
    "kubectl=${STAGED_K8S_VERSION#v}-*" | grep -E '^Inst '
  rm -rf /tmp/staged.list /tmp/noparts
  apt-get update
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
# The lab CNI manifest (Calico, pool = kubeadm podSubnet); cni.yaml is the stable name.
cp /opt/cloudtrain/build/calico.yaml /opt/cloudtrain/manifests/calico.yaml
ln -sf calico.yaml /opt/cloudtrain/manifests/cni.yaml
containerd >/tmp/containerd.log 2>&1 &
CPID=$!
for i in $(seq 1 30); do ctr version >/dev/null 2>&1 && break; sleep 1; done
# images.txt lines are <name>:<tag>@<digest>: pull by digest, then name it by tag
# (what kubeadm, the Calico manifest and the labs' Pods reference).
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
  "CALICO_VERSION=${CALICO_VERSION}" \
  "POD_CIDR=${LAB_POD_CIDR}" \
  "CONTAINERD_VERSION=$(containerd --version | awk '{print $3}')" \
  "CONTAINERD_PACKAGE=${CONTAINERD_VERSION}"

generalize
