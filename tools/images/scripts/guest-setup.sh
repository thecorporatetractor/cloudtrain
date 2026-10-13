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
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gpg apt-transport-https \
  qemu-guest-agent conntrack socat ethtool ipset ebtables jq bash-completion

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
curl -fsSL "https://pkgs.k8s.io/core:/stable:/${LAB_K8S_MINOR}/deb/Release.key" \
  | gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${LAB_K8S_MINOR}/deb/ /" \
  > /etc/apt/sources.list.d/kubernetes.list
apt-get update

KV=$(apt-cache madison kubeadm | awk -v v="${LAB_K8S_VERSION#v}" '$3 ~ "^"v"-" && !f {print $3; f=1}')  # no early exit: SIGPIPE + pipefail
[ -n "$KV" ] || { echo "kubeadm ${LAB_K8S_VERSION} not in repo"; exit 1; }
apt-get install -y containerd.io "kubelet=$KV" "kubeadm=$KV" "kubectl=$KV" cri-tools kubernetes-cni
apt-mark hold kubelet kubeadm kubectl containerd.io

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
while read -r img; do
  [ -n "$img" ] || continue
  for try in 1 2 3; do
    ctr -n k8s.io images pull --platform linux/amd64 "$img" >/dev/null && break
    [ "$try" = 3 ] && { echo "pull failed: $img"; exit 1; }; sleep 5
  done
  # kubelet/CRI only see images with a CRI-managed label
  ctr -n k8s.io images label "$img" io.cri-containerd.image=managed >/dev/null
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
BUILD_DATE=${BUILD_DATE}
GIT_REV=${GIT_REV}
EOF
cat /etc/cloudtrain-release

# --- generalize ---
apt-get clean
rm -f /etc/apt/apt.conf.d/99-build-ipv4
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
cloud-init clean --logs --seed || true
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
fstrim -av || true
