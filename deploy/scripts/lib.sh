# shellcheck shell=bash
# Shared helpers for deploy/ and tools/images/ scripts.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT
# shellcheck source=../versions.env
set -a; source "$REPO_ROOT/deploy/versions.env"; set +a
export PATH="$HOME/.local/bin:$PATH"
# KIND_PROFILE picks the cluster flavour (docs/any-kubernetes.md, section 6):
#   kubeovn-primary (default): Kube-OVN is the primary CNI (vCenter / bare metal model)
#   managed-cni: Cilium is the primary CNI (stands in for a managed cloud's CNI),
#     Kube-OVN runs non-primary behind Multus, the orchestrator uses --network-mode=secondary.
#     Its own cluster (default name cloudtrain-mcni), so it never touches cloudtrain-dev.
# CT_CLUSTER_NAME overrides the cluster name of either profile.
export KIND_PROFILE=${KIND_PROFILE:-kubeovn-primary}
case $KIND_PROFILE in
  kubeovn-primary) ;;
  managed-cni) CLUSTER_NAME=cloudtrain-mcni ;;
  *) printf 'unknown KIND_PROFILE %s (kubeovn-primary or managed-cni)\n' "$KIND_PROFILE" >&2; exit 2 ;;
esac
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
#  - A pulled image (it has RepoDigests, so its tag is registry-owned) is skipped on a node
#    that has it by name. A locally built image is compared by Docker's index digest, because
#    `kind load` compares Docker's image ID with the CRI image ID and with the containerd
#    image store those differ, so it would re-import every time.
#  - `kind load` imports with --all-platforms. With Docker's containerd image store the
#    saved archive is a multi-platform index whose other-platform layers are absent, and the
#    import fails ("content digest ...: not found"). Fallback per node: `docker save
#    --platform <node arch>` piped into `ctr images import` (no --all-platforms); then
#    `crictl pull` inside the node (public images only).
# KIND_LOAD_VERBOSE=1 logs when nothing needs loading.
load_image() {
  local img=$1 id node arch todo=() pulled=0; shift
  id=$(docker image inspect -f '{{.Id}}' "$img") || return 1
  [[ -n $(docker image inspect -f '{{join .RepoDigests ""}}' "$img") ]] && pulled=1
  for node in "$@"; do
    if ((pulled)); then node_has_image "$node" "$img" && continue
    else node_has_image "$node" "$img" "$id" && continue; fi
    todo+=("$node")
  done
  ((${#todo[@]})) || { [[ ${KIND_LOAD_VERBOSE:-0} == 1 ]] && log "ok: $img already on $*"; return 0; }
  log "loading $img into ${todo[*]}"
  if kind load docker-image --name "$CLUSTER_NAME" --nodes "$(IFS=,; echo "${todo[*]}")" "$img" >/dev/null 2>&1; then return 0; fi
  warn "kind load $img failed; retrying per node with a single-platform save"
  for node in "${todo[@]}"; do
    if ((pulled)); then node_has_image "$node" "$img" && continue
    else node_has_image "$node" "$img" "$id" && continue; fi
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
