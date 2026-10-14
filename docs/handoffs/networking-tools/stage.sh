#!/bin/bash
# stage.sh <lab>: move a draft into the pack (status built) and run static validation
set -e
R=/home/hackrvl/cloudtrain/.worktrees/b-networking; S=/tmp/claude-1000/-home-hackrvl-kubernetes/8d59866e-5c04-4413-a521-970006657391/scratchpad/networking
lab=$1; cd $R
[ -d /tmp/claude-1000/-home-hackrvl-kubernetes/8d59866e-5c04-4413-a521-970006657391/scratchpad/networking/drafts/$lab ] && rm -rf content/packs/networking/labs/$lab && mv /tmp/claude-1000/-home-hackrvl-kubernetes/8d59866e-5c04-4413-a521-970006657391/scratchpad/networking/drafts/$lab content/packs/networking/labs/
python3 $S/setstatus.py . $lab built
python3 $S/sync_pack.py .
node tools/lab-verify/bin/lab-verify.mjs --strict 2>&1 | grep -E '^(ERROR|WARN)|error\(s\)'
services/lab-orchestrator/bin/labctl validate content/packs/networking/labs/$lab | tail -1
