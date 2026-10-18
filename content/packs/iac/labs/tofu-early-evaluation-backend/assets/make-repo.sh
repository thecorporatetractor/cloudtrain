#!/bin/sh
# Builds the internal Git repository ~/git/farm-base.git (bare, served from the file
# system): release tags v1.1.0 and v1.2.0, main ahead with unreleased work. Idempotent.
set -eu
r=$HOME/git/farm-base.git
[ -d "$r" ] && exit 0
w=$(mktemp -d)
cd "$w" && git init -q -b main && git config user.name "Grid Platform" && git config user.email platform@saltmarsh.example
mod() { # mod <version>
  cat > main.tf <<HCL
terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.9.0"
    }
  }
}

variable "farm" {
  description = "Wind farm name"
  type        = string
}

resource "local_file" "conf" {
  filename = "/home/learner/farms/\${var.farm}.conf"
  content  = "farm=\${var.farm}\\nmodule=$1\\n"
}
HCL
}
mod 1.1.0; git add . && git commit -q -m "farm-base 1.1.0" && git tag v1.1.0
mod 1.2.0; printf '# farm-base\n\n## 1.2.0\n- Files record the module release.\n' > CHANGELOG.md
git add . && git commit -q -m "farm-base 1.2.0" && git tag v1.2.0
mod 2.0.0-dev; git commit -q -am "WIP 2.0"
mkdir -p "$HOME/git" && git clone -q --bare "$w" "$r" && rm -rf "$w"
