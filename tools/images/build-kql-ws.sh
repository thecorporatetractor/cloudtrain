#!/usr/bin/env bash
# Build the KQL workstation image (tools/images/kql-ws, catalog ref kql-ws:1) and load it
# into the dev cluster (LOAD_INTO_KIND=1, the default). The build compiles KustoLoco and
# Kusto.Language and runs KustoLoco's tests (RUN_TESTS=0 skips them); run it through the
# heavy slot: tools/slots/run.sh build -- bash tools/images/build-kql-ws.sh
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need yq
HERE="$REPO_ROOT/tools/images"
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
want=$(yq -r '.images["kql-ws:1"].image' "$CATALOG")
[[ $want == "$KQL_WS_IMAGE" ]] || die "catalog kql-ws:1 is $want, expected $KQL_WS_IMAGE"
ls "$HERE"/kql-ws/patches/*.patch >/dev/null 2>&1 || die "no patches in tools/images/kql-ws/patches"
old=$(docker image inspect -f '{{.Id}}' "$KQL_WS_IMAGE" 2>/dev/null || true)
docker build -q -t "$KQL_WS_IMAGE" --label "dev.cloudtrain.catalog-ref=kql-ws:1" \
  --build-arg UBUNTU_APT_SNAPSHOT="$UBUNTU_APT_SNAPSHOT" \
  --build-arg KUSTOLOCO_VERSION="$KUSTOLOCO_VERSION" --build-arg KUSTOLOCO_COMMIT="$KUSTOLOCO_COMMIT" \
  --build-arg KUSTO_LANGUAGE_COMMIT="$KUSTO_LANGUAGE_COMMIT" \
  --build-arg AZURE_SENTINEL_COMMIT="$AZURE_SENTINEL_COMMIT" \
  --build-arg AZURE_SENTINEL_LICENSE_SHA256="$AZURE_SENTINEL_LICENSE_SHA256" \
  --build-arg RUN_TESTS="${RUN_TESTS:-1}" \
  "$HERE/kql-ws" >/dev/null
new=$(docker image inspect -f '{{.Id}}' "$KQL_WS_IMAGE")
[[ -n $old && $old != "$new" ]] && docker rmi "$old" >/dev/null 2>&1 || true
docker images "$KQL_WS_IMAGE" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
log "built $KQL_WS_IMAGE"
if [[ ${LOAD_INTO_KIND:-1} == 1 ]] && cluster_exists; then bash "$HERE/load.sh" kql-ws; fi
