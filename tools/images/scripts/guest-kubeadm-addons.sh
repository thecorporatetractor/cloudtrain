#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run) on top of the kubeadm:1.37 disk
# (cloudtrain/kubeadm-node:${K8S_VERSION}). Produces kubeadm:1.37-full (also catalog
# kubeadm:1.37-sec): the same node plus
#   /opt/cloudtrain/bin/addons-install <list>  post-init hook (see tools/images/kubeadm-addons)
#   /opt/cloudtrain/addons/<name>/              sha256-recorded manifests
#   preloaded images of every add-on (lock/addons.lock)
#   CKS material: gVisor runsc + containerd runtime handler `runsc`, kube-bench + cfg,
#   AppArmor sample profiles and audit policies in /opt/cloudtrain/security
source /opt/cloudtrain/build/guest-common.sh
B=/opt/cloudtrain/build
grow_root

# --- add-on manifests + installer ---
install -d /opt/cloudtrain/addons /opt/cloudtrain/bin
cp -r "$B/addons/." /opt/cloudtrain/addons/
(cd /opt/cloudtrain/addons && find . -type f -name '*.yaml' | sort | xargs sha256sum > SHA256SUMS && cat SHA256SUMS)
install -m 0755 "$B/addons-install" /opt/cloudtrain/bin/addons-install

# --- security material ---
install -d /opt/cloudtrain/security
cp -r "$B/security/." /opt/cloudtrain/security/
# gVisor: runsc + shim, registered with containerd as runtime handler "runsc" (labs only
# create the RuntimeClass: handler: runsc)
install -m 0755 "$B/gvisor/runsc" "$B/gvisor/containerd-shim-runsc-v1" /usr/local/bin/
runsc --version | head -1
CFG=/etc/containerd/config.toml
if ! grep -q 'runtimes.runsc' "$CFG"; then
  # containerd 2.x (config version 3): CRI runtimes live under io.containerd.cri.v1.runtime
  python3 - "$CFG" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
anchor = "[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runc]"
assert anchor in s, "runc runtime section not found in " + p
add = ("[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc]\n"
       "          runtime_type = 'io.containerd.runsc.v1'\n\n        ")
s = s.replace(anchor, add + anchor, 1)
open(p, "w").write(s)
PY
fi
grep -n -A1 'runtimes.runsc' "$CFG"
containerd config dump >/dev/null 2>&1 || containerd -c "$CFG" config dump | grep -q runsc
# kube-bench (offline: binary + cfg)
install -d /etc/kube-bench
tar -xzf "$B/kube-bench.tar.gz" -C /tmp kube-bench cfg
install -m 0755 /tmp/kube-bench /usr/local/bin/kube-bench
cp -r /tmp/cfg /etc/kube-bench/cfg; rm -rf /tmp/kube-bench /tmp/cfg
kube-bench version || true
install -d /etc/falco/rules.d

# --- preload add-on images (by digest, named by tag, CRI-managed) ---
containerd >/tmp/containerd.log 2>&1 &
CPID=$!
for i in $(seq 1 30); do ctr version >/dev/null 2>&1 && break; sleep 1; done
while read -r ref; do
  [ -n "$ref" ] || continue
  tagged=${ref%@*}; bydigest=${tagged%:*}@${ref#*@}
  for try in 1 2 3; do
    ctr -n k8s.io images pull --platform linux/amd64 "$bydigest" >/dev/null && break
    [ "$try" = 3 ] && { echo "pull failed: $bydigest"; exit 1; }; sleep 5
  done
  ctr -n k8s.io images tag --force "$bydigest" "$tagged" >/dev/null
  ctr -n k8s.io images rm "$bydigest" >/dev/null
  ctr -n k8s.io images label "$tagged" io.cri-containerd.image=managed >/dev/null
done < "$B/addon-images.txt"
cat "$B/addon-images.txt" >> /opt/cloudtrain/images/images.txt
ctr -n k8s.io images ls -q | grep -v '^sha256:' | sort | tee /opt/cloudtrain/images/IMAGES
sed 's/@.*//' "$B/addon-images.txt" | sort -u | comm -23 - /opt/cloudtrain/images/IMAGES | tee /tmp/missing
[ ! -s /tmp/missing ]
kill $CPID; wait $CPID || true

sed -i "s/^CLOUDTRAIN_IMAGE_TAG=.*/CLOUDTRAIN_IMAGE_TAG=${CLOUDTRAIN_IMAGE_TAG}/; s/^CLOUDTRAIN_CATALOG_REF=.*/CLOUDTRAIN_CATALOG_REF=${CLOUDTRAIN_CATALOG_REF}/" /etc/cloudtrain-release
cat >> /etc/cloudtrain-release <<R
ADDONS=$(ls /opt/cloudtrain/addons | grep -v SHA256SUMS | paste -sd,)
GVISOR_RELEASE=${GVISOR_RELEASE}
KUBE_BENCH_VERSION=${KUBE_BENCH_VERSION}
R
cat /etc/cloudtrain-release
# generalize (the base image was already generalized; redo what this layer touched)
apt-get clean || true
rm -rf /tmp/* /var/tmp/* "$B"
cloud-init clean --logs --seed || true
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
fstrim -av || true
