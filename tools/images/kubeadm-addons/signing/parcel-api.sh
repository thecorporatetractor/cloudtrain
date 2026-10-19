#!/bin/bash
# parcel-api.sh <dir with cosign-layout.py>: runs INSIDE the guest (guest-kubeadm-addons.sh)
# with containerd running and docker.io/library/busybox:1.37 in its k8s.io namespace.
#
# Signed-image fixture of xks-signature-verify (and any image-signing lab): three builds
# of registry.quillmoor.example/parcel/api (tags blue, green, amber; busybox httpd on
# :8080, each with its own content, so each has its own digest), stored
#   - as OCI layouts in cosign's `cosign save` format: /opt/qm-signing/parcel-api-<tag>
#   - in containerd (k8s.io, CRI-managed), so Pods run them with no registry
# green is signed with the release key (/opt/qm-signing/release.pub), amber with a key
# nobody publishes, blue is unsigned. So exactly one build passes
#   cosign verify --key /opt/qm-signing/release.pub --insecure-ignore-tlog --local-image <layout>
# Both private keys exist only during the build.
set -euxo pipefail
HERE=$1
D=/opt/qm-signing REPO=registry.quillmoor.example/parcel/api
W=$(mktemp -d)
install -d -m 0755 "$D"
ctr -n k8s.io images export --platform linux/amd64 "$W/busybox.tar" docker.io/library/busybox:1.37
BASE=$(buildah pull -q "oci-archive:$W/busybox.tar")
openssl ecparam -name prime256v1 -genkey -noout -out "$W/release.key"
openssl ecparam -name prime256v1 -genkey -noout -out "$W/other.key"
openssl ec -in "$W/release.key" -pubout -out "$D/release.pub"
for tag in blue green amber; do
  img=$REPO:$tag
  mkdir -p "$W/$tag"
  printf 'parcel-api build %s\n' "$tag" > "$W/$tag/index.html"
  c=$(buildah from -q "$BASE")
  buildah copy -q "$c" "$W/$tag/index.html" /srv/parcel/index.html
  buildah config --port 8080 --workingdir /srv/parcel --cmd '["httpd","-f","-v","-p","8080","-h","/srv/parcel"]' \
    --label org.opencontainers.image.title=parcel-api --label org.opencontainers.image.version="$tag" "$c"
  buildah commit -q --format oci --rm "$c" "$img" >/dev/null
  rm -rf "${D:?}/parcel-api-$tag"
  buildah push -q "$img" "oci:$D/parcel-api-$tag:$img"
  # containerd gets the same manifest (same digest) before the signature is added
  tar -C "$D/parcel-api-$tag" -cf "$W/$tag.tar" .
  ctr -n k8s.io images import --platform linux/amd64 "$W/$tag.tar" >/dev/null
  ctr -n k8s.io images ls -q | grep -qx "$img" || { echo "containerd did not import $img"; exit 1; }
  ctr -n k8s.io images label "$img" io.cri-containerd.image=managed >/dev/null
  buildah rmi -f "$img" >/dev/null
  case $tag in
    green) python3 "$HERE/cosign-layout.py" "$D/parcel-api-$tag" "$img" "$W/release.key" ;;
    amber) python3 "$HERE/cosign-layout.py" "$D/parcel-api-$tag" "$img" "$W/other.key" ;;
    *)     python3 "$HERE/cosign-layout.py" "$D/parcel-api-$tag" "$img" ;;
  esac
done
buildah rmi -f "$BASE" >/dev/null
chmod -R a+rX "$D"
# exactly green verifies, offline
for tag in blue green amber; do
  if cosign verify --key "$D/release.pub" --insecure-ignore-tlog --local-image "$D/parcel-api-$tag" >/dev/null 2>&1; then
    echo "$tag"
  fi
done > "$W/verified"
[ "$(cat "$W/verified")" = green ] || { echo "expected only green to verify, got: $(tr '\n' ' ' < "$W/verified")"; exit 1; }
rm -rf "$W"
