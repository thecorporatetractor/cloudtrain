#!/bin/bash
# Seeds ~/stacks/trading-ids once: applied with id-generator v1.4.0 and session-tokens v2.0.0
# (random 3.7.2 in the lock file), then the merged bump to session-tokens v2.1.0 that broke init.
set -euo pipefail
d=$HOME/stacks/trading-ids
[ -e "$d/.ct-seeded" ] && exit 0
/var/tmp/ct-seed/make-repos.sh
mkdir -p "$d" && cd "$d"
main() { # main <tokens tag>
  cat > main.tf <<HCL
terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = ">= 3.7.0"
    }
  }
}

module "ids" {
  source = "git::file:///home/learner/git/id-generator.git?ref=v1.4.0"
  desk   = "{{desk}}"
}

module "tokens" {
  source = "git::file:///home/learner/git/session-tokens.git?ref=$1"
}

output "trade_prefix" {
  value = module.ids.prefix
}
HCL
}
main v2.0.0
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color >/dev/null
main v2.1.0
touch .ct-seeded
