#!/bin/sh
# Builds the "internal Git server" repository ~/git/farm-base.git (a bare repo served
# from the file system): tags v1.2.0 and v1.3.0, and main ahead of them with an
# unreleased breaking change. Idempotent.
set -eu
r=$HOME/git/farm-base.git
[ -d "$r" ] && exit 0
w=$(mktemp -d)
cd "$w" && git init -q -b main && git config user.name "Grid Platform" && git config user.email platform@saltmarsh.example
mod() { # mod <input name> <extra content line or empty> <extra variable block or empty>
  cat > main.tf <<HCL
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9.0"
    }
  }
}

variable "$1" {
  description = "Wind farm name"
  type        = string
}
$3
resource "local_file" "conf" {
  filename = "/home/learner/inland/\${var.$1}.conf"
  content  = "farm=\${var.$1}\\nquota=standard\\n$2"
}

output "path" {
  value = local_file.conf.filename
}
HCL
}
mod farm_name "" ""
git add . && git commit -q -m "farm-base 1.2.0" && git tag v1.2.0
mod farm "schema=2\\n" ""
printf '# farm-base\n\n## 1.3.0\n- BREAKING: input farm_name renamed to farm.\n- Files carry schema=2.\n' > CHANGELOG.md
git add . && git commit -q -m "farm-base 1.3.0: rename farm_name to farm, schema 2" && git tag v1.3.0
mod farm "schema=3\\n" 'variable "grid_region" {
  description = "Grid region (unreleased, required in 2.0)"
  type        = string
}'
git add . && git commit -q -m "WIP 2.0: grid_region required"
mkdir -p "$HOME/git" && git clone -q --bare "$w" "$r" && rm -rf "$w"
