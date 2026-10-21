#!/usr/bin/env bash
# Chart tests: lint and render every example values file, then assert the
# properties the chart promises (tools/charts/test.sh; CI: .github/workflows/charts.yml).
# Needs helm and yq (mikefarah v4).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
for t in helm yq; do command -v "$t" >/dev/null || { echo "tools/charts/test.sh needs $t" >&2; exit 2; }; done
CHART=$ROOT/deploy/charts/cloudtrain
CRDS=$ROOT/deploy/charts/cloudtrain-crds
OUT=${OUT:-$(mktemp -d)}
mkdir -p "$OUT"
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; fails=$((fails + 1)); }
check() { local name=$1; shift; if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi; }
render() { helm template ct "$CHART" -n cloudtrain "$@"; }
q() { yq ea -e "$1" "$2" >/dev/null 2>&1; }

bash "$ROOT/tools/charts/sync.sh" --check && pass "embedded files in sync" || fail "embedded files in sync (run tools/charts/sync.sh)"

helm lint "$CRDS" >/dev/null && pass "lint cloudtrain-crds" || fail "lint cloudtrain-crds"
helm template c "$CRDS" > "$OUT/crds.yaml"
check "crds: 5 CRDs, kept on uninstall" bash -c "[[ \$(yq -N 'select(.kind == \"CustomResourceDefinition\") | .metadata.name' '$OUT/crds.yaml' | grep -c cloudtrain.dev) == 5 ]] && yq -e 'select(.kind == \"CustomResourceDefinition\") | .metadata.annotations[\"helm.sh/resource-policy\"] == \"keep\"' '$OUT/crds.yaml'"

for f in "$CHART"/examples/values-*.yaml; do
  n=$(basename "$f" .yaml)
  if helm lint "$CHART" -f "$f" >"$OUT/$n.lint" 2>&1 && render -f "$f" >"$OUT/$n.yaml" 2>"$OUT/$n.err"; then pass "lint + render $n"; else fail "lint + render $n: $(cat "$OUT/$n.err" "$OUT/$n.lint" | tail -3)"; fi
done

# Every platform pod is non-root on a read-only root filesystem without privileges.
for n in values-kind values-eks-alb values-gke-gateway; do
  check "$n: hardened containers" q '[select(.kind == "Deployment") | .spec.template.spec as $s | ($s.initContainers // []) + $s.containers | .[] | (.securityContext.readOnlyRootFilesystem == true and .securityContext.allowPrivilegeEscalation == false and .securityContext.capabilities.drop[0] == "ALL")] | all' "$OUT/$n.yaml"
  check "$n: pods runAsNonRoot + RuntimeDefault seccomp" q '[select(.kind == "Deployment") | .spec.template.spec.securityContext | (.runAsNonRoot == true and .seccompProfile.type == "RuntimeDefault")] | all' "$OUT/$n.yaml"
done

# Public URL, OIDC redirect base and cookies follow host and TLS.
check "https public URL from host" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-gateway") | .spec.template.spec.containers[0].env[] | select(.name == "CT_PUBLIC_URL") | .value == "https://labs.example.com"' "$OUT/values-eks-alb.yaml"
check "http public URL without TLS" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-gateway") | .spec.template.spec.containers[0].env[] | select(.name == "CT_PUBLIC_URL") | .value == "http://cloudtrain.deploy.test"' "$OUT/values-kind.yaml"
check "in-cluster ServiceAccount auth" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-gateway") | .spec.template.spec.containers[0].env[] | select(.name == "CT_KUBE_CONTEXT") | .value == "in-cluster"' "$OUT/values-kind.yaml"

# Exposure: Ingress routes /api to the gateway and / to web; HTTPRoute likewise.
check "ingress /api -> gateway" q 'select(.kind == "Ingress") | .spec.rules[0].http.paths[] | select(.path == "/api") | .backend.service.name == "ct-cloudtrain-gateway"' "$OUT/values-nginx.yaml"
check "ingress / -> web" q 'select(.kind == "Ingress") | .spec.rules[0].http.paths[] | select(.path == "/") | .backend.service.name == "ct-cloudtrain-web"' "$OUT/values-nginx.yaml"
check "ingress TLS secret" q 'select(.kind == "Ingress") | .spec.tls[0].secretName == "cloudtrain-tls"' "$OUT/values-nginx.yaml"
check "external TLS: no tls block" q 'select(.kind == "Ingress") | .spec.tls == null' "$OUT/values-eks-alb.yaml"
check "certManager: Certificate for host" q 'select(.kind == "Certificate") | .spec.dnsNames[0] == "labs.example.com"' "$OUT/values-aks-app-routing.yaml"
check "gatewayAPI: HTTPRoute on shared parent, no Ingress" bash -c "yq -e 'select(.kind == \"HTTPRoute\") | .spec.parentRefs[0].name == \"eg\"' '$OUT/values-envoy-gateway.yaml' && ! grep -q '^kind: Ingress' '$OUT/values-envoy-gateway.yaml'"
check "gatewayAPI: route timeouts" q 'select(.kind == "HTTPRoute") | .spec.rules[0].timeouts.request == "0s"' "$OUT/values-envoy-gateway.yaml"
check "gatewayAPI: chart Gateway with HTTPS listener" q 'select(.kind == "Gateway") | .spec.listeners[0].tls.certificateRefs[0].name == "cloudtrain-tls"' "$OUT/values-gke-gateway.yaml"
check "extraObjects templated" q 'select(.kind == "HealthCheckPolicy" and .metadata.name == "ct-cloudtrain-gateway") | .spec.targetRef.name == "ct-cloudtrain-gateway"' "$OUT/values-gke-gateway.yaml"

# Registry: mirrors and pull secrets reach the orchestrator; the catalog has the OpenTofu overlay.
check "orchestrator --image-mirror" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--image-mirror=ghcr.io/thecorporatetractor/cloudtrain=myacr.azurecr.io/cloudtrain")' "$OUT/values-aks-app-routing.yaml"
check "catalog ConfigMap with OpenTofu overlay" q 'select(.kind == "ConfigMap" and .metadata.name == "ct-cloudtrain-orchestrator-catalog") | .data["10-iac-opentofu.yaml"] | contains("iac-ws:1.15-tofu")' "$OUT/values-kind.yaml"
check "orchestrator scoped to its sessions namespace" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--watch-namespace=ct-deploy-sessions")' "$OUT/values-kind.yaml"
check "cluster-scoped names carry the namespace" q 'select(.kind == "ClusterRole" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain")' "$OUT/values-kind.yaml"
render -f "$CHART/examples/values-kind.yaml" --set imagePullSecrets.create=true --set imagePullSecrets.username=u --set imagePullSecrets.token=p --set 'orchestrator.images.pullSecrets[0]=cloudtrain-registry' >"$OUT/pull.yaml"
check "pull secret in release and sessions namespaces" bash -c "[[ \$(yq -N 'select(.kind == \"Secret\" and .type == \"kubernetes.io/dockerconfigjson\") | .metadata.namespace' '$OUT/pull.yaml' | sort | tr '\n' ' ') == 'cloudtrain ct-deploy-sessions ' ]]"
check "orchestrator --image-pull-secrets" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--image-pull-secrets=cloudtrain-registry")' "$OUT/pull.yaml"
render -f "$CHART/examples/values-kind.yaml" --set-file orchestrator.catalog.releaseOverlay="$ROOT/deploy/images/overlays/iac-opentofu.yaml" >"$OUT/overlay.yaml"
check "release overlay in the catalog" q 'select(.kind == "ConfigMap" and .metadata.name == "ct-cloudtrain-orchestrator-catalog") | .data["20-release.yaml"] | contains("ImageCatalog")' "$OUT/overlay.yaml"

# Least-privilege orchestrator RBAC (docs/deploy.md, Orchestrator RBAC).
K=$OUT/values-kind.yaml
check "rbac: no escalate, no wildcards" bash -c "! yq -e 'select(.kind == \"ClusterRole\" or .kind == \"Role\") | .rules[] | select((.verbs | any_c(. == \"escalate\" or test(\"^[*]$\"))) or (.resources | any_c(test(\"^[*]$\"))))' '$K'"
check "rbac: bind only on the release's session role" q '[select(.kind == "ClusterRole" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain") | .rules[] | select(.verbs | any_c(. == "bind"))] | (length == 1 and (.[0].resourceNames | length) == 1 and .[0].resourceNames[0] == "ct-cloudtrain-orchestrator-session-cloudtrain")' "$K"
check "rbac: no Secrets or pods/exec cluster-wide" bash -c "! yq -e 'select(.kind == \"ClusterRole\" and .metadata.name == \"ct-cloudtrain-orchestrator-cloudtrain\") | .rules[] | select(.resources | any_c(. == \"secrets\" or . == \"pods/exec\"))' '$K'"
check "rbac: session ClusterRole, not bound by the chart" bash -c "yq -e 'select(.kind == \"ClusterRole\" and .metadata.name == \"ct-cloudtrain-orchestrator-session-cloudtrain\") | .rules[] | select(.resources | any_c(. == \"pods/exec\"))' '$K' && ! yq -e 'select(.kind == \"ClusterRoleBinding\" or .kind == \"RoleBinding\") | select(.roleRef.name == \"ct-cloudtrain-orchestrator-session-cloudtrain\")' '$K'"
check "rbac: manager flags" q '[select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--session-cluster-role=ct-cloudtrain-orchestrator-session-cloudtrain" or . == "--service-account=cloudtrain/ct-cloudtrain-orchestrator" or . == "--ovn-central=kube-system/app=ovn-central")] | length == 3' "$K"
check "rbac: leader election Role in the release namespace" q 'select(.kind == "Role" and .metadata.name == "ct-cloudtrain-orchestrator-leader-election") | .rules[0].resources[0] == "leases"' "$K"
check "rbac: admission policy matches the release's ServiceAccount and session role" bash -c "yq -e 'select(.kind == \"ValidatingAdmissionPolicy\") | .spec.matchConditions[0].expression == \"request.userInfo.username == '\''system:serviceaccount:cloudtrain:ct-cloudtrain-orchestrator'\''\"' '$K' && yq -e 'select(.kind == \"ValidatingAdmissionPolicy\") | .spec.validations[] | select(.expression | contains(\"ct-cloudtrain-orchestrator-session-cloudtrain\"))' '$K' && yq -e 'select(.kind == \"ValidatingAdmissionPolicyBinding\") | .spec.policyName == \"ct-cloudtrain-orchestrator-cloudtrain\"' '$K'"
check "rbac: sessions namespace is a lab namespace" q 'select(.kind == "Namespace" and .metadata.name == "ct-deploy-sessions") | .metadata.labels["labs.cloudtrain.dev/lab-namespace"] == "true"' "$K"
render -f "$CHART/examples/values-kind.yaml" --set orchestrator.rbac.ovnCentral.enabled=false --set orchestrator.rbac.admissionPolicy=false >"$OUT/rbac-off.yaml"
check "rbac: ovn-central off drops the kube-system Role" bash -c "! yq -e 'select(.kind == \"Role\" and .metadata.namespace == \"kube-system\")' '$OUT/rbac-off.yaml' && yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-orchestrator\") | .spec.template.spec.containers[0].args[] | select(. == \"--ovn-central=\")' '$OUT/rbac-off.yaml' && ! grep -q '^kind: ValidatingAdmissionPolicy' '$OUT/rbac-off.yaml'"

# Tier sandboxes: off by default (no flag, no ConfigMap, no mount); set, a
# SandboxConfig ConfigMap the manager reads and the optional preflight mount.
check "sandboxes off by default" bash -c "! yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-orchestrator\") | .spec.template.spec | (.containers[0].args[] | select(test(\"sandbox|tier-runtime\"))), (.volumes[] | select(.name | test(\"sandbox\")))' '$OUT/values-kind.yaml' && ! yq -e 'select(.kind == \"ConfigMap\" and .metadata.name == \"ct-cloudtrain-orchestrator-sandboxes\")' '$OUT/values-kind.yaml'"
render -f "$CHART/examples/values-kind.yaml" --set orchestrator.sandboxes.B.runtimeClass=kata-clh-runtime-rs --set orchestrator.sandboxes.B.fallback=kubevirt >"$OUT/sandboxes.yaml"
check "sandboxes ConfigMap" q 'select(.kind == "ConfigMap" and .metadata.name == "ct-cloudtrain-orchestrator-sandboxes") | .data["sandboxes.yaml"] | from_yaml | (.kind == "SandboxConfig" and .tiers.B.runtimeClass == "kata-clh-runtime-rs" and .tiers.B.fallback == "kubevirt")' "$OUT/sandboxes.yaml"
check "sandboxes manager flags" q '[select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--sandboxes-config=/etc/cloudtrain/sandboxes/sandboxes.yaml" or . == "--sandbox-preflight=/etc/cloudtrain/sandbox-preflight/preflight.yaml")] | length == 2' "$OUT/sandboxes.yaml"
check "sandbox preflight ConfigMap optional" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.volumes[] | select(.name == "sandbox-preflight") | (.configMap.name == "lab-sandbox-preflight" and .configMap.optional == true)' "$OUT/sandboxes.yaml"

# Web runtime config and CSP sources go in as environment variables.
render -f "$CHART/examples/values-kind.yaml" --set web.runtimeConfig.apiBase=https://api.example.com --set 'web.csp.connectSrc=https://api.example.com wss://api.example.com' >"$OUT/web.yaml"
check "web CT_API_BASE" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-web") | .spec.template.spec.containers[0].env[] | select(.name == "CT_API_BASE") | .value == "https://api.example.com"' "$OUT/web.yaml"

# Refusals: bad input fails the render with a message.
refuse() { local name=$1 want=$2; shift 2; if out=$(render "$@" 2>&1); then fail "refuse $name (rendered)"; elif grep -q -- "$want" <<<"$out"; then pass "refuse $name"; else fail "refuse $name: $out"; fi; }
refuse "missing issuer" "gateway.oidc.issuer is required" --set gateway.existingSecret=s
refuse "missing secret" "gateway.existingSecret" --set gateway.oidc.issuer=https://i
refuse "bad exposure" "exposure.type" -f "$CHART/examples/values-kind.yaml" --set exposure.type=nodeport
refuse "quote in runtime config" "web.runtimeConfig" -f "$CHART/examples/values-kind.yaml" --set 'web.runtimeConfig.environment=a"b'
refuse "path in apiBase" "apiBase" -f "$CHART/examples/values-kind.yaml" --set web.runtimeConfig.apiBase=https://x/y
refuse "semicolon in CSP" "csp" -f "$CHART/examples/values-kind.yaml" --set 'web.csp.connectSrc=x; script-src *'
refuse "gatewayAPI without parent" "parentRefs or createGateway" -f "$CHART/examples/values-kind.yaml" --set exposure.type=gatewayAPI
refuse "bad mirror" "mirrors" -f "$CHART/examples/values-kind.yaml" --set 'orchestrator.images.mirrors[0]=ghcr.io'
refuse "bad ovn-central selector" "selector" -f "$CHART/examples/values-kind.yaml" --set orchestrator.rbac.ovnCentral.selector=ovn-central
refuse "unknown value" "additional properties" -f "$CHART/examples/values-kind.yaml" --set gateway.typo=1
refuse "bad sandbox fallback" "fallback" -f "$CHART/examples/values-kind.yaml" --set orchestrator.sandboxes.B.runtimeClass=kata --set orchestrator.sandboxes.B.fallback=host
refuse "bad sandbox tier" "invalid propertyName" -f "$CHART/examples/values-kind.yaml" --set orchestrator.sandboxes.Z.runtimeClass=kata
refuse "sandboxes and tierRuntimeClasses" "exclusive" -f "$CHART/examples/values-kind.yaml" --set orchestrator.sandboxes.B.runtimeClass=kata --set orchestrator.tierRuntimeClasses.B=kata

# Dev sign-in-as is never set by the chart.
if grep -rq "CT_DEV_IMPERSONATE" "$OUT"/*.yaml; then fail "no CT_DEV_IMPERSONATE"; else pass "no CT_DEV_IMPERSONATE"; fi
# Nor the development license (docs/licensing-keys.md).
if grep -rq "CT_DEV_LICENSE" "$OUT"/*.yaml; then fail "no CT_DEV_LICENSE"; else pass "no CT_DEV_LICENSE"; fi

echo "rendered manifests: $OUT"
((fails == 0)) || { echo "$fails chart test(s) failed" >&2; exit 1; }
