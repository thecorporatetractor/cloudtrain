#!/bin/bash
# Runs INSIDE the guest filesystem (virt-customize --run) on top of the kubeadm:1.37 disk
# (cloudtrain/kubeadm-node:${K8S_VERSION}). Produces kubeadm:1.37-full (also catalog
# kubeadm:1.37-sec): the same node plus
#   /opt/cloudtrain/bin/addons-install <list>  post-init hook (see tools/images/kubeadm-addons)
#   /opt/cloudtrain/addons/<name>/              sha256-recorded manifests
#   preloaded images of every add-on (lock/addons.lock)
#   CKS material: gVisor runsc + containerd runtime handler `runsc`, kube-bench + cfg,
#   AppArmor sample profiles and audit policies in /opt/cloudtrain/security
#   supply chain: Trivy (`trivy` wrapper: offline DB in /var/lib/trivy, containerd
#   namespace k8s.io, buildah images through podman.socket), cosign, base images in
#   buildah's storage (kubeadm-addons/buildah-images.txt), the signed parcel-api fixture
#   in /opt/qm-signing (kubeadm-addons/signing)
source /opt/cloudtrain/build/guest-common.sh
B=/opt/cloudtrain/build
grow_root
# apt from the pinned snapshot again (the base layer was generalized): podman, whose API
# socket is the only way Trivy reads images in buildah's storage (/var/lib/containers)
base_setup podman
systemctl enable podman.socket
# The podman package drops its CNI bridge config (cni-podman0, 10.88.0.0/16) into
# /etc/cni/net.d, which is also the kubelet's CNI directory. Before calico-node has written
# 10-calico.conflist on a node, that file makes the node report NetworkReady and containerd
# start pods on the podman bridge (10.88.x addresses, unreachable from other nodes; seen as
# a metrics-server the API server cannot reach). Podman reads its networks from
# /etc/containers/networks here (guest-kubeadm.sh), so the file is not used by podman.
rm -f /etc/cni/net.d/87-podman-bridge.conflist

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
install -d /usr/local/bin/gvisor-bin
install -m 0755 "$B"/gvisor/gvisor-bin/* /usr/local/bin/gvisor-bin/
test -x /usr/local/bin/gvisor-bin/gvisor_sentry
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

# --- supply-chain tools (Apache-2.0; licence texts in /usr/share/doc/<tool>) ---
install -d /usr/local/libexec/cloudtrain /usr/share/doc/trivy /usr/share/doc/cosign
install -m 0755 "$B/trivy/trivy" /usr/local/libexec/cloudtrain/trivy
install -m 0644 "$B/trivy/LICENSE" /usr/share/doc/trivy/LICENSE
install -m 0755 "$B/cosign" /usr/local/bin/cosign
install -m 0644 "$B/cosign.LICENSE" /usr/share/doc/cosign/LICENSE
cosign version 2>&1 | grep -i gitversion
# Trivy DB, dated (TRIVY_DB_DATE): never updated on the node, lab VMs have no internet.
# Refresh = new TRIVY_DB_REF/TRIVY_DB_DATE in versions.env and an image rebuild.
install -d -m 0755 /var/lib/trivy /var/lib/trivy/db
tar --no-same-owner -xzf "$B/trivy-db.tar.gz" -C /var/lib/trivy/db
test -s /var/lib/trivy/db/trivy.db
cat /var/lib/trivy/db/metadata.json; echo
chmod -R a+rX /var/lib/trivy
cat > /usr/local/bin/trivy <<'EOF'
#!/bin/sh
# CloudTrain: Trivy with the offline vulnerability DB baked into this image (lab VMs have
# no internet). Only defaults: flags and TRIVY_* variables set by the caller win.
#   DB          /var/lib/trivy/db, never updated (date: TRIVY_DB_DATE in /etc/cloudtrain-release)
#   containerd  namespace k8s.io, the kubelet's images (trivy image --image-src containerd ...)
#   buildah     images in buildah's storage are read through podman's API socket
: "${TRIVY_SKIP_DB_UPDATE:=true}" "${TRIVY_SKIP_JAVA_DB_UPDATE:=true}" "${TRIVY_SKIP_CHECK_UPDATE:=true}"
: "${TRIVY_SKIP_VEX_REPO_UPDATE:=true}" "${TRIVY_OFFLINE_SCAN:=true}" "${TRIVY_SKIP_VERSION_CHECK:=true}"
: "${TRIVY_DISABLE_TELEMETRY:=true}" "${CONTAINERD_NAMESPACE:=k8s.io}" "${TRIVY_PODMAN_HOST:=/run/podman/podman.sock}"
if [ "$(id -u)" = 0 ]; then
  : "${TRIVY_CACHE_DIR:=/var/lib/trivy}"
else
  # other users: their own scan cache, the shared DB
  : "${TRIVY_CACHE_DIR:=${XDG_CACHE_HOME:-$HOME/.cache}/trivy}"
  mkdir -p "$TRIVY_CACHE_DIR" 2>/dev/null || true
  [ -e "$TRIVY_CACHE_DIR/db" ] || ln -s /var/lib/trivy/db "$TRIVY_CACHE_DIR/db" 2>/dev/null || true
fi
export TRIVY_SKIP_DB_UPDATE TRIVY_SKIP_JAVA_DB_UPDATE TRIVY_SKIP_CHECK_UPDATE TRIVY_SKIP_VEX_REPO_UPDATE \
  TRIVY_OFFLINE_SCAN TRIVY_SKIP_VERSION_CHECK TRIVY_DISABLE_TELEMETRY CONTAINERD_NAMESPACE TRIVY_PODMAN_HOST TRIVY_CACHE_DIR
exec /usr/local/libexec/cloudtrain/trivy "$@"
EOF
chmod 0755 /usr/local/bin/trivy
trivy --version

# --- base images in buildah's storage (by digest, named as the labs reference them) ---
while read -r ref name; do
  [ -n "$ref" ] || continue
  tagged=${ref%@*}; src=${tagged%:*}@${ref#*@}   # <name>:<tag>@<digest> -> pull <name>@<digest>
  if [ -n "${DOCKERIO_MIRROR:-}" ] && [ "${src%%/*}" = docker.io ]; then src=$DOCKERIO_MIRROR/${src#docker.io/}; fi
  for try in 1 2 3; do
    id=$(buildah pull -q --platform linux/amd64 "docker://$src") && break
    [ "$try" = 3 ] && { echo "buildah pull failed: $src"; exit 1; }; sleep 5
  done
  buildah tag "$id" "$name"
  buildah inspect --type image "$name" >/dev/null
done < "$B/buildah-images.txt"
buildah images

# --- preload add-on images (by digest, named by tag, CRI-managed) ---
containerd >/tmp/containerd.log 2>&1 &
CPID=$!
for _ in $(seq 1 30); do ctr version >/dev/null 2>&1 && break; sleep 1; done
while read -r ref; do
  [ -n "$ref" ] || continue
  tagged=${ref%@*}; bydigest=${tagged%:*}@${ref#*@}
  for try in 1 2 3; do
    ctr -n k8s.io images pull "${CTR_HOSTS[@]}" --platform linux/amd64 "$bydigest" >/dev/null && break
    [ "$try" = 3 ] && { echo "pull failed: $bydigest"; exit 1; }; sleep 5
  done
  ctr -n k8s.io images tag --force "$bydigest" "$tagged" >/dev/null
  ctr -n k8s.io images rm "$bydigest" >/dev/null
  ctr -n k8s.io images label "$tagged" io.cri-containerd.image=managed >/dev/null
done < "$B/addon-images.txt"
cat "$B/addon-images.txt" >> /opt/cloudtrain/images/images.txt
# signed-image fixture: /opt/qm-signing + registry.quillmoor.example/parcel/api:{blue,green,amber}
bash "$B/signing/parcel-api.sh" "$B/signing"
ctr -n k8s.io images ls -q | grep -v '^sha256:' | sort | tee /opt/cloudtrain/images/IMAGES
sed 's/@.*//' "$B/addon-images.txt" | sort -u | comm -23 - /opt/cloudtrain/images/IMAGES | tee /tmp/missing
[ ! -s /tmp/missing ]
kill $CPID; wait $CPID || true
rm -rf /tmp/ct-hosts

sed -i "s/^CLOUDTRAIN_IMAGE_TAG=.*/CLOUDTRAIN_IMAGE_TAG=${CLOUDTRAIN_IMAGE_TAG}/; s/^CLOUDTRAIN_CATALOG_REF=.*/CLOUDTRAIN_CATALOG_REF=${CLOUDTRAIN_CATALOG_REF}/" /etc/cloudtrain-release
cat >> /etc/cloudtrain-release <<R
ADDONS=$(cd /opt/cloudtrain/addons && printf '%s\n' * | grep -v SHA256SUMS | paste -sd,)
GVISOR_RELEASE=${GVISOR_RELEASE}
KUBE_BENCH_VERSION=${KUBE_BENCH_VERSION}
TRIVY_VERSION=${TRIVY_VERSION}
TRIVY_DB_REF=${TRIVY_DB_REF}
TRIVY_DB_DATE=${TRIVY_DB_DATE}
COSIGN_VERSION=${COSIGN_V3_VERSION}
PODMAN_VERSION=$(podman --version | awk '{print $3}')
CSI_HOSTPATH_VERSION=${CSI_HOSTPATH_VERSION}
R
cat /etc/cloudtrain-release
# the kubelet's CNI directory must be empty until the cluster's CNI (cni-install) writes to it
if find /etc/cni/net.d -maxdepth 1 -type f \( -name '*.conf' -o -name '*.conflist' -o -name '*.json' \) | grep .; then
  echo "unexpected CNI config in /etc/cni/net.d (pods would start on it before Calico)"; exit 1
fi
# generalize (the base image was already generalized; redo what this layer touched,
# including the build-time apt config of base_setup above)
generalize
