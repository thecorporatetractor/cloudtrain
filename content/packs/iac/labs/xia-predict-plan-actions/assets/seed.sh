#!/bin/sh
# Applies the current configuration once, then stages the pending change (not applied).
set -eu
d=$HOME/exam/predict
[ -e "$d/.ct-seeded" ] && exit 0
mkdir -p "$d/out" && cp /var/tmp/ct-seed/xia-predict-plan-actions/v1.tf "$d/main.tf"
cd "$d"
iac init -input=false -no-color >/dev/null
iac apply -auto-approve -input=false -no-color >/dev/null
upd=$1; [ "$upd" = gh ] && rep=rm || rep=gh
python3 - "$upd" "$rep" <<'PY'
import sys
upd, rep = sys.argv[1], sys.argv[2]
s = open("main.tf").read()
s = s.replace('''  input            = { firmware = "4.2" }
  triggers_replace = ["controller-a"]''', '''  input            = { firmware = each.key == "%s" ? "4.3" : "4.2" }
  triggers_replace = [each.key == "%s" ? "controller-b" : "controller-a"]''' % (upd, rep))
s = s.replace('content  = "batch=${random_pet.batch.id}\\n"', 'content  = "batch=${random_pet.batch.id}\\nsigned-off=ops\\n"')
s += '''
resource "terraform_data" "alarm" {
  input = { threshold_ms = 25 }
}
'''
open("main.tf", "w").write(s)
PY
touch .ct-seeded
