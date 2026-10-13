# shellcheck shell=bash
# Sourced by the guest-*.sh scripts INSIDE the guest filesystem (virt-customize --run).
# Shared steps of every CloudTrain lab VM image.
set -euxo pipefail
# Mirror the script's output to the appliance console: with GUESTFS_VERBOSE=1 every
# traced command then shows up live in the build log (otherwise it is only printed when
# the script ends, which hides where a build is stuck).
if [ -w /dev/console ]; then exec > >(tee -a /dev/console) 2>&1; fi
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
  # Under TCG the appliance's user-mode network can stall a download: time out and retry
  # instead of waiting forever.
  printf '%s\n' 'Acquire::ForceIPv4 "true";' 'Acquire::http::Timeout "60";' \
    'Acquire::https::Timeout "60";' 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/99-build-ipv4
  # Ubuntu archive packages come from a fixed snapshot.ubuntu.com point in time, so
  # a rebuild resolves the same versions (third-party repos are pinned per package).
  echo "APT::Snapshot \"${UBUNTU_APT_SNAPSHOT}\";" > /etc/apt/apt.conf.d/99-build-snapshot
  # Everything the images install is in main + universe (qemu-guest-agent): index only
  # those, without translations, DEP-11 and command-not-found metadata, during the
  # build (about half of the ~40 MB the snapshot service would otherwise serve). The
  # image's own sources are restored by restore_ubuntu_sources.
  printf '%s\n' 'Acquire::Languages "none";' \
    'Acquire::IndexTargets::deb::DEP-11::DefaultEnabled "false";' \
    'Acquire::IndexTargets::deb::DEP-11-icons::DefaultEnabled "false";' \
    'Acquire::IndexTargets::deb::DEP-11-icons-hidpi::DefaultEnabled "false";' \
    'Acquire::IndexTargets::deb::CNF::DefaultEnabled "false";' >> /etc/apt/apt.conf.d/99-build-ipv4
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    cp /etc/apt/sources.list.d/ubuntu.sources "$B/ubuntu.sources.orig"
    sed -i 's/^Components: .*/Components: main universe/' /etc/apt/sources.list.d/ubuntu.sources
  fi
  apt-get -o APT::Update::Error-Mode=any update
  apt-get install -y --no-install-recommends ca-certificates curl gpg apt-transport-https \
    qemu-guest-agent jq bash-completion openssl "$@"
  systemctl enable qemu-guest-agent || true
}

# The learner account every lab VM uses (the runtime's model): non-root, password
# locked, passwordless sudo. SSH keys arrive with cloud-init at boot (a cloud-init
# `users:` entry for learner adds its keys to this existing account).
create_learner() {
  id learner >/dev/null 2>&1 || useradd -m -s /bin/bash -c "CloudTrain learner" -G sudo learner
  passwd -l learner
  install -d -m 0700 -o learner -g learner /home/learner/.ssh
  echo 'learner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-cloudtrain-learner
  chmod 0440 /etc/sudoers.d/90-cloudtrain-learner
  visudo -cf /etc/sudoers.d/90-cloudtrain-learner
}

# restore_ubuntu_sources: put the image's original Ubuntu sources back (also when a
# later step renamed the file to *.disabled).
restore_ubuntu_sources() {
  [ -f "$B/ubuntu.sources.orig" ] || return 0
  local f
  for f in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.disabled; do
    if [ -f "$f" ]; then cp "$B/ubuntu.sources.orig" "$f"; fi
  done
  rm -f "$B/ubuntu.sources.orig"
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
  restore_ubuntu_sources
  apt-get clean
  rm -f /etc/apt/apt.conf.d/99-build-ipv4 /etc/apt/apt.conf.d/99-build-snapshot
  rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* "$B"
  cloud-init clean --logs --seed || true
  truncate -s 0 /etc/machine-id
  rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
  fstrim -av || true
}
