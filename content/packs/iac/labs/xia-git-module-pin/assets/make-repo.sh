#!/bin/sh
# Builds the internal farm-base module repository /home/learner/git/farm-base.git
# (tags v1.2.0 and v1.3.0, main ahead at an unreleased 1.4.0-dev). Run as the learner.
set -eu
r=$HOME/git/farm-base.git
[ -d "$r" ] && exit 0
w=$(mktemp -d /tmp/farm-base.XXXXXX)
cd "$w"
git init -q -b main
git config user.name "Grid Platform"; git config user.email platform@saltmarsh.example
for v in 1.2.0 1.3.0 1.4.0-dev; do
  printf '%s\n' "$v" > VERSION
  cat > main.tf <<HCL
variable "farm" {
  description = "Wind farm name"
  type        = string
}

resource "local_file" "marker" {
  filename = "\${path.root}/out/farm-base.txt"
  content  = "farm-base $v farm=\${var.farm}\n"
}

output "version" {
  value = "$v"
}
HCL
  git add -A && git commit -q -m "farm-base $v"
  case $v in *-dev) ;; *) git tag "v$v" ;; esac
done
mkdir -p "$HOME/git" && git clone -q --bare "$w" "$r"
rm -rf "$w"
