# shellcheck shell=bash
# Shared helpers for deploy/ and tools/images/ scripts.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT
# shellcheck source=../versions.env
set -a; source "$REPO_ROOT/deploy/versions.env"; set +a
# A key defined twice silently takes the later value (a docker-vm build once fetched cosign v3
# against the v2 checksum): refuse that.
_dup=$(grep -oE '^[A-Z0-9_]+=' "$REPO_ROOT/deploy/versions.env" | sort | uniq -d | tr -d '=' | tr '\n' ' ')
[[ -z $_dup ]] || { printf 'deploy/versions.env defines these keys more than once: %s\n' "$_dup" >&2; exit 1; }
unset _dup
export PATH="$HOME/.local/bin:$PATH"
# KIND_PROFILE picks the cluster flavour (docs/any-kubernetes.md, section 6):
#   kubeovn-primary (default): Kube-OVN is the primary CNI (vCenter / bare metal model)
#   managed-cni: Cilium is the primary CNI (stands in for a managed cloud's CNI),
#     Kube-OVN runs non-primary behind Multus, the orchestrator uses --network-mode=secondary.
#     Its own cluster (default name cloudtrain-mcni), so it never touches cloudtrain-dev.
#   managed-cni-calico: as managed-cni with Calico (VXLAN, deploy/calico/) as the primary CNI.
#     Cluster cloudtrain-calico.
#   kata: kubeovn-primary plus Kata Containers (Cloud Hypervisor on runtime-rs, the lab guest
#     kernel) for tier-B sandboxes (deploy/scripts/kata-up.sh, docs/kata-spike.md). Cluster
#     cloudtrain-kata; the orchestrator gets --sandboxes B=$KATA_RUNTIME_CLASS.
# CT_CLUSTER_NAME overrides the cluster name of any profile.
export KIND_PROFILE=${KIND_PROFILE:-kubeovn-primary}
case $KIND_PROFILE in
  kubeovn-primary) ;;
  managed-cni) CLUSTER_NAME=cloudtrain-mcni ;;
  managed-cni-calico) CLUSTER_NAME=cloudtrain-calico ;;
  kata) CLUSTER_NAME=cloudtrain-kata ;;
  *) printf 'unknown KIND_PROFILE %s (kubeovn-primary, managed-cni, managed-cni-calico or kata)\n' "$KIND_PROFILE" >&2; exit 2 ;;
esac
# Profiles where another CNI owns eth0 and Kube-OVN is secondary behind Multus.
SECONDARY_PROFILE=0
case $KIND_PROFILE in managed-cni | managed-cni-calico) SECONDARY_PROFILE=1 ;; esac
export SECONDARY_PROFILE
# Profiles with Kata Containers (vhost_vsock on the host, kata-up.sh).
KATA_PROFILE=0
[[ $KIND_PROFILE == kata ]] && KATA_PROFILE=1
export KATA_PROFILE
export CLUSTER_NAME=${CT_CLUSTER_NAME:-$CLUSTER_NAME}
export KUBECONTEXT="kind-${CLUSTER_NAME}"

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[1;33m[%s] WARN\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[1;31m[%s] ERROR\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# kubectl always pinned to the dev cluster context, never the user's current one.
k() { kubectl --context "$KUBECONTEXT" "$@"; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing '$1' (run: task tools)"; }

cluster_exists() { kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; }

# fetch_pinned <url> <sha256> <dest>: download once into a cache and refuse any
# file whose sha256 differs from the pinned one (versions.env).
fetch_pinned() {
  local url=$1 sum=$2 dest=$3
  if ! echo "$sum  $dest" | sha256sum -c --status 2>/dev/null; then
    mkdir -p "$(dirname "$dest")"
    curl -fsSL --retry 3 -o "$dest.tmp" "$url" || die "download failed: $url"
    echo "$sum  $dest.tmp" | sha256sum -c --status \
      || die "sha256 mismatch for $url (got $(sha256sum "$dest.tmp" | cut -d' ' -f1), pinned $sum)"
    mv "$dest.tmp" "$dest"
  fi
}
# shellcheck disable=SC2034 # used by the scripts that source lib.sh
MANIFEST_CACHE="$REPO_ROOT/deploy/.cache"

# wait_for <description> <timeout-seconds> <command...>
wait_for() {
  local desc=$1 timeout=$2; shift 2
  local start=$SECONDS
  until "$@" >/dev/null 2>&1; do
    (( SECONDS - start > timeout )) && die "timed out after ${timeout}s waiting for: $desc"
    sleep 3
  done
  log "ok: $desc ($((SECONDS - start))s)"
}

# image_fqn <ref>: the fully qualified name containerd stores (busybox:1.37 ->
# docker.io/library/busybox:1.37, cloudtrain/x:1 -> docker.io/cloudtrain/x:1).
image_fqn() {
  local ref=$1 first=${1%%/*}
  if [[ $ref != */* ]]; then echo "docker.io/library/$ref"
  elif [[ $first == *.* || $first == *:* || $first == localhost ]]; then echo "$ref"
  else echo "docker.io/$ref"; fi
}

# IMAGE_SOURCE=local (default) loads lab images from the local Docker store (`kind load`,
# built by tools/images/build*.sh). IMAGE_SOURCE=ghcr pulls the publishable ones from the
# registry CI publishes them to instead (.github/workflows/images.yml and vm-images.yml),
# inside each node's containerd, and tags them with the catalog name, so the catalog and
# the orchestrator stay unchanged. Images CI does not publish (Terraform, upstream
# images) still come from the local store. GHCR_REGISTRY (default
# ghcr.io/thecorporatetractor/cloudtrain), GHCR_TAG (default main; a sha-<commit>, a
# catalog tag or a sha256:<digest> to pin) and, for a private registry, GHCR_USER +
# GHCR_TOKEN (read:packages) tune it. See docs/deploy.md, "Dev clusters: pull from GHCR".
image_source() {
  case ${IMAGE_SOURCE:-local} in local|ghcr) echo "${IMAGE_SOURCE:-local}" ;;
    *) die "IMAGE_SOURCE must be local or ghcr (got '$IMAGE_SOURCE')" ;; esac
}

# ghcr_publish_name <image>: the GHCR package name of a catalog image (or overlay entry)
# that CI publishes; fails for images it does not.
ghcr_publish_name() {
  local n
  n=$(IMG=$1 yq ea -r '[.images[] | select(.image == strenv(IMG) and .publishable == true)] | .[0] // {} |
      (.publishName // (.image // "" | sub(":[^:/]*$"; "") | sub(".*/"; "")))' \
    "$REPO_ROOT/deploy/images/catalog.yaml" "$REPO_ROOT"/deploy/images/overlays/*.yaml) || return 1
  [[ -n $n && $n != null ]] || return 1
  echo "$n"
}

# use_ghcr <image>: true when IMAGE_SOURCE=ghcr and CI publishes the image.
use_ghcr() { [[ $(image_source) == ghcr ]] && ghcr_publish_name "$1" >/dev/null 2>&1; }

# ghcr_pull_image <image> <node...>: pull the published image inside each kind node's
# containerd (this node's platform only, as load_workloads does) and tag it with the
# catalog name `image`.
ghcr_pull_image() {
  local img=$1 name ref src tag node arch fqn; shift
  name=$(ghcr_publish_name "$img") || die "$img is not published by CI"
  ref="${GHCR_REGISTRY:-ghcr.io/thecorporatetractor/cloudtrain}/$name"; tag=${GHCR_TAG:-main}
  if [[ $tag == sha256:* ]]; then src="$ref@$tag"; else src="$ref:$tag"; fi
  fqn=$(image_fqn "$img")
  for node in "$@"; do
    arch=$(node_arch "$node")
    log "pulling $src into $node (as $img)"
    docker exec "$node" ctr -n k8s.io images pull --hosts-dir /etc/containerd/certs.d --platform "linux/$arch" \
        ${GHCR_TOKEN:+--user "${GHCR_USER:?GHCR_USER is required with GHCR_TOKEN}:$GHCR_TOKEN"} "$src" >/dev/null \
      || die "pull $src on $node failed (is the package public, or GHCR_USER/GHCR_TOKEN set?)"
    docker exec "$node" ctr -n k8s.io images tag --force "$src" "$fqn" >/dev/null
    docker exec "$node" ctr -n k8s.io images label "$fqn" io.cri-containerd.image=managed >/dev/null
  done
}

# node_has_image <node> <image> [image-id]: by name via crictl, falling back to ctr. With an
# image id, the node's containerd index digest must match it as well.
node_has_image() {
  local node=$1 fqn out; fqn=$(image_fqn "$2")
  if [[ -n ${3:-} ]]; then
    out=$(docker exec "$node" ctr -n k8s.io images ls "name==$fqn" 2>/dev/null) || return 1
    [[ $out == *"$3"* ]]; return
  fi
  docker exec "$node" crictl inspecti "$fqn" >/dev/null 2>&1 \
    || [[ -n $(docker exec "$node" ctr -n k8s.io images ls -q "name==$fqn" 2>/dev/null) ]]
}

# node_arch <node>: amd64 | arm64 of the kind node container.
node_arch() {
  case $(docker exec "$1" uname -m) in x86_64) echo amd64 ;; aarch64|arm64) echo arm64 ;; *) docker exec "$1" uname -m ;; esac
}

# load_image <image> <node...>: put a local Docker image on kind nodes, only where missing.
#  - Skipped on a node that already has the same digest under that name: the RepoDigest when
#    the image has one (pulled images, and local builds with the containerd image store),
#    else Docker's image ID. A name-only check kept a rebuilt image under an unchanged tag
#    (cloudtrain/docker-vm:29) from ever reaching the nodes; `kind load`'s own check compares
#    Docker's image ID with the CRI image ID, which differ with the containerd image store.
#  - `kind load` imports with --all-platforms. With Docker's containerd image store the
#    saved archive is a multi-platform index whose other-platform layers are absent, and the
#    import fails ("content digest ...: not found"). Fallback per node: `docker save
#    --platform <node arch>` piped into `ctr images import` (no --all-platforms); then
#    `crictl pull` inside the node (public images only).
# KIND_LOAD_VERBOSE=1 logs when nothing needs loading.
# Every node is then pinned (pin_image) so kubelet image GC cannot evict the local-only image.
load_image() {
  local img=$1; shift
  _load_image "$img" "$@" || return
  pin_image "$img" "$@"
}

# pin_image <image> <node...>: label the image io.cri-containerd.pinned=pinned in containerd's
# k8s.io namespace on each node. The CRI plugin excludes pinned images from kubelet image GC,
# which otherwise deletes loaded images (imagePullPolicy IfNotPresent, not pullable) at the
# imageGCHighThresholdPercent disk mark. Idempotent (re-labelling is a no-op); a failure only
# warns, it never fails the load.
pin_image() {
  local img=$1 node fqn; shift
  fqn=$(image_fqn "$img")
  for node in "$@"; do
    docker exec "$node" ctr -n k8s.io images label "$fqn" io.cri-containerd.pinned=pinned >/dev/null 2>&1 \
      || warn "could not pin $img on $node (kubelet image GC may delete it)"
  done
  return 0
}

_load_image() {
  local img=$1 id node arch todo=() rd; shift
  id=$(docker image inspect -f '{{.Id}}' "$img") || return 1
  # A RepoDigest (pulled images, and local builds with the containerd image store) is the
  # digest the node stores: compare that, so a rebuilt image under the same tag is reloaded.
  rd=$(docker image inspect -f '{{range .RepoDigests}}{{.}} {{end}}' "$img" | awk '{print $1}')
  [[ -n $rd ]] && id=${rd#*@}
  for node in "$@"; do
    node_has_image "$node" "$img" "$id" && continue
    todo+=("$node")
  done
  ((${#todo[@]})) || { [[ ${KIND_LOAD_VERBOSE:-0} == 1 ]] && log "ok: $img already on $*"; return 0; }
  log "loading $img into ${todo[*]}"
  local nodelist; nodelist=$(printf '%s,' "${todo[@]}")
  if kind load docker-image --name "$CLUSTER_NAME" --nodes "${nodelist%,}" "$img" >/dev/null 2>&1; then return 0; fi
  warn "kind load $img failed; retrying per node with a single-platform save"
  for node in "${todo[@]}"; do
    node_has_image "$node" "$img" "$id" && continue
    arch=$(node_arch "$node")
    if docker save --platform "linux/$arch" "$img" 2>/dev/null \
        | docker exec -i "$node" ctr -n k8s.io images import --digests - >/dev/null 2>&1; then
      log "loaded $img into $node (docker save --platform linux/$arch)"; continue
    fi
    warn "single-platform import of $img into $node failed; trying crictl pull"
    docker exec "$node" crictl pull "$(image_fqn "$img")" >/dev/null 2>&1 \
      && { log "pulled $img inside $node (crictl pull)"; continue; }
    die "could not load $img into $node (kind load, docker save --platform linux/$arch and crictl pull all failed)"
  done
}
