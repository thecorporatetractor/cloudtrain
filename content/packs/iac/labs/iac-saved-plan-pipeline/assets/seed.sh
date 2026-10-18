#!/bin/sh
# Seeds the trading-limits stack (state in the local S3 store) and the pipeline repository
# once (a recreated pod must not overwrite the learner's work).
set -eu
s=/var/tmp/ct-seed; d=$HOME/stacks/trading-limits
[ -e "$d/.ct-seeded" ] && exit 0
ct-s3 start
ct-s3 bucket saltmarsh-state --versioning
mkdir -p "$d" "$HOME/trading" && cp "$s/stack/main.tf" "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color -var max_position_mw={{old}} >/dev/null
printf 'max_position_mw = {{limit}}\n' > terraform.tfvars
# The pipeline repository (the team's Git server is a bare repository here).
rm -rf "$HOME/git/trading-pipeline.git" "$HOME/src/trading-pipeline" /tmp/ct-pipe-init
mkdir -p "$HOME/git" "$HOME/src" /tmp/ct-pipe-init
git init -q --bare -b main "$HOME/git/trading-pipeline.git"
cd /tmp/ct-pipe-init && git init -q -b main
git config user.name "Saltmarsh CI"; git config user.email ci@saltmarsh.example
cp "$s/pipeline.sh" pipeline.sh && chmod 0755 pipeline.sh
git add pipeline.sh && git commit -q -m "pipeline: plan and apply"
git remote add origin "$HOME/git/trading-pipeline.git" && git push -q origin main
cd && rm -rf /tmp/ct-pipe-init
git clone -q "$HOME/git/trading-pipeline.git" "$HOME/src/trading-pipeline"
git -C "$HOME/src/trading-pipeline" config user.name "Saltmarsh Learner"
git -C "$HOME/src/trading-pipeline" config user.email learner@saltmarsh.example
touch "$d/.ct-seeded"
