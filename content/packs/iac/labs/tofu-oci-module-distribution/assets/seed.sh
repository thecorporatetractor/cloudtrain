#!/bin/sh
# Seeds the farm-base 2.0.0 source, publishes the mirrored providers and applies
# ~/stacks/inland once with tofu, still on the vendored farm-base 1.4.0.
set -eu
/var/tmp/ct-seed/publish-providers.sh
d=$HOME/stacks/inland
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d/vendor/farm-base" "$HOME/inland" "$HOME/modules/farm-base"
cp /var/tmp/ct-seed/farm-base-2.0.0/* "$HOME/modules/farm-base/"
cp /var/tmp/ct-seed/vendor/main.tf "$d/vendor/farm-base/main.tf"
printf 'module "farm" {\n  source = "./vendor/farm-base"\n  farm   = "{{farm}}"\n}\n' > "$d/main.tf"
cd "$d"
tofu init -input=false -no-color >/dev/null
tofu apply -auto-approve -input=false -no-color >/dev/null
grep -o '"h1:[^"]*"' .terraform.lock.hcl | tr -d '"' > .ct-seeded
