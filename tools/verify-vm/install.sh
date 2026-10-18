#!/usr/bin/env bash
# Install the verify VM's runner config from this checkout (idempotent; run as ubuntu with sudo):
# scripts and configs to /srv/ct-work/vm-config/ (runner.env only if missing: ct-autoscale.sh
# rewrites its slot limits), systemd units and drop-ins, the sshd drop-in; then reload.
# Restart the units yourself to pick up a changed unit: ct-batch.service uses KillMode=process,
# so a restart leaves running verifies alone.
set -euo pipefail
src=$(cd "$(dirname "$0")" && pwd)
dst=${VMCFG:-/srv/ct-work/vm-config}
mkdir -p "$dst"
for f in "$src"/*.sh "$src"/*.yaml; do
  [[ $(basename "$f") == install.sh ]] || install -m "$([[ $f == *.sh ]] && echo 0755 || echo 0644)" "$f" "$dst/"
done
cp -r "$src/certs.d" "$dst/"
[[ -f $dst/runner.env ]] || install -m 0644 "$src/runner.env" "$dst/runner.env"
sudo install -m 0644 "$src"/systemd/*.service /etc/systemd/system/
for d in "$src"/systemd/*.service.d; do
  sudo install -d -m 0755 "/etc/systemd/system/$(basename "$d")"
  sudo install -m 0644 "$d"/*.conf "/etc/systemd/system/$(basename "$d")/"
done
sudo install -m 0644 "$src"/sshd/*.conf /etc/ssh/sshd_config.d/
sudo sshd -t && sudo systemctl reload ssh
sudo systemctl daemon-reload
sudo systemctl enable ct-metrics.service ct-batch.service ct-autoscale.service ct-status.service
