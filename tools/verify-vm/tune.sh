#!/bin/bash
# VM-only cluster tuning on top of `task dev:up` (merge patches survive dev:up's client-side apply).
set -euo pipefail
K="kubectl --context kind-cloudtrain-dev"
# Lab kernel modules (kind nodes share the host kernel; install.sh persists them in
# /etc/modules-load.d/cloudtrain-labs.conf): load any that are missing, e.g. after a kernel update.
mods=$(grep -vE '^\s*(#|$)' "${REPO:-/srv/ct-work/cloudtrain}/deploy/scripts/lab-kernel-modules.txt" 2>/dev/null || grep -vE '^\s*(#|$)' /etc/modules-load.d/cloudtrain-labs.conf 2>/dev/null || true)
# shellcheck disable=SC2086
[[ -n $mods ]] && { sudo -n modprobe -a $mods || echo "tune.sh: some lab kernel modules failed to load" >&2; }
# Host AppArmor profiles attach by executable path. kind runs its nodes privileged, so lab pods
# are unconfined and the host's profiles confine the same binaries INSIDE lab containers: the
# rsyslogd profile denied a lab's config file and /proc/<pid>/fd, and rsyslogd hung while
# daemonizing (docs/dev-environment.md, "Host AppArmor"). Unload exactly these three and keep
# them disabled across boots; the host's own chrony/rsyslog keep running, unconfined.
# Undo one: sudo rm /etc/apparmor.d/disable/<file> && sudo apparmor_parser -r /etc/apparmor.d/<file>
if [[ -d /sys/kernel/security/apparmor ]]; then
  for f in usr.sbin.rsyslogd usr.sbin.chronyd usr.bin.tcpdump; do
    [[ -f /etc/apparmor.d/$f ]] || continue
    [[ -L /etc/apparmor.d/disable/$f ]] || { sudo -n ln -s "/etc/apparmor.d/$f" "/etc/apparmor.d/disable/$f" && echo "tune.sh: AppArmor $f disabled at boot"; }
    name=$(sed -nE 's/^profile ([^ ]+) .*/\1/p; s/^(\/[^ ]+) .*\{.*/\1/p' "/etc/apparmor.d/$f" | head -1)
    if sudo -n awk -v n="$name" '$1 == n { f = 1 } END { exit !f }' /sys/kernel/security/apparmor/profiles; then
      sudo -n apparmor_parser -R "/etc/apparmor.d/$f" && echo "tune.sh: AppArmor profile $name ($f) unloaded"
    fi
  done
fi
rl='{"restClient":{"rateLimiter":{"tokenBucketRateLimiter":{"qps":200,"burst":400}}}}'
$K -n kubevirt patch kv kubevirt --type merge -p "{\"spec\":{\"configuration\":{\"controllerConfiguration\":$rl,\"handlerConfiguration\":$rl,\"webhookConfiguration\":$rl}}}"
$K patch cdi cdi --type merge -p '{"spec":{"config":{"podResourceRequirements":{"limits":{"cpu":"2","memory":"2Gi"},"requests":{"cpu":"100m","memory":"60M"}}}}}'
$K -n kubevirt wait kv/kubevirt --for=condition=Available --timeout=300s
# kind's local-path-provisioner at its defaults (4 workers, client QPS 5 / burst 10) was the
# throughput limit: 19 PVCs Pending, "client-side throttling" in its log, VM labs idle at 17 % CPU
# with 21 VM jobs. Raise both (only patched when the command differs, so no needless rollout).
lpp=$($K -n local-path-storage get deploy local-path-provisioner -o json | jq -c '.spec.template.spec.containers[0].command
  | . as $c | reduce range(0; length) as $i ([]; if ($c[$i] | IN("--worker-threads", "--kube-client-qps", "--kube-client-burst")) or ($i > 0 and ($c[$i - 1] | IN("--worker-threads", "--kube-client-qps", "--kube-client-burst"))) then . else . + [$c[$i]] end)
  | . + ["--worker-threads", "32", "--kube-client-qps", "100", "--kube-client-burst", "200"]')
if [[ $lpp != "$($K -n local-path-storage get deploy local-path-provisioner -o jsonpath='{.spec.template.spec.containers[0].command}' | jq -c .)" ]]; then
  $K -n local-path-storage patch deploy local-path-provisioner --type json -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/command\",\"value\":$lpp}]"
fi
# kind bind-mounts files over /sys/devices/virtual/dmi/id (per-node product_uuid) on hosts that
# have DMI (EC2; WSL has none). That makes /sys not "fully visible", so runc cannot mount sysfs
# in a user namespace and every hostUsers:false pod fails with "error mounting sysfs ...
# operation not permitted". Drop the overmounts (they come back when a node container restarts).
for n in $(docker ps --filter label=io.x-k8s.kind.cluster=cloudtrain-dev --format '{{.Names}}'); do
  docker exec "$n" sh -c 'while grep -q " /sys/devices/virtual/dmi/id/" /proc/self/mounts; do
    umount "$(awk "\$2 ~ /^\/sys\/devices\/virtual\/dmi\/id\// {print \$2; exit}" /proc/self/mounts)" || break; done'
done
