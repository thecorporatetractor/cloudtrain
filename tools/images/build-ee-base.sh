#!/usr/bin/env bash
# Build the mirrored execution environment base (tools/images/ee-base, image $EE_BASE_IMAGE), which
# build.sh el-vm bakes into el-vm:10. Run it through the heavy slot:
#   tools/slots/run.sh build -- bash tools/images/build-ee-base.sh
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker
HERE="$REPO_ROOT/tools/images"
# The baked collection must be the mirror's artifact (same file, same sha256).
while read -r f sha; do
  grep -qxF "$f $sha" "$REPO_ROOT/tools/mirrors/lock/ansible.lock" || die "ee-base/collections.lock: $f $sha is not in tools/mirrors/lock/ansible.lock"
done < <(grep -v '^#' "$HERE/ee-base/collections.lock" | grep .)
docker build -q -t "$EE_BASE_IMAGE" \
  --build-arg ALMA_BASE_IMAGE="$ALMA_BASE_IMAGE" --build-arg ALMA_REPO="$ALMA_REPO" \
  --build-arg ANSIBLE_CORE_VERSION="$ANSIBLE_CORE_VERSION" \
  "$HERE/ee-base" >/dev/null
docker images "$EE_BASE_IMAGE" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
log "built $EE_BASE_IMAGE"
