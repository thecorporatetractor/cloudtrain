#!/bin/bash
# recover ct-kata after a VM stop/start (spot interruption)
source /srv/ct-work/dev/kata/env.sh; cd $W/repo; source deploy/versions.env
deploy/scripts/host-prep.sh 2>&1 | tail -1
docker run --rm --privileged --entrypoint sh -v /lib/modules:/lib/modules:ro "$KIND_NODE_IMAGE" -c "modprobe vhost_vsock"
docker restart ct-kata-control-plane ct-kata-worker >/dev/null
tools/slots/run.sh vm -- deploy/scripts/dev-up.sh > $W/up-recover.log 2>&1; tail -1 $W/up-recover.log
$W/node-fix.sh
docker exec ct-kata-worker ls -la /opt/kata/share/kata-containers/vmlinux-lab /opt/kata/share/defaults/kata-containers/runtimes/clh/config.d/
kk -n kube-system rollout status ds/kata-deploy --timeout=300s
