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
# Releases pin an immutable image tag (docs/deploy.md); the examples leave it to
# --set global.imageTag, so the tests supply one under every values file.
printf 'global:\n  imageTag: 0.0.0-test\n' >"$OUT/ci-tag.yaml"
render() { helm template ct "$CHART" -n cloudtrain -f "$OUT/ci-tag.yaml" "$@"; }
q() { yq ea -e "$1" "$2" >/dev/null 2>&1; }

bash "$ROOT/tools/charts/sync.sh" --check && pass "embedded files in sync" || fail "embedded files in sync (run tools/charts/sync.sh)"

helm lint "$CRDS" >/dev/null && pass "lint cloudtrain-crds" || fail "lint cloudtrain-crds"
helm template c "$CRDS" > "$OUT/crds.yaml"
check "crds: 5 CRDs, kept on uninstall" bash -c "[[ \$(yq -N 'select(.kind == \"CustomResourceDefinition\") | .metadata.name' '$OUT/crds.yaml' | grep -c cloudtrain.dev) == 5 ]] && yq -e 'select(.kind == \"CustomResourceDefinition\") | .metadata.annotations[\"helm.sh/resource-policy\"] == \"keep\"' '$OUT/crds.yaml'"

for f in "$CHART"/examples/values-*.yaml; do
  n=$(basename "$f" .yaml)
  if helm lint "$CHART" -f "$OUT/ci-tag.yaml" -f "$f" >"$OUT/$n.lint" 2>&1 && render -f "$f" >"$OUT/$n.yaml" 2>"$OUT/$n.err"; then pass "lint + render $n"; else fail "lint + render $n: $(cat "$OUT/$n.err" "$OUT/$n.lint" | tail -3)"; fi
done

# Every platform pod is non-root on a read-only root filesystem without privileges.
for n in values-kind values-eks-alb values-gke-gateway; do
  check "$n: hardened containers" q '[select(.kind == "Deployment") | .spec.template.spec as $s | ($s.initContainers // []) + $s.containers | .[] | (.securityContext.readOnlyRootFilesystem == true and .securityContext.allowPrivilegeEscalation == false and .securityContext.capabilities.drop[0] == "ALL")] | all' "$OUT/$n.yaml"
  check "$n: pods runAsNonRoot + RuntimeDefault seccomp" q '[select(.kind == "Deployment") | .spec.template.spec.securityContext | (.runAsNonRoot == true and .seccompProfile.type == "RuntimeDefault")] | all' "$OUT/$n.yaml"
done

# Schema owner credentials reach only the migrate Job; the gateway pods run as the app role.
for n in values-kind values-eks-alb; do
  check "$n: gateway pods never see owner credentials" bash -c "! yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-gateway\") | .spec.template.spec | (.initContainers // []) + .containers | .[].env[] | select(.name == \"CT_DATABASE_OWNER_URL\" or .name == \"PG_OWNER_PASSWORD\")' '$OUT/$n.yaml'"
  check "$n: migrate Job runs as the owner, hardened, no API token" q 'select(.kind == "Job" and (.metadata.name | test("^ct-cloudtrain-gateway-migrate-[0-9a-f]{8}$"))) | .spec.template.spec | (.automountServiceAccountToken == false and .securityContext.runAsNonRoot == true and .containers[0].args[1] == "migrate" and .containers[0].securityContext.readOnlyRootFilesystem == true and ([.containers[0].env[] | select(.name == "CT_DATABASE_OWNER_URL")] | length) == 1)' "$OUT/$n.yaml"
  check "$n: gateway waits for the schema as the app role" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-gateway") | .spec.template.spec.initContainers[0] | (.name == "wait-for-schema" and .args[1] == "wait")' "$OUT/$n.yaml"
done
render -f "$CHART/examples/values-kind.yaml" --set gateway.migrate=false >"$OUT/no-migrate.yaml"
check "migrate=false: no Job, no wait" bash -c "! yq -e 'select(.kind == \"Job\")' '$OUT/no-migrate.yaml' && ! yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-gateway\") | .spec.template.spec.initContainers' '$OUT/no-migrate.yaml'"
render -f "$CHART/examples/values-kind.yaml" --set gateway.migrateRetry=1 >"$OUT/migrate-retry.yaml"
check "migrateRetry renames the migrate Job (a failed Job is retried)" bash -c "a=\$(yq 'select(.kind == \"Job\") | .metadata.name' '$OUT/values-kind.yaml'); b=\$(yq 'select(.kind == \"Job\") | .metadata.name' '$OUT/migrate-retry.yaml'); [[ -n \$a && -n \$b && \$a != \$b ]]"
# A Job's pod template is immutable: anything in it changes the name, and a chart
# version bump alone changes neither (no helm.sh/chart label on the template).
mkdir -p "$OUT/bumped" && cp -rL "$CHART" "$OUT/bumped/" && sed -i 's/^version: .*/version: 99.0.0/' "$OUT/bumped/cloudtrain/Chart.yaml"
helm template ct "$OUT/bumped/cloudtrain" -n cloudtrain -f "$OUT/ci-tag.yaml" -f "$CHART/examples/values-kind.yaml" >"$OUT/migrate-bumped.yaml" 2>/dev/null
check "chart version bump keeps the migrate Job and its template" bash -c "[[ \$(yq 'select(.kind == \"Job\") | .metadata.name' '$OUT/values-kind.yaml') == \"\$(yq 'select(.kind == \"Job\") | .metadata.name' '$OUT/migrate-bumped.yaml')\" ]] && [[ \"\$(yq -o=json 'select(.kind == \"Job\") | .spec.template' '$OUT/values-kind.yaml')\" == \"\$(yq -o=json 'select(.kind == \"Job\") | .spec.template' '$OUT/migrate-bumped.yaml')\" ]]"
check "migrate Job pod template: no chart version label" bash -c "! yq -e 'select(.kind == \"Job\") | .spec.template.metadata.labels[\"helm.sh/chart\"]' '$OUT/values-kind.yaml'"
render -f "$CHART/examples/values-kind.yaml" --set gateway.image.tag=dev2 >"$OUT/migrate-image.yaml"
check "a new image renames the migrate Job" bash -c "[[ \$(yq 'select(.kind == \"Job\") | .metadata.name' '$OUT/values-kind.yaml') != \$(yq 'select(.kind == \"Job\") | .metadata.name' '$OUT/migrate-image.yaml') ]]"
render -f "$CHART/examples/values-kind.yaml" --set global.imageTag=main --set gateway.migrateMutableTag=true >"$OUT/migrate-mutable.yaml"
check "migrateMutableTag allows a moving tag" q 'select(.kind == "Job") | .spec.template.spec.containers[0].image == "ct-deploy/gateway:main"' "$OUT/migrate-mutable.yaml"
# Supply chain: digests pin the platform images; cosign verification is opt-in.
D=sha256:$(printf 'a%.0s' {1..64})
DIG=(--set "gateway.image.digest=$D" --set "web.image.digest=$D" --set "orchestrator.image.digest=$D")
check "images by tag, pulled Always, by default" q '[select(.kind == "Deployment") | .spec.template.spec.containers[0] | select(.image | test("^ghcr.io/thecorporatetractor/cloudtrain/")) | (.imagePullPolicy == "Always" and (.image | test("@") | not))] | (length > 0 and all)' "$OUT/values-nginx.yaml"
render -f "$CHART/examples/values-nginx.yaml" "${DIG[@]}" --set imageVerification.enabled=true --set 'imageVerification.extraGlobs[0]=ghcr.io/thecorporatetractor/cloudtrain/jumphost*' >"$OUT/verify.yaml"
check "pinned images pulled IfNotPresent" q '[select(.kind == "Deployment") | .spec.template.spec | (.initContainers // []) + .containers | .[] | select(.image | test("^ghcr.io/thecorporatetractor/cloudtrain/")) | .imagePullPolicy == "IfNotPresent"] | (length > 0 and all)' "$OUT/verify.yaml"
render -f "$CHART/examples/values-nginx.yaml" --set "gateway.image.digest=$D" >"$OUT/gw-pinned.yaml"
check "per image: pinned gateway IfNotPresent, tagged web Always" q '[select(.kind == "Deployment") | .spec.template.spec.containers[0] | select(.image | test("/(gateway|web)[:@]")) | (((.image | test("/gateway:")) and .imagePullPolicy == "IfNotPresent") or ((.image | test("/web:")) and .imagePullPolicy == "Always"))] | (length == 2 and all)' "$OUT/gw-pinned.yaml"
check "explicit global.imagePullPolicy wins" q '[select(.kind == "Deployment") | .spec.template.spec.containers[0] | select(.image | test("^ct-deploy/")) | .imagePullPolicy == "Never"] | (length == 3 and all)' "$OUT/values-kind.yaml"
# NOTES.txt rendered without a cluster (helm 3 install --dry-run needs one, and
# helm template skips NOTES): a scratch copy of the chart renders it into a ConfigMap.
NC=$(mktemp -d)/cloudtrain
cp -rL "$CHART" "$NC"
mv "$NC/templates/NOTES.txt" "$NC/notes.txt"
printf '%s\n' 'apiVersion: v1' 'kind: ConfigMap' 'metadata: {name: ct-notes}' 'data:' '  notes: {{ tpl (.Files.Get "notes.txt") . | toJson }}' >"$NC/templates/zz-notes.yaml"
notes() { helm template ct "$NC" -n cloudtrain -f "$OUT/ci-tag.yaml" "$@" 2>/dev/null | yq 'select(.kind == "ConfigMap" and .metadata.name == "ct-notes") | .data.notes'; }
notes -f "$CHART/examples/values-nginx.yaml" --set "gateway.image.digest=$D" >"$OUT/notes-gw.txt"
notes -f "$CHART/examples/values-nginx.yaml" "${DIG[@]}" >"$OUT/notes-pinned.txt"
notes -f "$CHART/examples/values-nginx.yaml" "${DIG[@]}" --set imageVerification.enabled=true --set postgres.demo.enabled=true >"$OUT/notes-pg.txt"
check "NOTES name every unpinned image" grep -q 'WARNING: web, orchestrator run by tag' "$OUT/notes-gw.txt"
check "NOTES quiet when all pinned" bash -c "grep -q '^Check: helm test' '$OUT/notes-pinned.txt' && ! grep -q 'run by tag' '$OUT/notes-pinned.txt'"
check "NOTES warn: demo postgres with imageVerification" grep -q 'demo Postgres image is not covered' "$OUT/notes-pg.txt"
check "digest pinned: repository:tag@sha256" q "[select(.kind == \"Deployment\") | .spec.template.spec.containers[0].image | test(\"^ghcr.io/thecorporatetractor/cloudtrain/(gateway|web|lab-orchestrator):0.0.0-test@$D\$\")] | (length == 3 and all)" "$OUT/verify.yaml"
check "ClusterImagePolicy: platform globs, keyless GitHub identity, Rekor" q 'select(.kind == "ClusterImagePolicy") | (([.spec.images[].glob] | sort | join(",")) == "ghcr.io/thecorporatetractor/cloudtrain/gateway*,ghcr.io/thecorporatetractor/cloudtrain/jumphost*,ghcr.io/thecorporatetractor/cloudtrain/lab-orchestrator*,ghcr.io/thecorporatetractor/cloudtrain/web*" and .spec.authorities[0].keyless.identities[0].issuer == "https://token.actions.githubusercontent.com" and (.spec.authorities[0].keyless.identities[0].subjectRegExp | contains("workflows/images")) and .spec.authorities[0].ctlog.url == "https://rekor.sigstore.dev")' "$OUT/verify.yaml"
check "no ClusterImagePolicy by default" bash -c "! grep -q '^kind: ClusterImagePolicy' '$OUT/values-nginx.yaml'"
check "PDBs: unhealthy pods never block a drain" q '[select(.kind == "PodDisruptionBudget") | .spec.unhealthyPodEvictionPolicy == "AlwaysAllow"] | (length == 2 and all)' "$OUT/values-nginx.yaml"
check "PDBs for gateway and web" bash -c "[[ \$(yq -N 'select(.kind == \"PodDisruptionBudget\") | .metadata.name' '$OUT/values-nginx.yaml' | sort | tr '\n' ' ') == 'ct-cloudtrain-gateway ct-cloudtrain-web ' ]]"
check "no PDB for a single replica" bash -c "! yq -e 'select(.kind == \"PodDisruptionBudget\" and .metadata.name == \"ct-cloudtrain-web\")' '$OUT/values-kind.yaml'"

# Public URL, OIDC redirect base and cookies follow host and TLS.
check "https public URL from host" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-gateway") | .spec.template.spec.containers[0].env[] | select(.name == "CT_PUBLIC_URL") | .value == "https://labs.example.com"' "$OUT/values-eks-alb.yaml"
check "http public URL without TLS" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-gateway") | .spec.template.spec.containers[0].env[] | select(.name == "CT_PUBLIC_URL") | .value == "http://cloudtrain.deploy.test"' "$OUT/values-kind.yaml"
check "in-cluster ServiceAccount auth" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-gateway") | .spec.template.spec.containers[0].env[] | select(.name == "CT_KUBE_CONTEXT") | .value == "in-cluster"' "$OUT/values-kind.yaml"

# Exposure: Ingress routes /api to the gateway and / to web; HTTPRoute likewise.
check "ingress /api -> gateway" q 'select(.kind == "Ingress") | .spec.rules[0].http.paths[] | select(.path == "/api") | .backend.service.name == "ct-cloudtrain-gateway"' "$OUT/values-nginx.yaml"
check "ingress / -> web" q 'select(.kind == "Ingress") | .spec.rules[0].http.paths[] | select(.path == "/") | .backend.service.name == "ct-cloudtrain-web"' "$OUT/values-nginx.yaml"
check "ingress TLS secret" q 'select(.kind == "Ingress") | .spec.tls[0].secretName == "cloudtrain-tls"' "$OUT/values-nginx.yaml"

# Website on the apex, app on a subdomain (web.runtimeConfig.siteUrl): the web pods are
# the app surface, the gateway allows the website origin and returns to the app.
envv() { printf 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-%s") | .spec.template.spec.containers[0].env[] | select(.name == "%s") | .value == "%s"' "$1" "$2" "$3"; }
check "split: web surface app" q "$(envv web CT_SURFACE app)" "$OUT/values-split-site.yaml"
check "split: web site URL" q "$(envv web CT_SITE_URL https://cloudtrain.example)" "$OUT/values-split-site.yaml"
check "split: web app URL" q "$(envv web CT_APP_URL https://app.cloudtrain.example)" "$OUT/values-split-site.yaml"
check "split: gateway CORS allows the website" q "$(envv gateway CT_CORS_ORIGINS https://cloudtrain.example)" "$OUT/values-split-site.yaml"
check "split: gateway returns to the app" q "$(envv gateway CT_WEB_URL https://app.cloudtrain.example)" "$OUT/values-split-site.yaml"
check "single origin: no surface" q "$(envv web CT_SURFACE '')" "$OUT/values-nginx.yaml"
check "single origin: no CORS" bash -c "! yq -e 'select(.kind == \"Deployment\") | .spec.template.spec.containers[0].env[] | select(.name == \"CT_CORS_ORIGINS\")' '$OUT/values-nginx.yaml'"
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
check "vcluster pods: network annotation policy and binding" bash -c "yq -e 'select(.kind == \"ValidatingAdmissionPolicy\" and .metadata.name == \"ct-cloudtrain-orchestrator-cloudtrain-vcluster-pod-network\") | .spec.matchConditions[0].expression | contains(\"system:serviceaccount:ct-vc-\")' '$K' && yq -e 'select(.kind == \"ValidatingAdmissionPolicyBinding\" and .metadata.name == \"ct-cloudtrain-orchestrator-cloudtrain-vcluster-pod-network\") | .spec.validationActions[0] == \"Deny\"' '$K'"
check "vcluster pods: policy covers pods/status" q 'select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-pod-network") | (.spec.matchConstraints.resourceRules[0].resources | sort | join(",")) == "pods,pods/status"' "$K"
render -f "$CHART/examples/values-kind.yaml" --set orchestrator.rbac.ovnCentral.enabled=false --set orchestrator.rbac.admissionPolicy=false >"$OUT/rbac-off.yaml"
check "rbac: ovn-central off drops the kube-system Role" bash -c "! yq -e 'select(.kind == \"Role\" and .metadata.namespace == \"kube-system\" and (.metadata.name | test(\"ovn-central\")))' '$OUT/rbac-off.yaml' && yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-orchestrator\") | .spec.template.spec.containers[0].args[] | select(. == \"--ovn-central=\")' '$OUT/rbac-off.yaml' && ! grep -q '^kind: ValidatingAdmissionPolicy' '$OUT/rbac-off.yaml'"

check "rbac: API server endpoints readable, only default/kubernetes" q 'select(.kind == "Role" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-apiserver-endpoints") | (.metadata.namespace == "default" and (.rules | length) == 1 and (.rules[0].resourceNames | length) == 1 and .rules[0].resourceNames[0] == "kubernetes" and (.rules[0].verbs | length) == 1 and .rules[0].verbs[0] == "get" and (.rules[0].resources | length) == 1 and .rules[0].resources[0] == "endpoints")' "$K"
check "rbac: session role manages quotas and limit ranges" q 'select(.kind == "ClusterRole" and .metadata.name == "ct-cloudtrain-orchestrator-session-cloudtrain") | [.rules[] | select((.resources | any_c(. == "resourcequotas")) and (.resources | any_c(. == "limitranges")))] | length == 1' "$K"

check "vcluster host policy: no externalIPs, LoadBalancer, NodePort or Ingress in ct-vc-*" q 'select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host") | (.spec.matchConditions[0].expression | contains("ct-vc-")) and ([.spec.validations[].expression | select(contains("externalIPs") or contains("LoadBalancer") or contains("ingresses"))] | length == 3)' "$K"
check "aks: vcluster endpoints only inside the pod CIDR" q 'select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host") | (.spec.variables[0].expression == "[\x2710.244.0.0/16\x27]") or (.spec.variables[0].expression | contains("10.244.0.0/16"))' "$OUT/values-aks-app-routing.yaml"
check "vcluster host policy covers endpoints and endpointslices" q 'select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host") | [.spec.matchConstraints.resourceRules[].resources[0] | select(. == "endpoints" or . == "endpointslices")] | length == 2' "$K"
check "vcluster endpoints never at the wireserver" q 'select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host") | [.spec.validations[].expression | select(contains("168.63.129.16"))] | length == 2' "$K"
check "aks: manager checks the pod CIDRs against the nodes" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args | any_c(. == "--vcluster-pod-cidrs=10.244.0.0/16")' "$OUT/values-aks-app-routing.yaml"
check "vcluster host policy bound with Deny" q 'select(.kind == "ValidatingAdmissionPolicyBinding" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host") | .spec.validationActions[0] == "Deny"' "$K"
# Kubernetes 1.36+: the host copy of a NodePort/LoadBalancer Service becomes ClusterIP.
render -f "$CHART/examples/values-kind.yaml" --api-versions admissionregistration.k8s.io/v1/MutatingAdmissionPolicy >"$OUT/map.yaml"
check "vcluster host services: mutating policy on 1.36+, ct-vc-* only, bound" q 'select(.kind == "MutatingAdmissionPolicy" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host-services") | (.spec.matchConditions[0].expression | contains("ct-vc-")) and .spec.failurePolicy == "Fail" and (.spec.mutations[0].jsonPatch.expression | contains("ClusterIP")) and (.spec.mutations[0].jsonPatch.expression | contains("/nodePort")) and (.spec.mutations[0].jsonPatch.expression | contains("/spec/externalIPs"))' "$OUT/map.yaml"
check "vcluster host services: binding names the policy" q 'select(.kind == "MutatingAdmissionPolicyBinding" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host-services") | .spec.policyName == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host-services"' "$OUT/map.yaml"
check "vcluster host services: validating policy still refuses NodePort with the mutation" q 'select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-host") | [.spec.validations[].expression | select(contains("NodePort"))] | length == 1' "$OUT/map.yaml"
check "vcluster host services: no mutating policy before 1.36" bash -c "! grep -q '^kind: MutatingAdmissionPolicy' '$K'"
render -f "$CHART/examples/values-kind.yaml" --api-versions admissionregistration.k8s.io/v1/MutatingAdmissionPolicy --set orchestrator.rbac.admissionPolicy=false >"$OUT/map-off.yaml"
check "vcluster host services: none without the admission policies" bash -c "! grep -q '^kind: MutatingAdmissionPolicy' '$OUT/map-off.yaml'"

check "rbac: ovn-central exec scoped by the admission policy" q 'select(.kind == "ValidatingAdmissionPolicy") | (.spec.matchConstraints.resourceRules[] | select(.operations[0] == "CONNECT") | .resources[0] == "pods/exec") and ([.spec.validations[] | .expression | select(contains("request.name.startsWith") and contains("ovn-central-") and contains("kube-system"))] | length == 1)' "$K"
render -f "$CHART/examples/values-kind.yaml" --set orchestrator.rbac.ovnCentral.namespace=kube-ovn --set orchestrator.rbac.ovnCentral.selector=app=central >"$OUT/ovn-ns.yaml"
check "rbac: ovn-central namespace and pod prefix follow the values" q '[select(.kind == "ValidatingAdmissionPolicy") | .spec.validations[] | .expression | select(contains("request.name.startsWith") and contains("central-") and contains("kube-ovn") and (contains("kube-system") | not))] | length == 1' "$OUT/ovn-ns.yaml"

# Lab node pool: no placement by default; the AKS example pins labs to a tainted pool
# and the platform to the system pool.
check "lab pool off by default" bash -c "! yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-orchestrator\") | .spec.template.spec.containers[0].args[] | select(test(\"^--lab-\"))' '$OUT/values-kind.yaml'"
check "aks: lab pool flags" q '[select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--lab-node-selector=cloudtrain.dev/pool=labs" or . == "--lab-tolerations=cloudtrain.dev/labs=true:NoSchedule")] | length == 2' "$OUT/values-aks-app-routing.yaml"
check "aks: vcluster placement policy (lab selector or tier V class; lab tolerations only)" q 'select(.kind == "ValidatingAdmissionPolicy" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-vcluster-placement") | ([.spec.validations[].expression | select(contains("kata-vm-isolation") and contains("cloudtrain.dev/pool"))] | length == 1) and ([.spec.validations[].expression | select(contains("cloudtrain.dev/labs") and (contains("CriticalAddonsOnly") | not))] | length == 1) and ([.spec.validations[].expression | select(contains("nodeName"))] | length == 1) and ([.spec.validations[].expression | select(contains("hostUsers") and contains("kata-vm-isolation"))] | length == 1)' "$OUT/values-aks-app-routing.yaml"
check "aks: platform tolerates the tainted system pool" q '[select(.kind == "Deployment") | .spec.template.spec.tolerations[0].key == "CriticalAddonsOnly"] | all' "$OUT/values-aks-app-routing.yaml"
check "aks: platform on the system pool" q '[select(.kind == "Deployment") | .spec.template.spec.nodeSelector["kubernetes.azure.com/mode"] == "system"] | all' "$OUT/values-aks-app-routing.yaml"

# Tier sandboxes: off by default (no flag, no ConfigMap, no mount); set, a
# SandboxConfig ConfigMap the manager reads and the optional preflight mount.
check "sandboxes off by default" bash -c "! yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-orchestrator\") | .spec.template.spec | (.containers[0].args[] | select(test(\"sandbox|tier-runtime\"))), (.volumes[] | select(.name | test(\"sandbox\")))' '$OUT/values-kind.yaml' && ! yq -e 'select(.kind == \"ConfigMap\" and .metadata.name == \"ct-cloudtrain-orchestrator-sandboxes\")' '$OUT/values-kind.yaml'"
render -f "$CHART/examples/values-kind.yaml" --set orchestrator.sandboxes.B.runtimeClass=kata-clh-runtime-rs --set orchestrator.sandboxes.B.fallback=kubevirt >"$OUT/sandboxes.yaml"
check "sandboxes ConfigMap" q 'select(.kind == "ConfigMap" and .metadata.name == "ct-cloudtrain-orchestrator-sandboxes") | .data["sandboxes.yaml"] | from_yaml | (.kind == "SandboxConfig" and .tiers.B.runtimeClass == "kata-clh-runtime-rs" and .tiers.B.fallback == "kubevirt")' "$OUT/sandboxes.yaml"
check "sandboxes manager flags" q '[select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--sandboxes-config=/etc/cloudtrain/sandboxes/sandboxes.yaml" or . == "--sandbox-preflight=/etc/cloudtrain/sandbox-preflight/preflight.yaml")] | length == 2' "$OUT/sandboxes.yaml"
check "sandbox preflight ConfigMap optional" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.volumes[] | select(.name == "sandbox-preflight") | (.configMap.name == "lab-sandbox-preflight" and .configMap.optional == true)' "$OUT/sandboxes.yaml"

# Isolation profile: dev by default; production (the AKS example) pins it with Kata sandboxes.
check "isolation profile dev by default" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--isolation-profile=dev")' "$OUT/values-kind.yaml"
check "aks: isolation profile production" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--isolation-profile=production")' "$OUT/values-aks-app-routing.yaml"
check "aks: every container tier in kata-vm-isolation" q 'select(.kind == "ConfigMap" and .metadata.name == "ct-cloudtrain-orchestrator-sandboxes") | .data["sandboxes.yaml"] | from_yaml | .tiers as $t | (["A", "B", "C", "N", "V"] | all_c($t[.].runtimeClass == "kata-vm-isolation" and $t[.].fallback == "fail"))' "$OUT/values-aks-app-routing.yaml"

# Sessions namespace: default requests (never a default memory limit: KubeVirt VMs);
# a budget only when set (the AKS example sets a global session cap).
check "sessions LimitRange: requests only" q 'select(.kind == "LimitRange" and .metadata.namespace == "ct-deploy-sessions") | .spec.limits[0] | (.type == "Container" and .defaultRequest.memory == "64Mi" and .default == null and .max == null)' "$OUT/values-kind.yaml"
check "no sessions quota by default" bash -c "! yq -e 'select(.kind == \"ResourceQuota\")' '$OUT/values-kind.yaml'"
check "network mode primary by default" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--network-mode=primary")' "$OUT/values-kind.yaml"
check "aks: network mode secondary" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args[] | select(. == "--network-mode=secondary")' "$OUT/values-aks-app-routing.yaml"
check "rbac: policy engine check reads only kube-system DaemonSets, kube-ovn-controller and cilium-config" q 'select(.kind == "Role" and .metadata.name == "ct-cloudtrain-orchestrator-cloudtrain-policy-engine") | (.metadata.namespace == "kube-system" and (.rules | length) == 3 and .rules[2].resourceNames[0] == "cilium-config" and (.rules[0].verbs | length) == 2 and .rules[0].verbs[1] == "watch")' "$K"
check "kubelet verdict mounted, not attested by default" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec | ((.containers[0].args | any_c(. == "--node-preflight=/etc/cloudtrain/node-preflight/kubelet.yaml")) and ((.containers[0].args | any_c(. == "--kubelet-limits-attested")) | not) and (.volumes[] | select(.name == "node-preflight") | .configMap.optional == true))' "$OUT/values-kind.yaml"
check "aks: kubelet limits come from the preflight verdict, not an attestation" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-orchestrator") | .spec.template.spec.containers[0].args | (any_c(. == "--kubelet-limits-attested") | not)' "$OUT/values-aks-app-routing.yaml"
check "aks: sessions quota caps ephemeral storage" q 'select(.kind == "ResourceQuota") | .spec.hard["requests.ephemeral-storage"] != null and .spec.hard["limits.ephemeral-storage"] != null' "$OUT/values-aks-app-routing.yaml"
check "one failed-session release for the orchestrator and the gateway" bash -c "yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-orchestrator\") | .spec.template.spec.containers[0].args[] | select(. == \"--failed-session-release=5m\")' '$OUT/values-kind.yaml' && yq -e 'select(.kind == \"Deployment\" and .metadata.name == \"ct-cloudtrain-gateway\") | .spec.template.spec.containers[0].env[] | select(.name == \"CT_FAILED_SESSION_RELEASE_MINUTES\") | .value == \"5\"' '$OUT/values-kind.yaml'"
check "aks: gateway session caps" q '[select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-gateway") | .spec.template.spec.containers[0].env[] | select((.name == "CT_MAX_SESSIONS_PER_LEARNER" and .value == "2") or (.name == "CT_MAX_ACTIVE_SESSIONS" and .value == "200") or (.name == "CT_EXAM_SESSION_RESERVE" and .value == "20"))] | length == 3' "$OUT/values-aks-app-routing.yaml"
check "aks: global session cap" q 'select(.kind == "ResourceQuota") | .spec.hard["count/labsessions.labs.cloudtrain.dev"] == "200"' "$OUT/values-aks-app-routing.yaml"

# Platform and lab NetworkPolicies: off by default; the AKS example (Cilium) turns on the
# lab default-deny and the explicit IMDS/wireserver egress deny.
check "no lab network policies by default" bash -c "! yq -e 'select(.kind == \"CiliumClusterwideNetworkPolicy\" or .metadata.name == \"ct-cloudtrain-lab-default-deny\")' '$OUT/values-kind.yaml'"
check "aks: orchestrator has no ingress" q 'select(.kind == "NetworkPolicy" and .metadata.name == "ct-cloudtrain-orchestrator") | (.spec.policyTypes[0] == "Ingress" and (.spec.ingress | length) == 0)' "$OUT/values-aks-app-routing.yaml"
check "aks: lab default-deny in the sessions namespace" q 'select(.kind == "NetworkPolicy" and .metadata.name == "ct-cloudtrain-lab-default-deny") | (.metadata.namespace == "cloudtrain-sessions" and (.spec.policyTypes | length) == 2 and .spec.ingress == null and .spec.egress == null and .metadata.annotations["ovn.kubernetes.io/network_policy_for"] == "ovn")' "$OUT/values-aks-app-routing.yaml"
check "aks: lab pods denied IMDS and wireserver" q 'select(.kind == "CiliumClusterwideNetworkPolicy") | [.specs[] | ((.egressDeny[0].toCIDR | contains(["169.254.0.0/16", "168.63.129.16/32"])) and .enableDefaultDeny.egress == false)] | (length == 2 and all)' "$OUT/values-aks-app-routing.yaml"

# Web runtime config and CSP sources go in as environment variables.
render -f "$CHART/examples/values-kind.yaml" --set web.runtimeConfig.apiBase=https://api.example.com --set 'web.csp.connectSrc=https://api.example.com wss://api.example.com' >"$OUT/web.yaml"
check "web CT_API_BASE" q 'select(.kind == "Deployment" and .metadata.name == "ct-cloudtrain-web") | .spec.template.spec.containers[0].env[] | select(.name == "CT_API_BASE") | .value == "https://api.example.com"' "$OUT/web.yaml"

# Refusals: bad input fails the render with a message.
refuse() { local name=$1 want=$2; shift 2; if out=$(render "$@" 2>&1); then fail "refuse $name (rendered)"; elif grep -q -- "$want" <<<"$out"; then pass "refuse $name"; else fail "refuse $name: $out"; fi; }
refuse "missing issuer" "gateway.oidc.issuer is required" --set gateway.existingSecret=s
refuse "missing secret" "gateway.existingSecret" --set gateway.oidc.issuer=https://i
refuse "migrate without owner URL" "databaseOwnerUrl is required" -f "$CHART/examples/values-eks-alb.yaml" --set gateway.existingSecret= --set gateway.secrets.create=true --set gateway.secrets.oidcClientSecret=x --set gateway.secrets.databaseUrl=postgres://a --set gateway.secrets.sessionSecret="$(printf 's%.0s' {1..20})" --set gateway.secrets.gdprHmacKey="$(printf 'k%.0s' {1..32})" --set gateway.secrets.databaseOwnerUrl=
refuse "migrate on a moving tag" "immutable image" -f "$CHART/examples/values-kind.yaml" --set global.imageTag=main
refuse "migrate on the default appVersion" "immutable image" -f "$CHART/examples/values-eks-alb.yaml" --set global.imageTag=
if render -f "$CHART/examples/values-kind.yaml" --set global.imageTag=main --set "gateway.image.digest=sha256:$(printf 'a%.0s' {1..64})" >"$OUT/migrate-digest.yaml" 2>&1; then pass "a digest makes a moving tag safe to migrate"; else fail "a digest makes a moving tag safe to migrate: $(tail -2 "$OUT/migrate-digest.yaml")"; fi
refuse "unpinned images with verification" "requireDigests" -f "$CHART/examples/values-nginx.yaml" --set imageVerification.enabled=true
refuse "bad digest" "digest" -f "$CHART/examples/values-eks-alb.yaml" --set gateway.image.digest=sha256:abc
refuse "generated keys without generate (helm template, Argo CD)" "is empty and no existing Secret holds one" -f "$CHART/examples/values-kind.yaml" --set gateway.secrets.generate=false
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
# Production refusals start from the AKS example (every other production setting on).
yq 'del(.orchestrator.sandboxes.V)' "$CHART/examples/values-aks-app-routing.yaml" >"$OUT/aks-no-v.yaml"
refuse "production profile without sandboxes" "production needs orchestrator.sandboxes" -f "$CHART/examples/values-aks-app-routing.yaml" --set orchestrator.sandboxes=null
refuse "production profile without a tier V sandbox" "orchestrator.sandboxes.V" -f "$OUT/aks-no-v.yaml"
refuse "unknown isolation profile" "isolation" -f "$CHART/examples/values-kind.yaml" --set orchestrator.isolation.profile=strict

refuse "production profile without a lab pool" "needs orchestrator.labNodes" -f "$CHART/examples/values-aks-app-routing.yaml" --set orchestrator.labNodes.nodeSelector=null --set orchestrator.labNodes.tolerations=null
refuse "lab pool without platform node selectors" "pin the platform" -f "$CHART/examples/values-kind.yaml" --set orchestrator.labNodes.nodeSelector.pool=labs --set orchestrator.sandboxes.V.runtimeClass=kata
refuse "lab pool without a tier V sandbox" "sandboxes.V is required" -f "$CHART/examples/values-kind.yaml" --set orchestrator.labNodes.nodeSelector.pool=labs --set orchestrator.nodeSelector.sys=x --set gateway.nodeSelector.sys=x --set web.nodeSelector.sys=x
refuse "lab tolerations without a lab node selector" "needs orchestrator.labNodes.nodeSelector" -f "$CHART/examples/values-kind.yaml" --set 'orchestrator.labNodes.tolerations[0]=cloudtrain.dev/labs=true:NoSchedule' --set orchestrator.sandboxes.V.runtimeClass=kata --set orchestrator.nodeSelector.sys=x --set gateway.nodeSelector.sys=x --set web.nodeSelector.sys=x
refuse "lab default-deny without network mode secondary" "needs orchestrator.networkMode secondary" -f "$CHART/examples/values-kind.yaml" --set networkPolicy.labs.defaultDeny=true
refuse "production without the link-local deny" "needs networkPolicy.labs.denyCloudMetadata" -f "$CHART/examples/values-aks-app-routing.yaml" --set networkPolicy.labs.denyCloudMetadata=false
refuse "production without the lab default-deny" "needs networkPolicy.labs.defaultDeny" -f "$CHART/examples/values-aks-app-routing.yaml" --set networkPolicy.labs.defaultDeny=false
refuse "production without a platform session cap" "maxActiveSessions > 0" -f "$CHART/examples/values-aks-app-routing.yaml" --set gateway.capacity.maxActiveSessions=0
refuse "production without the sessions quota" "needs sessions.quota" -f "$CHART/examples/values-aks-app-routing.yaml" --set sessions.quota=null
yq 'del(.sessions.quota["limits.ephemeral-storage"])' "$CHART/examples/values-aks-app-routing.yaml" >"$OUT/aks-no-eph.yaml"
refuse "production without an ephemeral-storage quota" "ephemeral-storage" -f "$OUT/aks-no-eph.yaml"
refuse "production without vcluster pod CIDRs" "needs orchestrator.vclusterPodCIDRs" -f "$CHART/examples/values-aks-app-routing.yaml" --set orchestrator.vclusterPodCIDRs=null
refuse "bad lab toleration" "tolerations" -f "$CHART/examples/values-kind.yaml" --set 'orchestrator.labNodes.tolerations[0]=k=v:Sometimes'
refuse "sandboxes and tierRuntimeClasses" "exclusive" -f "$CHART/examples/values-kind.yaml" --set orchestrator.sandboxes.B.runtimeClass=kata --set orchestrator.tierRuntimeClasses.B=kata

# Dev sign-in-as is never set by the chart.
if grep -rq "CT_DEV_IMPERSONATE" "$OUT"/*.yaml; then fail "no CT_DEV_IMPERSONATE"; else pass "no CT_DEV_IMPERSONATE"; fi

echo "rendered manifests: $OUT"
((fails == 0)) || { echo "$fails chart test(s) failed" >&2; exit 1; }
