#!/usr/bin/env bash
# Build the netdev lab images and load them into the dev cluster:
#   cloudtrain/frr:10       FRRouting 10 router (driver: netdev)
#   cloudtrain/nettools:1   network-lab host + link sidecar (iproute2, ping, traceroute, tcpdump, iperf3)
# Usage: build.sh [frr|nettools]...   (default: both). LOAD_INTO_KIND=0 skips kind load.
source "$(dirname "$0")/../../../deploy/scripts/lib.sh"
need docker
DIR="$REPO_ROOT/tools/images/netdev"
declare -A TAGS=([frr]="cloudtrain/frr:10" [nettools]="cloudtrain/nettools:1")
targets=("$@"); ((${#targets[@]})) || targets=(frr nettools)
for t in "${targets[@]}"; do
  tag=${TAGS[$t]:-}; [[ -n $tag ]] || die "unknown image '$t' (frr|nettools)"
  docker build -q -t "$tag" "$DIR/$t" >/dev/null || die "build $tag failed"
  log "built $tag"
  if [[ "${LOAD_INTO_KIND:-1}" == 1 ]] && cluster_exists; then
    kind load docker-image --name "$CLUSTER_NAME" "$tag" >/dev/null && log "loaded $tag into $CLUSTER_NAME"
  fi
done
