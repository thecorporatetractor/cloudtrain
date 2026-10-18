#!/bin/sh
# Builds the internal module repository /home/learner/git/farm-base.git (bare, served
# from the file system): tags v1.3.0, v1.4.0 and v2.0.0. Run as the learner. Idempotent.
set -eu
r=$HOME/git/farm-base.git
[ -d "$r" ] && exit 0
w=$(mktemp -d /tmp/farm-base.XXXXXX)
cd "$w"
git init -q -b main
git config user.name "Grid Platform"; git config user.email platform@saltmarsh.example
v1() { # v1 <version> <extra data line>
  cat > main.tf <<HCL
terraform {
  required_providers {
    kubernetes = {
      source = "hashicorp/kubernetes"
    }
  }
}

variable "farm_name" {
  type = string
}

variable "turbine_count" {
  type = number
}

variable "namespace" {
  type = string
}

resource "kubernetes_config_map_v1" "settings" {
  metadata {
    name      = "farm-\${var.farm_name}"
    namespace = var.namespace
  }
  data = {
    turbines = tostring(var.turbine_count)$2
  }
}

resource "kubernetes_service_account_v1" "sa" {
  metadata {
    name      = "\${var.farm_name}-agent"
    namespace = var.namespace
  }
}
HCL
  printf '%s\n' "$1" > VERSION
}
v1 1.3.0 ""
git add -A && git commit -q -m "farm-base 1.3.0" && git tag v1.3.0
v1 1.4.0 ""
printf '# farm-base\n\n## 1.4.0\n- Docs only.\n' > CHANGELOG.md
git add -A && git commit -q -m "farm-base 1.4.0" && git tag v1.4.0
cat > main.tf <<'HCL'
terraform {
  required_providers {
    kubernetes = {
      source = "hashicorp/kubernetes"
    }
  }
}

variable "farm" {
  description = "Wind farm name (was farm_name)."
  type        = string
}

variable "turbines" {
  description = "Turbine count (was turbine_count)."
  type        = number
}

variable "namespace" {
  type = string
}

resource "kubernetes_config_map_v1" "farm" {
  metadata {
    name      = "farm-${var.farm}"
    namespace = var.namespace
  }
  data = {
    turbines = tostring(var.turbines)
  }
}

resource "kubernetes_service_account_v1" "agent" {
  metadata {
    name      = "${var.farm}-agent"
    namespace = var.namespace
  }
}

output "service_account" {
  value = kubernetes_service_account_v1.agent.metadata[0].name
}
HCL
printf '2.0.0\n' > VERSION
cat > CHANGELOG.md <<'MD'
# farm-base

## 2.0.0
- BREAKING: inputs renamed: `farm_name` -> `farm`, `turbine_count` -> `turbines`.
- BREAKING: resources renamed: `kubernetes_config_map_v1.settings` -> `kubernetes_config_map_v1.farm`,
  `kubernetes_service_account_v1.sa` -> `kubernetes_service_account_v1.agent`.
  This release ships no moved blocks: callers that must keep their objects add them.
- New output `service_account`.

## 1.4.0
- Docs only.
MD
git add -A && git commit -q -m "farm-base 2.0.0" && git tag v2.0.0
mkdir -p "$HOME/git" && git clone -q --bare "$w" "$r" && rm -rf "$w"
