#!/bin/sh
# Seeds and applies ~/exam/core-network, ~/exam/quotes and ~/exam/archive once (a
# recreated pod must not overwrite the candidate's work).
set -eu
s=/var/tmp/ct-seed/xiv-cross-stack-outputs
[ -e "$HOME/exam/archive/.ct-seeded" ] && exit 0
ct-s3 start && ct-s3 bucket sm-tfstate --versioning
for d in core-network quotes archive; do
  mkdir -p "$HOME/exam/$d" && cp "$s/$d/"*.tf "$HOME/exam/$d/"
  cd "$HOME/exam/$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
done
for d in core-network quotes archive; do touch "$HOME/exam/$d/.ct-seeded"; done
