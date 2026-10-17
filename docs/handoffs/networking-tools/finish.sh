#!/bin/bash
# finish.sh <lab> <verified|built> "<commit summary>" ["status note"]
set -e
R=/home/hackrvl/cloudtrain/.worktrees/b-networking; S=/tmp/claude-1000/-home-hackrvl-kubernetes/8d59866e-5c04-4413-a521-970006657391/scratchpad/networking
lab=$1; st=$2; msg=$3; note=$4; cd $R
python3 $S/setstatus.py . $lab $st "$note"
python3 $S/sync_pack.py .
node tools/lab-verify/bin/lab-verify.mjs --strict 2>&1 | grep -E '^(ERROR|WARN)|error\(s\)'
git add content/packs/networking content/curriculum.yaml
[ -f deploy/.results/verify/$lab.json ] && git add -f deploy/.results/verify/$lab.json
git commit -q -m "feat(networking): $lab lab ($st)

$msg"
git log --oneline -1
