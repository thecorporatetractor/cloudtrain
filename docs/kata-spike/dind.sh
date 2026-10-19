#!/bin/bash
# dind.sh <rc>: rootful dockerd inside a privileged Kata pod (tier-B docker labs today use docker-vm)
source /srv/ct-work/dev/kata/env.sh
rc=$1 ns=kata-dind
kk create ns $ns --dry-run=client -o yaml | kk apply -f - >/dev/null
cat <<Y | kk apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata: {name: dind, namespace: $ns}
spec:
  runtimeClassName: $rc
  nodeSelector: {kubernetes.io/hostname: ct-kata-worker}
  containers:
  - name: d
    image: docker.io/library/docker:28-dind
    securityContext: {privileged: true}
    env: [{name: DOCKER_TLS_CERTDIR, value: ""}]
    resources: {limits: {memory: 2Gi, cpu: "2"}}
    volumeMounts: [{name: lib, mountPath: /var/lib/docker}]
  volumes: [{name: lib, emptyDir: {medium: Memory, sizeLimit: 1Gi}}]
Y
kk -n $ns wait --for=condition=Ready pod/dind --timeout=300s >/dev/null
for i in $(seq 1 30); do kk -n $ns exec dind -- docker info >/dev/null 2>&1 && break; sleep 2; done
kk -n $ns exec dind -- sh -c 'echo "storage=$(docker info -f {{.Driver}}) backing=$(stat -f -c %T /var/lib/docker) cgroup=$(docker info -f {{.CgroupVersion}})"; docker run --rm busybox:1.37 sh -c "echo inner-container-ok; ip -o link | wc -l" 2>&1 | tail -2; docker run --rm -p 8080:80 -d --name web busybox:1.37 httpd -f -p 80 >/dev/null && sleep 1 && nc -z -w2 127.0.0.1 8080; echo "published port (iptables DNAT) rc=$?"; docker rm -f web >/dev/null' 2>&1
kk -n $ns logs dind 2>&1 | grep -iE "level=(error|warn)" | head -5 | cut -c1-200
kk delete ns $ns --wait=true --timeout=120s >/dev/null
