#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run). Produces a kubeadm-ready
# node: containerd (systemd cgroups), kubeadm/kubelet/kubectl pinned + held, kernel
# prerequisites, and all control-plane + CNI images already in containerd's store,
# so `kubeadm init/join` needs no registry access.
set -euxo pipefail
source /opt/cloudtrain/build.env
export DEBIAN_FRONTEND=noninteractive

# Grow root fs into the resized virtual disk. Inside the libguestfs appliance the
# guest disk is not necessarily /dev/sda, so derive it from the mounted root.
ROOTPART=$(findmnt -no SOURCE /)
ROOTDISK=/dev/$(lsblk -no PKNAME "$ROOTPART")
PARTNUM=$(cat /sys/class/block/$(basename "$ROOTPART")/partition)
growpart "$ROOTDISK" "$PARTNUM" || true
resize2fs "$ROOTPART"
df -h /

# Boot-time hygiene for lab nodes: no snaps, no background apt runs fighting for dpkg.
apt-get purge -y snapd unattended-upgrades || true
systemctl mask apt-daily.timer apt-daily-upgrade.timer apt-daily.service apt-daily-upgrade.service

# The libguestfs appliance (user-mode net) has no IPv6 route; force IPv4 during the build.
echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99-build-ipv4
# Ubuntu archive packages come from a fixed snapshot.ubuntu.com point in time, so
# a rebuild resolves the same versions (third-party repos below are pinned per package).
echo "APT::Snapshot \"${UBUNTU_APT_SNAPSHOT}\";" > /etc/apt/apt.conf.d/99-build-snapshot
apt-get -o APT::Update::Error-Mode=any update
apt-get install -y --no-install-recommends ca-certificates curl gpg apt-transport-https \
  qemu-guest-agent conntrack socat ethtool ipset ebtables jq bash-completion

# fetch_key <url> <expected fingerprint> <dest .gpg>: refuse a key with another fingerprint.
fetch_key() {
  local tmp; tmp=$(mktemp)
  curl -fsSL "$1" -o "$tmp"
  local fpr; fpr=$(gpg --show-keys --with-colons "$tmp" | awk -F: '/^fpr/{print $10; exit}')
  [ "$fpr" = "$2" ] || { echo "GPG key $1 has fingerprint '$fpr', expected '$2'"; exit 1; }
  gpg --dearmor --yes -o "$3" "$tmp"
  rm -f "$tmp"
}
install -m 0755 -d /etc/apt/keyrings
fetch_key https://download.docker.com/linux/ubuntu/gpg "$DOCKER_APT_KEY_FPR" /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
fetch_key "https://pkgs.k8s.io/core:/stable:/${LAB_K8S_MINOR}/deb/Release.key" "$K8S_APT_KEY_FPR" \
  /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${LAB_K8S_MINOR}/deb/ /" \
  > /etc/apt/sources.list.d/kubernetes.list
apt-get -o APT::Update::Error-Mode=any update

KV=$(apt-cache madison kubeadm | awk -v v="${LAB_K8S_VERSION#v}" '$3 ~ "^"v"-" && !f {print $3; f=1}')  # no early exit: SIGPIPE + pipefail
[ -n "$KV" ] || { echo "kubeadm ${LAB_K8S_VERSION} not in repo"; exit 1; }
apt-get install -y "containerd.io=${CONTAINERD_VERSION}" "kubelet=$KV" "kubeadm=$KV" "kubectl=$KV" \
  "cri-tools=${CRI_TOOLS_VERSION}" "kubernetes-cni=${KUBERNETES_CNI_VERSION}"
apt-mark hold kubelet kubeadm kubectl containerd.io cri-tools kubernetes-cni

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
systemctl enable containerd kubelet qemu-guest-agent || true

# --- pre-load images into containerd (k8s.io namespace) ---
containerd >/tmp/containerd.log 2>&1 &
CPID=$!
for i in $(seq 1 30); do ctr version >/dev/null 2>&1 && break; sleep 1; done
# images.txt lines are <name>:<tag>@<digest>: pull by digest, then name it by tag
# (what kubeadm and the Flannel manifest reference).
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
kill $CPID; wait $CPID || true

# kubectl completion for learners
kubectl completion bash > /etc/bash_completion.d/kubectl

cat > /etc/cloudtrain-release <<EOF
CLOUDTRAIN_IMAGE=kubeadm-node
KUBERNETES_VERSION=${LAB_K8S_VERSION}
FLANNEL_VERSION=${FLANNEL_VERSION}
CONTAINERD_VERSION=$(containerd --version | awk '{print $3}')
CONTAINERD_PACKAGE=${CONTAINERD_VERSION}
UBUNTU_APT_SNAPSHOT=${UBUNTU_APT_SNAPSHOT}
BUILD_DATE=${BUILD_DATE}
GIT_REV=${GIT_REV}
EOF
cat /etc/cloudtrain-release

# --- generalize ---
apt-get clean
rm -f /etc/apt/apt.conf.d/99-build-ipv4 /etc/apt/apt.conf.d/99-build-snapshot
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
cloud-init clean --logs --seed || true
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
fstrim -av || true
