#!/usr/bin/env bash
# Build the Ansible control node image (tools/images/ansible, catalog ref ansible-ctl:2.21)
# and load it into the dev cluster (LOAD_INTO_KIND=1, the default). Run it through the heavy
# slot: tools/slots/run.sh build -- bash tools/images/build-ansible-ctl.sh
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need yq
HERE="$REPO_ROOT/tools/images"
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
want=$(yq -r '.images["ansible-ctl:2.21"].image' "$CATALOG")
[[ $want == "$ANSIBLE_CTL_IMAGE" ]] || die "catalog ansible-ctl:2.21 is $want, expected $ANSIBLE_CTL_IMAGE"
# The baked collections must be the mirror's artifacts (same file, same sha256).
while read -r f sha; do
  grep -qxF "$f $sha" "$REPO_ROOT/tools/mirrors/lock/ansible.lock" || die "collections.lock: $f $sha is not in tools/mirrors/lock/ansible.lock"
done < <(grep -v '^#' "$HERE/ansible/collections.lock" | grep .)
old=$(docker image inspect -f '{{.Id}}' "$ANSIBLE_CTL_IMAGE" 2>/dev/null || true)
docker build -q -t "$ANSIBLE_CTL_IMAGE" --label "dev.cloudtrain.catalog-ref=ansible-ctl:2.21" \
  --build-arg UBUNTU_APT_SNAPSHOT="$UBUNTU_APT_SNAPSHOT" \
  --build-arg ANSIBLE_CORE_VERSION="$ANSIBLE_CORE_VERSION" \
  "$HERE/ansible" >/dev/null
new=$(docker image inspect -f '{{.Id}}' "$ANSIBLE_CTL_IMAGE")
[[ -n $old && $old != "$new" ]] && docker rmi "$old" >/dev/null 2>&1 || true
docker images "$ANSIBLE_CTL_IMAGE" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
log "built $ANSIBLE_CTL_IMAGE"
if [[ ${LOAD_INTO_KIND:-1} == 1 ]] && cluster_exists; then bash "$HERE/load.sh" ansible-ctl; fi
