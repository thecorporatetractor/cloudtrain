#!/bin/sh
# Seeds and applies ~/stacks/inland once with a vendored copy of farm-base 1.2.0.
set -eu
/var/tmp/ct-seed/make-repo.sh
d=$HOME/stacks/inland
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d/vendor" "$HOME/inland"
git clone -q --branch v1.2.0 "$HOME/git/farm-base.git" "$d/vendor/farm-base" 2>/dev/null && rm -rf "$d/vendor/farm-base/.git"
cat > "$d/main.tf" <<'HCL'
module "farm" {
  source    = "./vendor/farm-base"
  farm_name = "larkholt"
}
HCL
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
touch .ct-seeded
