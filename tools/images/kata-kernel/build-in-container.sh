#!/usr/bin/env bash
# Runs inside UBUNTU_BASE_IMAGE (tools/images/kata-kernel/build.sh): toolchain from the
# Ubuntu snapshot, kernel tree at a fixed path, fixed KBUILD_BUILD_* values.
set -euo pipefail
: "${V:?}" "${RELEASE:?}" "${BASE:?}" "${REV:?}" "${UBUNTU_APT_SNAPSHOT:?}" "${OWNER:?}"
export DEBIAN_FRONTEND=noninteractive
# snapshot.ubuntu.com is HTTPS: CA certificates first (they do not end up in the kernel).
apt-get -o Acquire::ForceIPv4=true -qq update
apt-get -o Acquire::ForceIPv4=true -qq install -y --no-install-recommends ca-certificates >/dev/null
apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any -qq update --snapshot "$UBUNTU_APT_SNAPSHOT"
apt-get -o Acquire::ForceIPv4=true -qq install -y --no-install-recommends --snapshot "$UBUNTU_APT_SNAPSHOT" \
  gcc make libc6-dev bc bison flex libelf-dev libssl-dev cpio python3 perl xz-utils >/dev/null
echo "toolchain: $(gcc --version | head -1), $(ld --version | head -1)"

mkdir -p /build
tar -xf /in/linux.tar.xz -C /build
cd "/build/linux-$V"
cp "/cfg/$BASE" .config
cat /cfg/lab.config >> .config
printf 'CONFIG_LOCALVERSION="-ct%s"\n' "$REV" >> .config
make -s olddefconfig
dropped=()
while read -r line; do
  [[ $line == CONFIG_* ]] || continue
  grep -qxF "$line" .config || dropped+=("$line")
done < /cfg/lab.config
((${#dropped[@]} == 0)) || { echo "olddefconfig dropped (missing dependency?): ${dropped[*]}" >&2; exit 1; }

# Reproducible build (https://docs.kernel.org/kbuild/reproducible-builds.html): the
# timestamp is the source release's (the tarball's Makefile mtime).
KBUILD_BUILD_TIMESTAMP="$(date -u -d "@$(stat -c %Y Makefile)" '+%Y-%m-%d %H:%M:%S UTC')"
export KBUILD_BUILD_TIMESTAMP KBUILD_BUILD_USER=cloudtrain KBUILD_BUILD_HOST=cloudtrain KBUILD_BUILD_VERSION=1
make -s -j"${JOBS:-$(nproc)}" vmlinux
[[ $(make -s kernelrelease) == "$RELEASE" ]] || { echo "kernelrelease $(make -s kernelrelease) != $RELEASE" >&2; exit 1; }

# modules.builtin as the kernel's own Makefile.vmlinux_o derives it (that rule needs
# CONFIG_MODULES, which Kata's config leaves off): one kernel/<path>.ko line per object.
tr '\0' '\n' < modules.builtin.modinfo | sed -n 's/^[[:alnum:]:_]*\.file=//p' \
  | tr ' ' '\n' | uniq | sed -e 's:^:kernel/:' -e 's/$/.ko/' > /out/modules.builtin
[[ -s /out/modules.builtin ]] || { echo "empty modules.builtin" >&2; exit 1; }
cp vmlinux /out/vmlinux
cp .config /out/config
(cd /out && sha256sum vmlinux config modules.builtin > SHA256SUMS)
chown -R "$OWNER" /out
cat /out/SHA256SUMS
