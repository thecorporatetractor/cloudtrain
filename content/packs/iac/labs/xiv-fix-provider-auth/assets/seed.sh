#!/bin/sh
# Seeds ~/exam/inland-auth once: applies the stack with the kubeconfig, then leaves it
# the way the incident found it: a provider block with a hard-coded (revoked) CI token
# and a pending farm ConfigMap. A recreated pod must not overwrite the candidate's work.
set -eu
s=/var/tmp/ct-seed/xiv-fix-provider-auth/stack
d=$HOME/exam/inland-auth
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" && cp "$s/providers.tf" "$s/main.tf" "$d/"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color >/dev/null
server=$(kubectl config view --minify --context sm-grid -o jsonpath='{.clusters[0].cluster.server}')
cat > providers.tf <<HCL
terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.3.0"
    }
  }
}

# Changed by the CI migration: talk to the API directly with the pipeline's token.
provider "kubernetes" {
  host     = "$server"
  token    = "sm-ci-inland-7f3c2a9e41d84b6c"
  insecure = true
}
HCL
cat >> main.tf <<'HCL'

resource "kubernetes_config_map_v1" "fenwick" {
  metadata {
    name      = "farm-fenwick"
    namespace = kubernetes_namespace_v1.inland.metadata[0].name
  }
  data = {
    turbines = "{{ft}}"
  }
}
HCL
touch .ct-seeded
