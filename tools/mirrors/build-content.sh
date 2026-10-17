#!/usr/bin/env bash
# Build the offline package/content mirror (MIRROR_SNAPSHOT) for Linux, automation and
# container labs:
#
#   el10/      dnf repo: packages-el10.txt + full dependency closure from the frozen
#              AlmaLinux ${ALMA_RELEASE} point release (BaseOS, AppStream, CRB); upstream RPM
#              signatures kept (clients use gpgcheck=1 with RPM-GPG-KEY-AlmaLinux-10)
#   noble/     flat apt repo: packages-noble.txt + full closure (resolved against an empty
#              dpkg status, so Essential packages are in it too) from snapshot.ubuntu.com
#              at UBUNTU_APT_SNAPSHOT; InRelease signed with the CloudTrain mirror key
#   pypi/simple/  PEP 503 index of pypi.txt + deps (cp312 manylinux wheels, sdists)
#   ansible/   collection tarballs of ansible-collections.yml (+ deps)
#   keys/      cloudtrain-mirror.gpg/.asc (apt) and RPM-GPG-KEY-AlmaLinux-10
#   SNAPSHOT, *.lock   what is in it (NEVRA / name=version / file sha256)
#
# Output: tools/images/.cache/mirror/<MIRROR_SNAPSHOT>/ (shared by the mirror content
# image and the el-vm/ubuntu-vm local repos). Runs in containers; no VM, no KVM.
# Usage: build-content.sh [el10|noble|pypi|ansible|keys ...]   (default: all)
source "$(dirname "$0")/../../deploy/scripts/lib.sh"
need docker
HERE="$REPO_ROOT/tools/mirrors"
OUT="$REPO_ROOT/tools/images/.cache/mirror/$MIRROR_SNAPSHOT"
KEYDIR="$REPO_ROOT/tools/images/.cache/mirror/signing"   # private key: local only
mkdir -p "$OUT" "$KEYDIR"
pkgs() { sed 's/#.*//' "$1" | tr -s ' \t' '\n' | grep . ; }

# --- signing key for the apt repo --------------------------------------------------------
# The private key stays in .cache (never committed); the public key is committed in
# tools/mirrors/keys/ and baked into deb-lab/ubuntu-vm. A machine without the private key
# generates a new one and the committed public key changes (visible in git diff).
build_keys() {
  if [[ ! -s $KEYDIR/secret.asc ]]; then
    log "generating CloudTrain mirror signing key"
    docker run --rm -v "$KEYDIR:/k" "$UBUNTU_BASE_IMAGE" bash -euc '
      apt-get -qq update >/dev/null && apt-get -qq install -y gnupg >/dev/null
      export GNUPGHOME=$(mktemp -d)
      gpg --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "CloudTrain lab mirror <mirror@cloudtrain.invalid>" ed25519 sign never
      gpg --batch --armor --export-secret-keys > /k/secret.asc
      gpg --batch --armor --export > /k/public.asc
      chown -R '"$(id -u):$(id -g)"' /k'
  fi
  mkdir -p "$HERE/keys" "$OUT/keys"
  cp "$KEYDIR/public.asc" "$HERE/keys/cloudtrain-mirror.asc"
  cp "$KEYDIR/public.asc" "$OUT/keys/cloudtrain-mirror.asc"
}

build_el10() {
  log "el10: AlmaLinux $ALMA_RELEASE closure of $(pkgs "$HERE/packages-el10.txt" | wc -l) packages"
  rm -rf "$OUT/el10"; mkdir -p "$OUT/el10"
  pkgs "$HERE/packages-el10.txt" > "$OUT/el10/.wanted"
  docker run --rm -v "$OUT/el10:/out" -e VAULT="$ALMA_REPO" "$ALMA_BASE_IMAGE" bash -euc '
    rm -f /etc/yum.repos.d/*.repo
    for r in BaseOS AppStream CRB; do
      printf "[%s]\nname=AlmaLinux %s\nbaseurl=%s/%s/x86_64/os/\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-10\n" \
        "$r" "$r" "$VAULT" "$r" >> /etc/yum.repos.d/alma.repo
    done
    dnf -q -y --setopt=install_weak_deps=False install dnf-plugins-core createrepo_c >/dev/null
    mapfile -t want < /out/.wanted
    # also the base sets of the container and cloud images (alternatives such as
    # curl-minimal / coreutils-single must be resolvable offline too)
    want+=($(rpm -qa --qf "%{NAME}\n" | grep -v "^gpg-pubkey$") curl libcurl coreutils cloud-init)
    : > /out/.missing
    for p in "${want[@]}"; do dnf -q repoquery --latest-limit 1 "$p" | grep -q . || echo "$p" >> /out/.missing; done
    avail=($(printf "%s\n" "${want[@]}" | grep -vxF -f /out/.missing | sort -u))
    dnf -q download --resolve --alldeps --arch x86_64,noarch --destdir /out/Packages "${avail[@]}"
    createrepo_c -q /out
    cp /etc/pki/rpm-gpg/RPM-GPG-KEY-AlmaLinux-10 /out/
    rpm -qp --nosignature --qf "%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n" /out/Packages/*.rpm | sort > /out/el10.lock
    chown -R '"$(id -u):$(id -g)"' /out'
  [[ -s $OUT/el10/.missing ]] && warn "el10: not in AlmaLinux $ALMA_RELEASE: $(tr '\n' ' ' < "$OUT/el10/.missing")"
  mkdir -p "$OUT/keys"; cp "$OUT/el10/RPM-GPG-KEY-AlmaLinux-10" "$OUT/keys/"
  log "el10: $(wc -l < "$OUT/el10/el10.lock") rpms, $(du -sh "$OUT/el10" | cut -f1)"
}

build_noble() {
  [[ -s $KEYDIR/secret.asc ]] || build_keys
  log "noble: Ubuntu snapshot $UBUNTU_APT_SNAPSHOT closure of $(pkgs "$HERE/packages-noble.txt" | wc -l) packages"
  rm -rf "$OUT/noble"; mkdir -p "$OUT/noble/pool"
  pkgs "$HERE/packages-noble.txt" > "$OUT/noble/.wanted"
  docker run --rm -v "$OUT/noble:/out" -v "$KEYDIR:/k:ro" -e SNAP="$UBUNTU_APT_SNAPSHOT" "$UBUNTU_BASE_IMAGE" bash -euc '
    export DEBIAN_FRONTEND=noninteractive
    A="-o Acquire::ForceIPv4=true -o Acquire::Retries=5 -o Acquire::Languages=none"
    sed -i "s/^Components: .*/Components: main universe/" /etc/apt/sources.list.d/ubuntu.sources
    apt-get $A update -qq >/dev/null && apt-get $A install -qq -y --no-install-recommends ca-certificates >/dev/null
    apt-get $A -o APT::Update::Error-Mode=any update -qq --snapshot "$SNAP" >/dev/null
    apt-get $A install -qq -y --no-install-recommends --snapshot "$SNAP" dpkg-dev apt-utils gnupg curl >/dev/null
    : > /tmp/empty-status; : > /out/.missing
    mapfile -t want < /out/.wanted
    # base set of the container image + what a cloud image adds, then the curriculum list;
    # each resolved against an EMPTY dpkg status so the whole closure is downloaded.
    want=($(dpkg-query -W -f "\${Package}\n") cloud-init "${want[@]}")
    # Resolve each package against the snapshot with an EMPTY dpkg status (whole closure),
    # collecting URIs + SHA256 only (--print-uris). snapshot.ubuntu.com can be slow
    # (~100 KB/s), so the .debs are then fetched in parallel from archive.ubuntu.com when
    # the same file is still there and from the snapshot otherwise; every file is checked
    # against the SHA256 from the snapshot index.
    : > /tmp/uris
    for p in "${want[@]}"; do
      apt-get $A -qq -y --snapshot "$SNAP" --no-install-recommends -o Dir::State::status=/tmp/empty-status \
        --print-uris install "$p" 2>/tmp/err | grep "^.http" >> /tmp/uris || { echo "$p" >> /out/.missing; tail -2 /tmp/err; }
    done
    # --print-uris only carries MD5: take the SHA256 of each file from the (signed)
    # snapshot Packages indexes, keyed by pool path.
    for f in /var/lib/apt/lists/snapshot.ubuntu.com_*_Packages*; do /usr/lib/apt/apt-helper cat-file "$f"; done \
      | awk "/^Filename: /{f=\$2} /^SHA256: /{print f, \$2}" > /tmp/sums
    echo "$(wc -l < /tmp/sums) index entries"
    sort -u /tmp/uris | tr -d "\047" | while read -r url file size md5; do
      path="pool/${url#*/pool/}"; path=$(printf "%b" "${path//%/\\x}")   # URL-decode (%7e, %2b, %3a)
      sha=$(awk -v p="$path" "\$1 == p {print \$2; exit}" /tmp/sums)
      [ -n "$sha" ] || { echo "no SHA256 for $path" >&2; exit 1; }
      echo "$url $file $sha"
    done > /tmp/dl
    echo "downloading $(wc -l < /tmp/dl) debs"
    fetch() { url=$1 file=$2 sum=$3
      fast="http://archive.ubuntu.com/ubuntu/pool/${url#*/pool/}"
      for u in "$fast" "$url"; do
        curl -4fsS --retry 3 -o "/out/pool/$file" "$u" && echo "$sum  /out/pool/$file" | sha256sum -c --status && return 0
      done; echo "FAILED $file" >&2; return 1; }
    export -f fetch
    xargs -P 8 -L 1 bash -c "fetch \$0 \$1 \$2" < /tmp/dl
    rm -rf /out/pool/partial /out/pool/lock
    cd /out
    dpkg-scanpackages -m pool /dev/null 2>/dev/null > Packages; gzip -9k Packages
    apt-ftparchive -o APT::FTPArchive::Release::Origin=CloudTrain -o APT::FTPArchive::Release::Label=cloudtrain-noble \
      -o APT::FTPArchive::Release::Suite=noble -o APT::FTPArchive::Release::Codename=noble release . > Release
    export GNUPGHOME=$(mktemp -d); gpg --batch -q --import /k/secret.asc
    gpg --batch -q --yes --clearsign -o InRelease Release; gpg --batch -q --yes -abs -o Release.gpg Release
    for f in pool/*.deb; do dpkg-deb -W --showformat "\${Package}=\${Version} \${Architecture}\n" "$f"; done | sort > noble.lock
    chown -R '"$(id -u):$(id -g)"' /out'
  [[ -s $OUT/noble/.missing ]] && warn "noble: unresolvable at $UBUNTU_APT_SNAPSHOT: $(tr '\n' ' ' < "$OUT/noble/.missing")"
  log "noble: $(wc -l < "$OUT/noble/noble.lock") debs, $(du -sh "$OUT/noble" | cut -f1)"
}

build_pypi() {
  log "pypi: $(pkgs "$HERE/pypi.txt" | wc -l) requirements"
  rm -rf "$OUT/pypi"; mkdir -p "$OUT/pypi/files"
  cp "$HERE/pypi.txt" "$OUT/pypi/.wanted"
  docker run --rm -v "$OUT/pypi:/out" -v "$HERE:/src:ro" -e SNAP="$UBUNTU_APT_SNAPSHOT" "$UBUNTU_BASE_IMAGE" bash -euc '
    export DEBIAN_FRONTEND=noninteractive A="-o Acquire::ForceIPv4=true -o Acquire::Retries=5"
    apt-get $A update -qq >/dev/null && apt-get $A install -qq -y --no-install-recommends ca-certificates >/dev/null
    apt-get $A -o APT::Update::Error-Mode=any update -qq --snapshot "$SNAP" >/dev/null
    apt-get $A install -qq -y --no-install-recommends --snapshot "$SNAP" python3-pip python3-venv >/dev/null
    python3 -m venv /v && /v/bin/pip -q install --upgrade pip
    # wheels for CPython 3.12 (Ubuntu 24.04 and AlmaLinux 10 both ship 3.12), sdist fallback
    /v/bin/pip download -q -d /out/files -r /out/.wanted --python-version 3.12 --platform manylinux2014_x86_64 \
      --platform manylinux_2_28_x86_64 --platform manylinux_2_17_x86_64 --implementation cp --only-binary=:all: \
      || /v/bin/pip download -q -d /out/files -r /out/.wanted
    python3 -I /src/pypi-index.py /out
    chown -R '"$(id -u):$(id -g)"' /out'
  log "pypi: $(ls "$OUT/pypi/files" | wc -l) files, $(du -sh "$OUT/pypi" | cut -f1)"
}

build_ansible() {
  log "ansible: collections from ansible-collections.yml"
  rm -rf "$OUT/ansible"; mkdir -p "$OUT/ansible"
  cp "$HERE/ansible-collections.yml" "$OUT/ansible/requirements.yml"
  docker run --rm -v "$OUT/ansible:/out" -e SNAP="$UBUNTU_APT_SNAPSHOT" "$UBUNTU_BASE_IMAGE" bash -euc '
    export DEBIAN_FRONTEND=noninteractive A="-o Acquire::ForceIPv4=true -o Acquire::Retries=5"
    apt-get $A update -qq >/dev/null && apt-get $A install -qq -y --no-install-recommends ca-certificates >/dev/null
    apt-get $A -o APT::Update::Error-Mode=any update -qq --snapshot "$SNAP" >/dev/null
    apt-get $A install -qq -y --no-install-recommends --snapshot "$SNAP" python3-pip python3-venv >/dev/null
    python3 -m venv /v && /v/bin/pip -q install ansible-core
    cd /out && /v/bin/ansible-galaxy collection download -r requirements.yml -p . >/dev/null
    # downloaded requirements.yml points at the tarballs: `ansible-galaxy collection install -r`
    # against http://<mirror>/ansible/requirements.yml-style offline installs; keep both.
    mv requirements.yml requirements-offline.yml 2>/dev/null || true
    sha256sum *.tar.gz | awk "{print \$2\" sha256:\"\$1}" > ansible.lock
    chown -R '"$(id -u):$(id -g)"' /out'
  cp "$HERE/ansible-collections.yml" "$OUT/ansible/requirements.yml"
  log "ansible: $(ls "$OUT/ansible"/*.tar.gz | wc -l) collections, $(du -sh "$OUT/ansible" | cut -f1)"
}

targets=("$@"); ((${#targets[@]})) || targets=(keys el10 noble pypi ansible)
for t in "${targets[@]}"; do "build_$t"; done
{ echo "MIRROR_SNAPSHOT=$MIRROR_SNAPSHOT"; echo "ALMA_RELEASE=$ALMA_RELEASE"; echo "UBUNTU_APT_SNAPSHOT=$UBUNTU_APT_SNAPSHOT"
  echo "BUILD_DATE=$(date -u +%FT%TZ)"; } > "$OUT/SNAPSHOT"
# Commit the locks next to the lists so a rebuild's drift is visible.
mkdir -p "$HERE/lock"
for f in el10/el10.lock noble/noble.lock pypi/pypi.lock ansible/ansible.lock; do
  [[ -f $OUT/$f ]] && cp "$OUT/$f" "$HERE/lock/"
done
log "mirror content $MIRROR_SNAPSHOT: $(du -sh "$OUT" | cut -f1) in ${OUT#"$REPO_ROOT"/}"
