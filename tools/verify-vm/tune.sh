#!/bin/bash
# VM-only cluster tuning on top of `task dev:up` (merge patches survive dev:up's client-side apply).
set -euo pipefail
K="kubectl --context kind-cloudtrain-dev"
rl='{"restClient":{"rateLimiter":{"tokenBucketRateLimiter":{"qps":200,"burst":400}}}}'
$K -n kubevirt patch kv kubevirt --type merge -p "{\"spec\":{\"configuration\":{\"controllerConfiguration\":$rl,\"handlerConfiguration\":$rl,\"webhookConfiguration\":$rl}}}"
$K patch cdi cdi --type merge -p '{"spec":{"config":{"podResourceRequirements":{"limits":{"cpu":"2","memory":"2Gi"},"requests":{"cpu":"100m","memory":"60M"}}}}}'
$K -n kubevirt wait kv/kubevirt --for=condition=Available --timeout=300s
# kind bind-mounts files over /sys/devices/virtual/dmi/id (per-node product_uuid) on hosts that
# have DMI (EC2; WSL has none). That makes /sys not "fully visible", so runc cannot mount sysfs
# in a user namespace and every hostUsers:false pod fails with "error mounting sysfs ...
# operation not permitted". Drop the overmounts (they come back when a node container restarts).
for n in $(docker ps --filter label=io.x-k8s.kind.cluster=cloudtrain-dev --format '{{.Names}}'); do
  docker exec "$n" sh -c 'while grep -q " /sys/devices/virtual/dmi/id/" /proc/self/mounts; do
    umount "$(awk "\$2 ~ /^\/sys\/devices\/virtual\/dmi\/id\// {print \$2; exit}" /proc/self/mounts)" || break; done'
done
