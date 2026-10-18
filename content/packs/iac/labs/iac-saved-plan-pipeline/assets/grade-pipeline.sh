#!/bin/bash
# Grader: runs pipeline.sh from the main branch of ~/git/trading-pipeline.git against a
# throwaway fixture stack (own state key) and prints the outcome of one scenario.
#   grade-pipeline.sh approved|unapproved|wronghash|stale
set -uo pipefail
sc=${1:?scenario}
L() { runuser -u learner -- env -i HOME=/home/learner USER=learner LOGNAME=learner PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"; }
d=$(L mktemp -d /tmp/ct-pipe.XXXXXX); n=$(basename "$d"); art=/home/learner/artifacts/$n
trap 'rm -rf "$d" "$art"; ct-s3 api DELETE "/saltmarsh-state/ct-grade/$n.tfstate" >/dev/null 2>&1' EXIT
ct-s3 ensure >/dev/null 2>&1
L git --git-dir=/home/learner/git/trading-pipeline.git show main:pipeline.sh > "$d/pipeline.sh" 2>/dev/null || { echo no-pipeline; exit 0; }
chmod 0755 "$d/pipeline.sh"; chown learner:learner "$d/pipeline.sh"
st=$d/$n
L mkdir -p "$st"; L cp /var/tmp/ct-grade/fixture/main.tf "$st/main.tf"
L bash -c "cd $st && iac init -input=false -no-color -backend-config=key=ct-grade/$n.tfstate >/dev/null 2>&1 && iac apply -auto-approve -input=false -no-color -var limit=100 >/dev/null 2>&1" || { echo fixture-error; exit 0; }
L bash -c "echo 'limit = 200' > $st/terraform.tfvars"
P() { L bash -c "cd $d && ./pipeline.sh $1 $st" >/dev/null 2>&1; }
val() { cat "$st/out/limits.conf" 2>/dev/null | tr -d '\n'; }
P plan; prc=$?
[ $prc = 0 ] && [ -s "$art/tfplan" ] || { echo "plan-artifact-missing rc=$prc"; exit 0; }
[ -s "$art/tfplan.txt" ] || { echo "plan-text-missing"; exit 0; }
sha=$(sha256sum "$art/tfplan" | cut -d' ' -f1)
case $sc in
  approved) L bash -c "echo $sha > $art/approved" ;;
  unapproved) L rm -f "$art/approved" ;;
  wronghash) L bash -c "echo 0000000000000000000000000000000000000000000000000000000000000000 > $art/approved" ;;
  stale)
    L bash -c "echo $sha > $art/approved"
    L bash -c "cd $st && iac apply -auto-approve -input=false -no-color -var limit=300 >/dev/null 2>&1" || { echo fixture-error; exit 0; } ;;
esac
before=$(val)
P apply; rc=$?
after=$(val)
case $sc in
  approved) [ $rc = 0 ] && [ "$after" = limit=200 ] && echo applied || echo "not-applied rc=$rc $after" ;;
  *) [ $rc != 0 ] && [ "$after" = "$before" ] && echo refused || echo "not-refused rc=$rc $before->$after" ;;
esac
