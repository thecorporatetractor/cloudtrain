#!/usr/bin/env bash
# Install the pinned CLIs from deploy/versions.env into ~/.local/bin (no sudo).
# Skips a tool whose installed version already matches the pin.
source "$(dirname "$0")/lib.sh"
BIN="$HOME/.local/bin"
mkdir -p "$BIN"
need curl

# fetch <name> <url>
fetch() {
  local tmp; tmp=$(mktemp)
  curl -fsSL --retry 3 -o "$tmp" "$2" || { rm -f "$tmp"; die "download failed: $2"; }
  install -m 0755 "$tmp" "$BIN/$1"; rm -f "$tmp"
  log "installed $1 -> $BIN/$1"
}
has() { command -v "$1" >/dev/null 2>&1 && "$@" 2>/dev/null | grep -q -- "$VER"; }

VER=${KIND_VERSION};     has kind version            || fetch kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"
VER=${VCLUSTER_VERSION#v}; has vcluster version      || fetch vcluster "https://github.com/loft-sh/vcluster/releases/download/${VCLUSTER_VERSION}/vcluster-linux-amd64"
VER=${VIRTCTL_VERSION};  has virtctl version --client || fetch virtctl "https://github.com/kubevirt/kubevirt/releases/download/${VIRTCTL_VERSION}/virtctl-${VIRTCTL_VERSION}-linux-amd64"
VER=${JQ_VERSION};       has jq --version            || fetch jq "https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/jq-linux-amd64"
VER=${YQ_VERSION};       has yq --version            || fetch yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_amd64"

VER=${TASK_VERSION#v}
if ! has task --version; then
  tmp=$(mktemp -d)
  curl -fsSL --retry 3 "https://github.com/go-task/task/releases/download/${TASK_VERSION}/task_linux_amd64.tar.gz" | tar -xz -C "$tmp" task
  install -m 0755 "$tmp/task" "$BIN/task"; rm -rf "$tmp"
  log "installed task -> $BIN/task"
fi

for t in docker kubectl helm; do
  command -v "$t" >/dev/null || warn "'$t' not found: install it (kubectl/helm can go in $BIN too)"
done
log "tools ready: kind $(kind version | awk '{print $2}'), vcluster $(vcluster version 2>/dev/null | awk '{print $3}'), virtctl ${VIRTCTL_VERSION}, task $(task --version)"
