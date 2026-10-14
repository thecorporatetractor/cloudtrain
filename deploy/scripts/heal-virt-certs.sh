#!/usr/bin/env bash
# Detect and repair expired KubeVirt/CDI certificates.
#
# virt-operator and cdi-operator issue short-lived serving certificates (24 h, CA 7 d) and
# rotate them while they run. When the kind cluster has been stopped for longer than
# that, the operators come back with expired certificates in their Secrets and the
# webhooks/aggregated APIs answer every request with
#   "x509: certificate has expired or is not yet valid"
# (seen after a ~20 h stop), so `kubectl apply` of the KubeVirt CR, VMs or DataVolumes fails.
#
# Detection (any one triggers the repair):
#   1. a tls.crt in a kubevirt/cdi Secret, or a CA bundle ConfigMap, is expired or
#      expires within MIN_VALID seconds (default 600);
#   2. a server-side dry-run of a VMI (virt-api webhooks), a DataVolume (cdi-apiserver
#      webhooks), or a GET on subresources.kubevirt.io (aggregated API) fails with x509.
# Repair: restart virt-operator and cdi-operator (they re-issue certs on start), wait
# until every cert is valid again, then restart the serving components whose pods
# still present the old certificate, and wait until the probes pass.
#
# Usage: heal-virt-certs.sh [--check]   (--check: report only, exit 1 if unhealthy)
#        FORCE=1 heal-virt-certs.sh     (run the repair even when everything looks valid)
source "$(dirname "$0")/lib.sh"
need kubectl; need jq; need openssl
MIN_VALID=${MIN_VALID:-600}
CHECK_ONLY=0; [[ ${1:-} == --check ]] && CHECK_ONLY=1

installed() { k get ns kubevirt >/dev/null 2>&1 || k get ns cdi >/dev/null 2>&1; }
installed || { log "KubeVirt/CDI not installed; nothing to check"; exit 0; }

# bundle_valid <base64 PEM bundle>: true when at least one certificate in it is valid
# for MIN_VALID more seconds.
bundle_valid() {
  local dir rc=1 f; dir=$(mktemp -d)
  base64 -d <<<"$1" | awk -v d="$dir" '/BEGIN CERT/{n++} n{print > (d "/" n ".pem")}'
  for f in "$dir"/*.pem; do
    [[ -e $f ]] || continue
    openssl x509 -noout -checkend "$MIN_VALID" -in "$f" >/dev/null 2>&1 && { rc=0; break; }
  done
  rm -rf "$dir"; return $rc
}

# expired_certs: one line per Secret/ConfigMap certificate that is (nearly) expired.
expired_certs() {
  local ns
  for ns in kubevirt cdi; do
    k get ns "$ns" >/dev/null 2>&1 || continue
    k -n "$ns" get secret -o json | jq -r '.items[] | select(.data["tls.crt"] != null) | "\(.metadata.name) \(.data["tls.crt"])"' |
      while read -r name crt; do
        base64 -d <<<"$crt" 2>/dev/null | openssl x509 -noout -checkend "$MIN_VALID" >/dev/null 2>&1 \
          || echo "$ns/secret/$name"
      done
    # CA bundles (kubevirt-ca, cdi-apiserver-signer-bundle, ...). A bundle keeps old CAs
    # next to the current one during rotation: flag it only when none of them is valid.
    k -n "$ns" get cm -o json | jq -r '.items[] | .metadata.name as $n | (.data // {}) | to_entries[]
        | select(.value | contains("BEGIN CERTIFICATE")) | "\($n) \(.value | @base64)"' |
      while read -r name b64; do
        bundle_valid "$b64" || echo "$ns/configmap/$name"
      done
  done
}

# probe_errors: x509 failures seen by real API calls through the webhooks.
probe_errors() {
  local out=""
  if k get ns kubevirt >/dev/null 2>&1; then
    out+=$(k create --dry-run=server -o name -f - 2>&1 <<'EOF' || true
apiVersion: kubevirt.io/v1
kind: VirtualMachineInstance
metadata: { name: cert-probe, namespace: default }
spec:
  domain:
    resources: { requests: { memory: 64Mi } }
    devices: { disks: [ { name: d, disk: { bus: virtio } } ] }
  volumes: [ { name: d, containerDisk: { image: quay.io/kubevirt/cirros-container-disk-demo } } ]
EOF
)
    out+=$'\n'$(k get --raw /apis/subresources.kubevirt.io/v1/healthz 2>&1 || true)
  fi
  if k get ns cdi >/dev/null 2>&1; then
    out+=$'\n'$(k create --dry-run=server -o name -f - 2>&1 <<'EOF' || true
apiVersion: cdi.kubevirt.io/v1beta1
kind: DataVolume
metadata: { name: cert-probe, namespace: default }
spec:
  source: { blank: {} }
  storage: { resources: { requests: { storage: 64Mi } } }
EOF
)
  fi
  grep -iE 'x509|certificate has expired|tls: failed to verify|unknown authority' <<<"$out" || true
}

# Internal modes used by the wait loops below.
case ${1:-} in
  --list-expired) expired_certs; exit 0 ;;
  --probe) probe_errors; exit 0 ;;
esac

EXP=""; PROBE=""
report() {
  EXP=$(expired_certs); PROBE=$(probe_errors)
  [[ -z $EXP && -z $PROBE ]]
}

if [[ ${FORCE:-0} != 1 ]] && report; then log "KubeVirt/CDI certificates valid, webhooks answer"; exit 0; fi
[[ -n $EXP ]] && warn "expired or expiring certificates: $(tr '\n' ' ' <<<"$EXP")"
[[ -n $PROBE ]] && warn "webhook/API probe: $(head -3 <<<"$PROBE")"
((CHECK_ONLY)) && exit 1

T0=$SECONDS
log "restarting virt-operator and cdi-operator to re-issue certificates"
k -n kubevirt get deploy virt-operator >/dev/null 2>&1 && k -n kubevirt rollout restart deploy/virt-operator >/dev/null
k -n cdi get deploy cdi-operator >/dev/null 2>&1 && k -n cdi rollout restart deploy/cdi-operator >/dev/null
k -n kubevirt get deploy virt-operator >/dev/null 2>&1 && \
  wait_for "virt-operator rollout" 300 k -n kubevirt rollout status deploy/virt-operator --timeout=5s
k -n cdi get deploy cdi-operator >/dev/null 2>&1 && \
  wait_for "cdi-operator rollout" 300 k -n cdi rollout status deploy/cdi-operator --timeout=5s
wait_for "certificates rotated" 600 bash -c "[[ -z \$(MIN_VALID=$MIN_VALID '$0' --list-expired) ]]"

# The serving pods load their certificate files from the Secrets (mounted volumes are
# refreshed within ~1 min); restart the ones still failing so they pick it up at once.
sleep 5
if [[ -n $(probe_errors) ]]; then
  log "webhooks still present old certificates; restarting serving components"
  for d in virt-api virt-controller virt-exportproxy virt-template-apiserver virt-template-controller; do
    k -n kubevirt get deploy "$d" >/dev/null 2>&1 && k -n kubevirt rollout restart deploy/"$d" >/dev/null
  done
  k -n kubevirt get ds virt-handler >/dev/null 2>&1 && k -n kubevirt rollout restart ds/virt-handler >/dev/null
  for d in cdi-apiserver cdi-deployment cdi-uploadproxy; do
    k -n cdi get deploy "$d" >/dev/null 2>&1 && k -n cdi rollout restart deploy/"$d" >/dev/null
  done
fi
wait_for "KubeVirt/CDI webhooks answer without x509 errors" 600 bash -c "[[ -z \$('$0' --probe) ]]"
log "certificates healed in $((SECONDS - T0))s"
