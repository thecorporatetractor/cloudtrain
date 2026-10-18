#!/bin/bash
# Builds the internal Git repositories (bare repos served from the file system):
#   ~/git/id-generator.git   v1.4.0 (random ~> 3.7.0), v1.5.0 (random >= 3.7.0, < 4.0.0),
#                            v2.0.0 (breaking: input and resource renamed, random ~> 3.9)
#   ~/git/session-tokens.git v2.0.0 (random >= 3.7.0), v2.1.0 (random >= 3.8.0)
# Idempotent.
set -euo pipefail
g=$HOME/git
mkdir -p "$g"
repo() { # repo <name> : starts a work tree in $w
  w=$(mktemp -d); cd "$w"; git init -q -b main
  git config user.name "Trading Platform"; git config user.email platform@saltmarsh.example
}
publish() { mkdir -p "$g" && git clone -q --bare "$w" "$g/$1.git" && cd / && rm -rf "$w"; }

if [ ! -d "$g/id-generator.git" ]; then
  repo id-generator
  ids() { # ids <constraint> <input> <resource name>
    cat > main.tf <<HCL
terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "$1"
    }
  }
}

variable "$2" {
  description = "Trading desk the prefix belongs to"
  type        = string
}

resource "random_id" "$3" {
  byte_length = 4
  keepers = {
    desk = var.$2
  }
}

output "prefix" {
  value = random_id.$3.hex
}
HCL
  }
  ids "~> 3.7.0" desk trade_prefix
  printf '# id-generator\n\n## 1.4.0\n- Trade id prefixes per desk.\n' > CHANGELOG.md
  git add . && git commit -q -m "id-generator 1.4.0" && git tag v1.4.0
  ids ">= 3.7.0, < 4.0.0" desk trade_prefix
  printf '# id-generator\n\n## 1.5.0\n- Widen the random provider constraint to >= 3.7.0, < 4.0.0 (no other change).\n\n## 1.4.0\n- Trade id prefixes per desk.\n' > CHANGELOG.md
  git add . && git commit -q -m "id-generator 1.5.0: widen random constraint" && git tag v1.5.0
  ids "~> 3.9" desk_name prefix
  printf '# id-generator\n\n## 2.0.0\n- BREAKING: input desk renamed to desk_name; resource random_id.trade_prefix renamed to random_id.prefix (the prefix is regenerated unless you move it).\n- Requires random ~> 3.9.\n\n## 1.5.0\n- Widen the random provider constraint to >= 3.7.0, < 4.0.0 (no other change).\n\n## 1.4.0\n- Trade id prefixes per desk.\n' > CHANGELOG.md
  git add . && git commit -q -m "id-generator 2.0.0" && git tag v2.0.0
  publish id-generator
fi

if [ ! -d "$g/session-tokens.git" ]; then
  repo session-tokens
  tok() { # tok <constraint>
    cat > main.tf <<HCL
terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "$1"
    }
  }
}

resource "random_string" "session_salt" {
  length  = 16
  special = false
}

output "salt" {
  value = random_string.session_salt.result
}
HCL
  }
  tok ">= 3.7.0"
  printf '# session-tokens\n\n## 2.0.0\n- Session salt.\n' > CHANGELOG.md
  git add . && git commit -q -m "session-tokens 2.0.0" && git tag v2.0.0
  tok ">= 3.8.0"
  printf '# session-tokens\n\n## 2.1.0\n- Requires random >= 3.8.0 (fix for CVE in salt generation upstream). Resources unchanged.\n\n## 2.0.0\n- Session salt.\n' > CHANGELOG.md
  git add . && git commit -q -m "session-tokens 2.1.0: require random >= 3.8.0" && git tag v2.1.0
  publish session-tokens
fi
