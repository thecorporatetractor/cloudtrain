#!/usr/bin/env bash
# Deploy the shared offline mirrors into the dev cluster (namespace MIRROR_NAMESPACE):
# content (dnf/apt/PyPI/Ansible, nginx), zot registry mirror (allowlist = catalog
# workloadImages + MIRROR_EXTRA_IMAGES), Gitea. Idempotent.
#   1. packages tools/images/.cache/mirror/<MIRROR_SNAPSHOT> as MIRROR_CONTENT_IMAGE
#      (unless it exists; run tools/mirrors/build-content.sh first) and loads it into kind
#   2. renders deploy/mirrors/mirrors.yaml and applies it
#   3. creates the registry admin htpasswd and the Gitea admin once (Secret mirror-admin)
#   4. smoke test from a pod labelled like a lab pod; a pod without the label must NOT
#      get through (NetworkPolicy)
# Usage: mirrors-up.sh [--no-test]
source "$(dirname "$0")/lib.sh"
need docker; need kubectl; need yq; need jq
NS=$MIRROR_NAMESPACE
CONTENT="$REPO_ROOT/tools/images/.cache/mirror/$MIRROR_SNAPSHOT"
T0=$SECONDS

# --- 1. content image -------------------------------------------------------------------
if ! docker image inspect "$MIRROR_CONTENT_IMAGE" >/dev/null 2>&1; then
  [[ -f $CONTENT/SNAPSHOT ]] || die "no mirror content in $CONTENT (run: task mirror:content)"
  log "packaging $MIRROR_CONTENT_IMAGE ($(du -sh "$CONTENT" | cut -f1))"
  ctx=$(mktemp -d); trap 'rm -rf "$ctx"' EXIT
  cp "$REPO_ROOT/tools/mirrors/content/"* "$ctx/"
  # hard links: no second copy of the content on disk
  cp -al "$CONTENT" "$ctx/content" 2>/dev/null || cp -a "$CONTENT" "$ctx/content"
  rm -f "$ctx/content/"*/.wanted
  docker build -q -t "$MIRROR_CONTENT_IMAGE" --build-arg NGINX_IMAGE="$NGINX_UNPRIVILEGED_IMAGE" "$ctx" >/dev/null
fi
bash "$REPO_ROOT/tools/images/load.sh" mirror
for img in "$ZOT_IMAGE" "$GITEA_IMAGE"; do
  for node in $(kind get nodes --name "$CLUSTER_NAME"); do
    docker exec "$node" crictl inspecti "$img" >/dev/null 2>&1 || docker exec "$node" crictl pull "$img" >/dev/null
  done
done

# --- 2. manifests -----------------------------------------------------------------------
# zot sync allowlist: one {prefix, tags.regex} per catalog workload image (+ extras).
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
mapfile -t imgs < <({ yq -r '.workloadImages[]' "$CATALOG"; tr ' ' '\n' <<<"${MIRROR_EXTRA_IMAGES:-}"; } | grep .)
ZOT_ALLOWLIST=$(for i in "${imgs[@]}"; do
  repo=${i%:*}; tag=${i##*:}; [[ $repo == */* ]] || repo="library/$repo"
  jq -nc --arg p "$repo" --arg t "^$(sed 's/[.]/\\./g' <<<"$tag")\$" '{prefix: $p, tags: {regex: $t}}'
done | jq -sc .)
export ZOT_ALLOWLIST MIRROR_NAMESPACE MIRROR_CONTENT_IMAGE ZOT_IMAGE GITEA_IMAGE
ZOT_CONFIG_HASH=$(sha256sum <<<"$ZOT_ALLOWLIST" | cut -c1-12); export ZOT_CONFIG_HASH
k get ns "$NS" >/dev/null 2>&1 || k create ns "$NS" >/dev/null
if ! k -n "$NS" get secret mirror-admin >/dev/null 2>&1; then
  pw=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
  # zot accepts bcrypt htpasswd entries; httpd:2.4-alpine (a catalog workload image) has htpasswd
  bc=$(docker run --rm "httpd:2.4-alpine@$(grep '^docker.io/library/httpd:2.4-alpine@' "$REPO_ROOT/tools/images/lock/workloads.lock" | cut -d@ -f2)" htpasswd -nbB admin "$pw" | head -1)
  [[ $bc == admin:* ]] || die "could not generate the registry htpasswd"
  k -n "$NS" create secret generic mirror-admin --from-literal=username=admin --from-literal=password="$pw" >/dev/null
  k -n "$NS" create secret generic registry-htpasswd --from-literal=htpasswd="$bc" >/dev/null
fi
envsubst '${MIRROR_NAMESPACE} ${MIRROR_CONTENT_IMAGE} ${ZOT_IMAGE} ${GITEA_IMAGE} ${ZOT_ALLOWLIST} ${ZOT_CONFIG_HASH}' \
  < "$REPO_ROOT/deploy/mirrors/mirrors.yaml" | k apply -f - >/dev/null
for d in mirror registry git; do
  wait_for "$NS/$d rollout" 300 k -n "$NS" rollout status deploy/$d --timeout=5s
done
# Gitea admin (once): the same password as the registry admin.
if ! k -n "$NS" exec deploy/git -- gitea admin user list 2>/dev/null | grep -qw cloudtrain; then
  pw=$(k -n "$NS" get secret mirror-admin -o jsonpath='{.data.password}' | base64 -d)
  k -n "$NS" exec deploy/git -- gitea admin user create --admin --username cloudtrain --password "$pw" \
    --email admin@cloudtrain.invalid --must-change-password=false >/dev/null
  log "Gitea admin 'cloudtrain' created (password: secret $NS/mirror-admin)"
fi

# --- 4. smoke test ----------------------------------------------------------------------
if [[ ${1:-} != --no-test ]]; then
  bash "$REPO_ROOT/deploy/scripts/mirrors-test.sh"
fi
log "mirrors up in $((SECONDS - T0))s: http://mirror.$NS.svc  registry.$NS.svc:5000  http://git.$NS.svc:3000"
