#!/bin/sh
# Seeds ~/stacks/farm once (not initialised) and prepares the bucket and the module repo.
set -eu
ct-s3 start
ct-s3 bucket saltmarsh-state --versioning
/var/tmp/ct-seed/make-repo.sh
d=$HOME/stacks/farm
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d/farms" "$HOME/farms" && cp /var/tmp/ct-seed/main.tf "$d/main.tf"
printf 'farm          = "gullhaven"\nfarm_base_ref = "v1.2.0"\n' > "$d/farms/gullhaven.tfvars"
printf 'farm          = "redmoor"\nfarm_base_ref = "v1.1.0"\n' > "$d/farms/redmoor.tfvars"
touch "$d/.ct-seeded"
