#!/usr/bin/env bash
# Build the IaC workstation image (tools/images/iac) and optionally load it into the dev
# cluster (LOAD_INTO_KIND=1, the default).
#   build-iac-ws.sh [terraform|tofu|all]   default: all
# terraform -> ${IAC_WS_IMAGE_REPO}:1.15-terraform  (catalog ref terraform-ws:1.15)
# tofu      -> ${IAC_WS_IMAGE_REPO}:1.15-tofu       (deploy/images/overlays/iac-opentofu.yaml
#              maps terraform-ws:1.15 to it for tenants that must not get Terraform)
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker; need yq
HERE="$REPO_ROOT/tools/images"
CATALOG="$REPO_ROOT/deploy/images/catalog.yaml"
OVERLAY="$REPO_ROOT/deploy/images/overlays/iac-opentofu.yaml"
flavours=("${@:-all}"); [[ ${flavours[0]} == all ]] && flavours=(terraform tofu)
for f in "${flavours[@]}"; do
  case $f in
    terraform) tag="$IAC_WS_IMAGE_REPO:1.15-terraform"; want=$(yq -r '.images["terraform-ws:1.15"].image' "$CATALOG") ;;
    tofu)      tag="$IAC_WS_IMAGE_REPO:1.15-tofu";      want=$(yq -r '.images["terraform-ws:1.15"].image' "$OVERLAY") ;;
    *) die "unknown flavour $f (terraform|tofu|all)" ;;
  esac
  [[ $want == "$tag" ]] || die "catalog image for $f is $want, expected $tag"
  docker build -q -t "$tag" \
    --label "dev.cloudtrain.catalog-ref=terraform-ws:1.15" --label "dev.cloudtrain.iac-cli=$f" \
    --build-arg IAC_CLI="$f" \
    --build-arg UBUNTU_APT_SNAPSHOT="$UBUNTU_APT_SNAPSHOT" \
    --build-arg KUBECTL_VERSION="$LAB_K8S_VERSION" \
    --build-arg HELM_VERSION="$HELM_VERSION" --build-arg HELM_TARBALL_SHA256="$HELM_TARBALL_SHA256" \
    --build-arg YQ_VERSION="$YQ_VERSION" --build-arg YQ_BINARY_SHA256="$YQ_BINARY_SHA256" \
    --build-arg TERRAFORM_VERSION="$TERRAFORM_VERSION" --build-arg TERRAFORM_ZIP_SHA256="$TERRAFORM_ZIP_SHA256" \
    --build-arg TOFU_VERSION="$TOFU_VERSION" --build-arg TOFU_ZIP_SHA256="$TOFU_ZIP_SHA256" \
    "$HERE/iac" >/dev/null
  docker images "$tag" --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Size}}'
  log "built $tag"
  if [[ "${LOAD_INTO_KIND:-1}" == 1 ]] && cluster_exists; then
    bash "$HERE/load.sh" "iac-ws-$f"
  fi
done
