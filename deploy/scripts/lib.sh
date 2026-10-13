# shellcheck shell=bash
# Shared helpers for deploy/ and tools/images/ scripts.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT
# shellcheck source=../versions.env
set -a; source "$REPO_ROOT/deploy/versions.env"; set +a
export PATH="$HOME/.local/bin:$PATH"
export KUBECONTEXT="kind-${CLUSTER_NAME}"

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[1;33m[%s] WARN\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[1;31m[%s] ERROR\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# kubectl always pinned to the dev cluster context, never the user's current one.
k() { kubectl --context "$KUBECONTEXT" "$@"; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing '$1' (run: task tools)"; }

cluster_exists() { kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; }

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
