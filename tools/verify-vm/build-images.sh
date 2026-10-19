#!/bin/bash
# Build/pull every catalog image on the verify VM in parallel; times go to $OUT/times.tsv.
set -uo pipefail
# shellcheck source=/dev/null
source ~/.profile
cd /srv/ct-work/cloudtrain || exit 1
OUT=/srv/ct-work/logs/images; mkdir -p "$OUT"
export DOCKERIO_MIRROR=mirror.gcr.io
export GUESTFS_KVM=${GUESTFS_KVM:-1} LOAD_INTO_KIND=1
REV=$(git rev-parse HEAD)
STEPS=${STEPS:-"prewarm kubeadm-node kubeadm-upgrade etcd-host el-vm ubuntu-vm docker-vm linux-pod iac-ws-terraform mirror published"}
want() { [[ " $STEPS " == *" $1 "* ]]; }
timed() { # timed <name> <cmd...>
  local name=$1 t0=$SECONDS rc; shift
  "$@" >"$OUT/$name.log" 2>&1; rc=$?
  printf '%s\t%s\t%ss\t%s\n' "$name" "$([[ $rc == 0 ]] && echo ok || echo "FAIL($rc)")" "$((SECONDS - t0))" "$(date +%T)" | tee -a "$OUT/times.tsv"
  return $rc
}
pull_pub() { # pull_pub <ghcr name> <local tag>
  local src=ghcr.io/thecorporatetractor/cloudtrain/$1
  if docker manifest inspect "$src:sha-$REV" >/dev/null 2>&1; then src=$src:sha-$REV; else src=$src:main; fi
  echo "pulling $src"; docker pull -q "$src" && docker tag "$src" "$2"
}
# 0. shared downloads + builder image, once, sequentially (build.sh writes shared cache files non-atomically)
want prewarm && timed prewarm bash -c 'for v in kubeadm-node kubeadm-upgrade etcd-host el-vm ubuntu-vm docker-vm; do LOCK_ONLY=1 bash tools/images/build.sh $v || exit 1; done
  B="cloudtrain/image-builder:$( { cat tools/images/builder/Dockerfile; grep ^UBUNTU_APT_SNAPSHOT= deploy/versions.env | cut -d= -f2; } | sha256sum | cut -c1-12)"
  docker image inspect "$B" >/dev/null 2>&1 || docker build -q -t "$B" --build-arg UBUNTU_APT_SNAPSHOT=$(grep ^UBUNTU_APT_SNAPSHOT= deploy/versions.env | cut -d= -f2) tools/images/builder'
# 1. everything independent, in parallel
pids=()
want kubeadm-node && { ( timed kubeadm-node bash tools/images/build.sh kubeadm-node && timed kubeadm-full bash tools/images/build.sh kubeadm-full ) & pids+=($!); }
for v in kubeadm-upgrade etcd-host el-vm ubuntu-vm docker-vm; do want "$v" && { timed "$v" bash tools/images/build.sh "$v" & pids+=($!); }; done
want linux-pod && { timed linux-pod bash tools/images/build-linux-pod.sh & pids+=($!); }
want iac-ws-terraform && { timed iac-ws-terraform bash tools/images/build-iac-ws.sh terraform & pids+=($!); }
want mirror && { ( timed mirror bash deploy/scripts/mirrors-up.sh ) & pids+=($!); }
want published && ( timed pull-published bash -c "$(declare -f pull_pub); REV=$REV
    pull_pub jumphost cloudtrain/jumphost:1 && pull_pub frr cloudtrain/frr:10 && pull_pub nettools cloudtrain/nettools:1 &&
    pull_pub netsvc cloudtrain/netsvc:1 && pull_pub ansible-ctl cloudtrain/ansible-ctl:2.21 && pull_pub iac-ws-tofu cloudtrain/iac-ws:1.15-tofu &&
    docker pull -q motoserver/moto:5.2.3@sha256:91fd602a21f49cf9eb82fdf474015a3c131d40104c8297ea6a2ca920708ae32c &&
    docker tag motoserver/moto:5.2.3@sha256:91fd602a21f49cf9eb82fdf474015a3c131d40104c8297ea6a2ca920708ae32c motoserver/moto:5.2.3" &&
  timed load-published bash -c 'bash tools/images/load.sh jumphost ansible-ctl iac-ws-tofu workloads &&
    bash tools/images/load.sh etcd-host iac-ws-terraform &&
    source deploy/scripts/lib.sh
    for t in cloudtrain/frr:10 cloudtrain/nettools:1 cloudtrain/netsvc:1 motoserver/moto:5.2.3; do load_image "$t" $(kind get nodes --name cloudtrain-dev) || exit 1; done' ) & pids+=($!)
rc=0; for p in "${pids[@]}"; do wait "$p" || rc=1; done
echo "ALL DONE rc=$rc $(date +%T)" | tee -a "$OUT/times.tsv"
