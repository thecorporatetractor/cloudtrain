#!/usr/bin/env python3
"""cosign-layout.py <oci-layout-dir> <image-ref> [<ec-private-key.pem>]

Turns an OCI image layout with exactly one image (as `buildah push <img> oci:<dir>` writes
it) into the layout `cosign save` produces, so `cosign verify --local-image <dir>` reads it:
the image descriptor gets the annotation kind=dev.cosignproject.cosign/image and, with a
key, a signature image (kind=dev.cosignproject.cosign/sigs) is added whose one layer is the
simple-signing payload for the image's manifest digest, signed with that ECDSA P-256 key
(sha256, ASN.1 DER, base64 in dev.cosignproject.cosign/signature), which is what
`cosign sign --key` stores. No key: the layout carries no signature at all.
Build-time only (guest-kubeadm-addons.sh); needs openssl.
"""
import base64
import hashlib
import json
import os
import subprocess
import sys

OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"


def main() -> None:
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    layout, ref = sys.argv[1], sys.argv[2]
    key = sys.argv[3] if len(sys.argv) == 4 else None
    with open(os.path.join(layout, "index.json")) as f:
        idx = json.load(f)
    if len(idx.get("manifests", [])) != 1:
        sys.exit(f"{layout}: expected exactly one manifest in index.json")
    image = idx["manifests"][0]
    if image.get("mediaType") != OCI_MANIFEST:
        sys.exit(f"{layout}: not a single OCI image manifest ({image.get('mediaType')})")
    image.setdefault("annotations", {})["kind"] = "dev.cosignproject.cosign/image"

    def put(blob: bytes) -> str:
        digest = hashlib.sha256(blob).hexdigest()
        with open(os.path.join(layout, "blobs", "sha256", digest), "wb") as f:
            f.write(blob)
        return "sha256:" + digest

    def dumps(obj) -> bytes:
        return json.dumps(obj, separators=(",", ":")).encode()

    if key:
        payload = dumps({
            "critical": {
                "identity": {"docker-reference": ref.rsplit(":", 1)[0] if "/" in ref else ref},
                "image": {"docker-manifest-digest": image["digest"]},
                "type": "cosign container image signature",
            },
            "optional": None,
        })
        sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key], input=payload,
                             capture_output=True, check=True).stdout
        payload_digest = put(payload)
        config = dumps({
            "architecture": "", "created": "0001-01-01T00:00:00Z", "os": "", "config": {},
            "history": [{"created": "0001-01-01T00:00:00Z"}],
            "rootfs": {"type": "layers", "diff_ids": [payload_digest]},
        })
        manifest = dumps({
            "schemaVersion": 2,
            "mediaType": OCI_MANIFEST,
            "config": {"mediaType": "application/vnd.oci.image.config.v1+json",
                       "size": len(config), "digest": put(config)},
            "layers": [{
                "mediaType": "application/vnd.dev.cosign.simplesigning.v1+json",
                "size": len(payload), "digest": payload_digest,
                "annotations": {"dev.cosignproject.cosign/signature": base64.b64encode(sig).decode()},
            }],
        })
        idx["manifests"].append({"mediaType": OCI_MANIFEST, "size": len(manifest), "digest": put(manifest),
                                 "annotations": {"kind": "dev.cosignproject.cosign/sigs"}})
    with open(os.path.join(layout, "index.json"), "w") as f:
        json.dump(idx, f)
    print(f"{layout}: {image['digest']} {'signed' if key else 'unsigned'}")


if __name__ == "__main__":
    main()
