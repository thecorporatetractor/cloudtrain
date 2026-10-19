#!/usr/bin/env bash
# KIND_PROFILE=kata (dev-up.sh, last step): Kata Containers for tier-B sandboxes on the kind
# nodes of $CLUSTER_NAME (docs/kata-spike.md). Idempotent; dev-up reruns it after a node
# container restart (Spot interruption, Docker restart), which loses the node fixes.
#   1. kind-only node fixes: /dev/shm is 64 MiB in a kind node (QEMU backs guest RAM with
#      /dev/shm files; KATA_NODE_SHM, default 16G), and kindest/node has no D-Bus, which the
#      runtime-rs shims need to move the VMM into the pod's systemd scope (dbus from the
#      Debian snapshot the node image was built from, KATA_NODE_DEBIAN_SNAPSHOT).
#   2. kata-deploy KATA_DEPLOY_VERSION (chart sha256-checked, image by digest), Cloud
#      Hypervisor on runtime-rs only (deploy/kata/values.yaml).
#   3. The lab guest kernel (tools/images/kata-kernel) on every Kata node, selected for
#      clh-runtime-rs with a config.d drop-in. Source, first match:
#        KATA_LAB_KERNEL_FILE=<vmlinux>     a file
#        tools/images/.cache/kata-kernel/<release>/vmlinux   a local build (task image:build:kata-kernel)
#        KATA_LAB_KERNEL_REPO:<release>     the published OCI artifact (oras pull)
#      checked against KATA_LAB_KERNEL_SHA256 when pinned, else (artifact only) by its cosign
#      keyless signature from the kata-kernel workflow. KATA_LAB_KERNEL=stock keeps Kata's own
#      kernel (no bonds, VLANs, GRE, WireGuard, netem or md in the guest).
#   4. RuntimeClass KATA_RUNTIME_CLASS exists; a probe pod boots in it with the lab kernel.
source "$(dirname "$0")/lib.sh"
for t in docker kind kubectl helm jq yq; do need "$t"; done
cluster_exists || die "kind cluster $CLUSTER_NAME not found"

RELEASE="$KATA_LAB_KERNEL_VERSION-ct$KATA_LAB_KERNEL_REV"
KATA_DIR=/opt/kata/share/kata-containers
DROPIN_DIR=/opt/kata/share/defaults/kata-containers/runtime-rs/runtimes/clh-runtime-rs/config.d
mapfile -t NODES < <(kind get nodes --name "$CLUSTER_NAME" | sort)

# --- 1. node fixes ---------------------------------------------------------------
for node in "${NODES[@]}"; do
  docker exec "$node" test -c /dev/vhost-vsock \
    || die "$node has no /dev/vhost-vsock (vhost_vsock must be loaded before the node starts: host-prep.sh, then restart the node)"
  docker exec "$node" mount -o "remount,size=${KATA_NODE_SHM:-16G}" /dev/shm
  if ! docker exec "$node" sh -c 'command -v dbus-daemon >/dev/null'; then
    log "installing dbus in $node (Debian snapshot $KATA_NODE_DEBIAN_SNAPSHOT)"
    docker exec -e SNAP="$KATA_NODE_DEBIAN_SNAPSHOT" "$node" sh -c '
      set -e; d=$(mktemp -d); a="-qq -o Dir::Etc::SourceList=$d/sources.list -o Dir::Etc::SourceParts=/dev/null -o Acquire::Check-Valid-Until=false"
      printf "deb http://snapshot.debian.org/archive/debian/%s trixie trixie-updates main\ndeb http://snapshot.debian.org/archive/debian-security/%s trixie-security main\n" "$SNAP" "$SNAP" > "$d/sources.list"
      apt-get $a -o Acquire::Retries=3 update
      DEBIAN_FRONTEND=noninteractive apt-get $a install -y --no-install-recommends dbus >/dev/null
      rm -rf "$d" /var/lib/apt/lists/*' || die "dbus install in $node failed"
  fi
  docker exec "$node" sh -c 'systemctl start dbus.socket dbus.service && test -S /run/dbus/system_bus_socket' \
    || die "D-Bus is not running in $node"
done
log "ok: node fixes on ${NODES[*]} (/dev/shm ${KATA_NODE_SHM:-16G}, D-Bus)"

# --- 2. kata-deploy --------------------------------------------------------------
CHART="$MANIFEST_CACHE/kata-deploy-$KATA_DEPLOY_VERSION.tgz"
if ! echo "$KATA_DEPLOY_CHART_SHA256  $CHART" | sha256sum -c --status 2>/dev/null; then
  mkdir -p "$MANIFEST_CACHE"; rm -f "$CHART"
  helm pull oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy --version "$KATA_DEPLOY_VERSION" -d "$MANIFEST_CACHE" >/dev/null
  echo "$KATA_DEPLOY_CHART_SHA256  $CHART" | sha256sum -c --status \
    || die "kata-deploy chart sha256 $(sha256sum "$CHART" | cut -d' ' -f1) != KATA_DEPLOY_CHART_SHA256"
fi
log "installing kata-deploy $KATA_DEPLOY_VERSION ($KATA_RUNTIME_CLASS)"
helm --kube-context "$KUBECONTEXT" upgrade --install kata-deploy "$CHART" --namespace kube-system \
  -f "$REPO_ROOT/deploy/kata/values.yaml" --set-string image.reference="$KATA_DEPLOY_IMAGE" \
  --wait --timeout 20m >/dev/null
wait_for "kata-deploy rolled out" 900 k -n kube-system rollout status ds/kata-deploy --timeout=5s
wait_for "RuntimeClass $KATA_RUNTIME_CLASS" 120 k get runtimeclass "$KATA_RUNTIME_CLASS"
# kata-deploy labels a node once Kata is installed on it (the RuntimeClass's nodeSelector).
mapfile -t KATA_NODES < <(k get nodes -l katacontainers.io/kata-runtime=true -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | sort)
((${#KATA_NODES[@]})) || die "no node is labelled katacontainers.io/kata-runtime=true"
for node in "${KATA_NODES[@]}"; do
  wait_for "Kata installed on $node" 600 docker exec "$node" test -x /opt/kata/bin/cloud-hypervisor
done

# --- 3. lab guest kernel ---------------------------------------------------------
if [[ ${KATA_LAB_KERNEL:-lab} == stock ]]; then
  warn "KATA_LAB_KERNEL=stock: Kata's own guest kernel (no bonds, VLANs, GRE, WireGuard, netem or md)"
  for node in "${KATA_NODES[@]}"; do docker exec "$node" rm -f "$DROPIN_DIR/90-lab-kernel.toml"; done
else
  kfile=${KATA_LAB_KERNEL_FILE:-}
  local_build="$REPO_ROOT/tools/images/.cache/kata-kernel/$RELEASE/vmlinux"
  if [[ -z $kfile && -f $local_build ]]; then kfile=$local_build; fi
  if [[ -z $kfile ]]; then
    # The published artifact: oras (ORAS_VERSION, sha256-pinned) into the cache.
    ORAS="$MANIFEST_CACHE/oras-$ORAS_VERSION/oras"
    if [[ ! -x $ORAS ]]; then
      fetch_pinned "https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/oras_${ORAS_VERSION}_linux_amd64.tar.gz" \
        "$ORAS_TARBALL_SHA256" "$MANIFEST_CACHE/oras_${ORAS_VERSION}_linux_amd64.tar.gz"
      mkdir -p "${ORAS%/*}"; tar -xzf "$MANIFEST_CACHE/oras_${ORAS_VERSION}_linux_amd64.tar.gz" -C "${ORAS%/*}" oras
    fi
    ref="$KATA_LAB_KERNEL_REPO:$RELEASE"
    dest="$MANIFEST_CACHE/kata-lab-kernel-$RELEASE"
    log "pulling the lab guest kernel $ref"
    digest=$("$ORAS" resolve "$ref") || die "cannot resolve $ref (not published yet? build it: task image:build:kata-kernel)"
    rm -rf "$dest"; mkdir -p "$dest"
    "$ORAS" pull -o "$dest" "$KATA_LAB_KERNEL_REPO@$digest" >/dev/null || die "oras pull $ref failed"
    kfile="$dest/vmlinux"
    if [[ -z $KATA_LAB_KERNEL_SHA256 ]]; then
      COSIGN="$MANIFEST_CACHE/cosign-$COSIGN_V3_VERSION"
      fetch_pinned "https://github.com/sigstore/cosign/releases/download/${COSIGN_V3_VERSION}/cosign-linux-amd64" \
        "$COSIGN_V3_SHA256" "$COSIGN"
      chmod 0755 "$COSIGN"
      "$COSIGN" verify "$KATA_LAB_KERNEL_REPO@$digest" \
        --certificate-oidc-issuer https://token.actions.githubusercontent.com \
        --certificate-identity-regexp '^https://github\.com/thecorporatetractor/cloudtrain/\.github/workflows/kata-kernel\.yml@refs/(heads/main|tags/v.+)$' >/dev/null \
        || die "no valid kata-kernel workflow signature on $ref@$digest"
      log "ok: $ref@$digest signed by the kata-kernel workflow"
    fi
  fi
  [[ -s $kfile ]] || die "lab guest kernel $kfile not found"
  sum=$(sha256sum "$kfile" | cut -d' ' -f1)
  if [[ -n $KATA_LAB_KERNEL_SHA256 && $sum != "$KATA_LAB_KERNEL_SHA256" ]]; then
    die "lab guest kernel $kfile sha256 $sum != KATA_LAB_KERNEL_SHA256 $KATA_LAB_KERNEL_SHA256"
  fi
  dropin=$(printf '# CloudTrain lab guest kernel %s (deploy/scripts/kata-up.sh, docs/kata-spike.md)\n[hypervisor.clh]\nkernel = "%s/vmlinux-%s"\n' "$RELEASE" "$KATA_DIR" "$RELEASE")
  for node in "${KATA_NODES[@]}"; do
    if [[ $(docker exec "$node" sh -c "sha256sum $KATA_DIR/vmlinux-$RELEASE 2>/dev/null | cut -d' ' -f1") != "$sum" ]]; then
      docker cp -q "$kfile" "$node:$KATA_DIR/vmlinux-$RELEASE"
    fi
    docker exec -i "$node" sh -c "mkdir -p $DROPIN_DIR && cat > $DROPIN_DIR/90-lab-kernel.toml" <<<"$dropin"
  done
  log "ok: lab guest kernel $RELEASE (sha256 ${sum:0:12}) on ${KATA_NODES[*]}"
fi

# --- 4. probe: a pod boots in the RuntimeClass with the expected kernel -------------
want=$RELEASE; [[ ${KATA_LAB_KERNEL:-lab} == stock ]] && want=""
PROBE_IMAGE=$(yq -r '.images["nettools:1"].image' "$REPO_ROOT/deploy/images/catalog.yaml")
docker image inspect "$PROBE_IMAGE" >/dev/null 2>&1 || die "probe image $PROBE_IMAGE not in the local Docker (task image:netdev)"
load_image "$PROBE_IMAGE" "${KATA_NODES[@]}"
k delete pod -n default kata-probe --ignore-not-found --wait=true >/dev/null
k apply -f - >/dev/null <<Y
apiVersion: v1
kind: Pod
metadata: {name: kata-probe, namespace: default, labels: {app.kubernetes.io/name: kata-probe}}
spec:
  runtimeClassName: $KATA_RUNTIME_CLASS
  restartPolicy: Never
  automountServiceAccountToken: false
  terminationGracePeriodSeconds: 1
  containers:
    - name: probe
      image: $PROBE_IMAGE
      imagePullPolicy: IfNotPresent
      command: [sh, -c, 'uname -r; ip link add ct-b type bond && ip link del ct-b && echo bond-ok; sleep 2']
      securityContext: {capabilities: {add: [NET_ADMIN]}}
      resources: {limits: {cpu: 500m, memory: 256Mi}}
Y
wait_for "probe pod in $KATA_RUNTIME_CLASS finished" 300 sh -c "kubectl --context $KUBECONTEXT -n default get pod kata-probe -o jsonpath='{.status.phase}' | grep -qx Succeeded"
out=$(k -n default logs kata-probe)
k delete pod -n default kata-probe --wait=false >/dev/null
got=$(head -1 <<<"$out")
[[ $got != "$(docker exec "${KATA_NODES[0]}" uname -r)" ]] || die "probe pod runs on the node kernel ($got): $KATA_RUNTIME_CLASS is not a VM"
if [[ -n $want ]]; then
  [[ $got == "$want" ]] || die "probe pod booted kernel $got, want the lab kernel $want"
  grep -qx bond-ok <<<"$out" || die "lab kernel $got cannot create a bond: $out"
fi
log "ok: $KATA_RUNTIME_CLASS boots guest kernel $got"
