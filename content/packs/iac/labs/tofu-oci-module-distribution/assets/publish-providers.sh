#!/bin/sh
# Publishes the providers the inland stack needs into the workstation's OCI registry
# (ct-oci, https://localhost:5000) in OpenTofu's provider-mirror layout:
# localhost:5000/opentofu-providers/<namespace>/<type>:<version>, an index manifest
# (artifactType application/vnd.opentofu.provider) over one linux/amd64 manifest whose
# only layer is the provider's zip package. Idempotent.
set -eu
ct-oci start
pub() { # pub <namespace> <type> <version>
  ref=localhost:5000/opentofu-providers/$1/$2:$3
  oras manifest fetch --plain-http=false "$ref" >/dev/null 2>&1 && return 0
  w=$(mktemp -d)
  src=/opt/cloudtrain/providers/registry.opentofu.org/$1/$2/$3/linux_amd64
  z=$w/terraform-provider-$2_$3_linux_amd64.zip
  (cd "$src" && python3 -m zipfile -c "$z" *)
  (cd "$w" && oras push --artifact-type application/vnd.opentofu.provider-target --artifact-platform linux/amd64 \
      --oci-layout layout:linux_amd64 "$(basename "$z"):archive/zip" >/dev/null \
    && oras manifest index create --artifact-type=application/vnd.opentofu.provider --oci-layout "layout:$3" linux_amd64 >/dev/null \
    && oras cp --to-plain-http=false --from-oci-layout "layout:$3" "$ref" >/dev/null)
  rm -rf "$w"
}
pub hashicorp local 2.9.1
