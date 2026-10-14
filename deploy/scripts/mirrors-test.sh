#!/usr/bin/env bash
# Smoke-test the shared mirrors as labs use them, and their isolation:
#   - a pod labelled like a lab pod (labs.cloudtrain.dev/session) in a scratch namespace:
#     el-lab:10 `dnf install` and deb-lab:24.04 `apt-get install` from the mirror, pip
#     install from the PyPI index, an image manifest from the registry, Gitea API
#   - the same pod WITHOUT the label: every mirror port must be unreachable
#   - a push to the registry without credentials must be refused
source "$(dirname "$0")/lib.sh"
NS=$MIRROR_NAMESPACE
T=ct-mirror-test
M="http://mirror.$NS.svc"
k delete ns "$T" --ignore-not-found --wait=true >/dev/null
trap 'k delete ns "$T" --wait=false --ignore-not-found >/dev/null 2>&1 || true' EXIT
k create ns "$T" >/dev/null
pod() { # pod <name> <image> <labelled:true|false>
  local labels='{"app":"mirror-test"}'
  [[ $3 == true ]] && labels='{"app":"mirror-test","labs.cloudtrain.dev/session":"mirror-test"}'
  k -n "$T" run "$1" --image="$2" --image-pull-policy=IfNotPresent --restart=Never \
    --overrides="{\"metadata\":{\"labels\":$labels},\"spec\":{\"automountServiceAccountToken\":false}}" >/dev/null
}
pod el cloudtrain/el-lab:10 true
pod deb cloudtrain/deb-lab:24.04 true
pod outsider cloudtrain/deb-lab:24.04 false
for p in el deb outsider; do k -n "$T" wait pod/$p --for=condition=Ready --timeout=180s >/dev/null || die "pod $p not Ready"; done
x() { k -n "$T" exec "$@"; }
fail=0
check() { local d=$1; shift; if "$@" >/tmp/mt.$$ 2>&1; then log "ok: $d"; else warn "FAIL: $d"; tail -5 /tmp/mt.$$ >&2; fail=1; fi; }

check "el-lab: dnf install from mirror (tree, nginx)" x el -- bash -c 'dnf -q -y install tree nginx && rpm -q tree nginx'
check "deb-lab: apt-get update + install from mirror (signed InRelease)" x deb -- bash -c 'apt-get -qq update && apt-get -qq install -y tree nginx-core >/dev/null 2>&1 || apt-get -qq install -y tree nginx >/dev/null; dpkg -s tree | grep -q "Status: install ok"'
check "deb-lab: man page installed with a mirror package" x deb -- test -e /usr/share/man/man1/tree.1.gz
check "pip install from the PyPI mirror" x deb -- bash -c 'python3 -m venv /tmp/v && /tmp/v/bin/pip -q install requests && /tmp/v/bin/python -c "import requests; print(requests.__version__)"'
check "Ansible collection tarball listed" x deb -- bash -c "curl -fsS $M/ansible/ | grep -q 'ansible-posix-'"
check "registry: allowlisted image manifest (busybox:1.37)" x deb -- bash -c "curl -fsS -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json' http://registry.$NS.svc:5000/v2/library/busybox/manifests/1.37 | grep -q mediaType"
check "registry: non-allowlisted image is NOT served (alpine:3.20)" x deb -- bash -c "! curl -fsS http://registry.$NS.svc:5000/v2/library/alpine/manifests/3.20 >/dev/null 2>&1"
check "registry: anonymous push refused" x deb -- bash -c "code=\$(curl -s -o /dev/null -w '%{http_code}' -X POST http://registry.$NS.svc:5000/v2/library/evil/blobs/uploads/); [ \"\$code\" = 401 ] || [ \"\$code\" = 403 ]"
check "gitea: API answers, registration disabled" x deb -- bash -c "curl -fsS http://git.$NS.svc:3000/api/v1/version && ! curl -fsS http://git.$NS.svc:3000/user/sign_up | grep -q 'name=\"password\"'"
for port in "mirror.$NS.svc:80" "registry.$NS.svc:5000" "git.$NS.svc:3000"; do
  check "unlabelled pod cannot reach $port" x outsider -- bash -c "! timeout 5 bash -c '</dev/tcp/${port%:*}/${port##*:}' 2>/dev/null"
done
((fail == 0)) || die "mirror smoke test failed"
log "mirror smoke test passed"
