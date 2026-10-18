#!/bin/sh
# Seeds and applies ~/stacks/trading once with tofu (plaintext S3 state), installs the
# key agent and the passphrase file.
set -eu
ct-s3 start
ct-s3 bucket saltmarsh-state --versioning
d=$HOME/stacks/trading
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d" "$HOME/reports" "$HOME/bin" "$HOME/.config/saltmarsh" "$HOME/.config/sm-keyagent"
install -m 0755 /var/tmp/ct-seed/sm-keyagent "$HOME/bin/sm-keyagent"
[ -s "$HOME/.config/sm-keyagent/key" ] || head -c 32 /dev/urandom | base64 > "$HOME/.config/sm-keyagent/key"
chmod 0600 "$HOME/.config/sm-keyagent/key"
printf '%s\n' "{{pass}}" > "$HOME/.config/saltmarsh/trading.passphrase" && chmod 0600 "$HOME/.config/saltmarsh/trading.passphrase"
cp /var/tmp/ct-seed/main.tf "$d/main.tf"
cd "$d"
tofu init -input=false -no-color >/dev/null
tofu apply -auto-approve -input=false -no-color >/dev/null
tofu show -json | jq -r '.values.root_module.resources[] | select(.type == "random_pet") | .values.id' > .ct-seeded
