# shellcheck shell=bash
# Sourced by the guest-*.sh scripts INSIDE the guest filesystem (virt-customize --run).
# Shared steps of every CloudTrain lab VM image.
set -euxo pipefail
B=/opt/cloudtrain/build
# shellcheck source=/dev/null
source "$B/build.env"
export DEBIAN_FRONTEND=noninteractive

# Grow root fs into the resized virtual disk. Inside the libguestfs appliance the
# guest disk is not necessarily /dev/sda, so derive it from the mounted root.
grow_root() {
  local part disk num
  part=$(findmnt -no SOURCE /)
  disk=/dev/$(lsblk -no PKNAME "$part")
  num=$(cat "/sys/class/block/$(basename "$part")/partition")
  growpart "$disk" "$num" || true
  resize2fs "$part"
  df -h /
}

# Boot-time hygiene for lab VMs (no snaps, no background apt runs fighting for dpkg),
# apt from the pinned Ubuntu snapshot, and the base packages every image needs.
base_setup() {
  apt-get purge -y snapd unattended-upgrades || true
  systemctl mask apt-daily.timer apt-daily-upgrade.timer apt-daily.service apt-daily-upgrade.service
  # The libguestfs appliance (user-mode net) has no IPv6 route; force IPv4 during the build.
  echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99-build-ipv4
  # Ubuntu archive packages come from a fixed snapshot.ubuntu.com point in time, so
  # a rebuild resolves the same versions (third-party repos are pinned per package).
  echo "APT::Snapshot \"${UBUNTU_APT_SNAPSHOT}\";" > /etc/apt/apt.conf.d/99-build-snapshot
  apt-get -o APT::Update::Error-Mode=any update
  apt-get install -y --no-install-recommends ca-certificates curl gpg apt-transport-https \
    qemu-guest-agent jq bash-completion openssl "$@"
  systemctl enable qemu-guest-agent || true
}

# fetch_key <url> <expected fingerprint> <dest .gpg>: refuse a key with another fingerprint.
fetch_key() {
  local tmp fpr; tmp=$(mktemp)
  curl -fsSL "$1" -o "$tmp"
  fpr=$(gpg --show-keys --with-colons "$tmp" | awk -F: '/^fpr/{print $10; exit}')
  [ "$fpr" = "$2" ] || { echo "GPG key $1 has fingerprint '$fpr', expected '$2'"; exit 1; }
  gpg --dearmor --yes -o "$3" "$tmp"
  rm -f "$tmp"
}

# write_release <key=value...>: /etc/cloudtrain-release (first lines are read by lab-demo).
write_release() {
  {
    echo "CLOUDTRAIN_IMAGE=${CLOUDTRAIN_IMAGE##*/}"
    printf '%s\n' "$@"
    echo "CLOUDTRAIN_IMAGE_TAG=${CLOUDTRAIN_IMAGE_TAG}"
    echo "CLOUDTRAIN_CATALOG_REF=${CLOUDTRAIN_CATALOG_REF}"
    echo "UBUNTU_APT_SNAPSHOT=${UBUNTU_APT_SNAPSHOT}"
    echo "BUILD_DATE=${BUILD_DATE}"
    echo "GIT_REV=${GIT_REV}"
  } > /etc/cloudtrain-release
  cat /etc/cloudtrain-release
}

# Generalize: no build-time apt config, caches, machine identity or cloud-init state.
generalize() {
  apt-get clean
  rm -f /etc/apt/apt.conf.d/99-build-ipv4 /etc/apt/apt.conf.d/99-build-snapshot
  rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* "$B"
  cloud-init clean --logs --seed || true
  truncate -s 0 /etc/machine-id
  rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
  fstrim -av || true
}
