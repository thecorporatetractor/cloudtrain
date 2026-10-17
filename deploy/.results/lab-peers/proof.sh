#!/bin/bash
# Live proof: lab peers by name, isolation between labs and from the platform.
NS=ct-platform5-labs
pod() { kubectl -n $NS get pod -l labs.cloudtrain.dev/session=$1,labs.cloudtrain.dev/node=$2 -o jsonpath='{.items[0].metadata.name}'; }
WA=$(pod peers-a workstation); SA=$(pod peers-a s3store); WB=$(pod peers-b workstation); SB=$(pod peers-b s3store)
IPSA=$(kubectl -n $NS get pod $SA -o jsonpath='{.status.podIP}')
HA=$(kubectl -n $NS get svc -l labs.cloudtrain.dev/session=peers-a -o name | grep -- -nodes | cut -d/ -f2)
learner() { local p=$1; shift; kubectl -n $NS exec $p -c node -- runuser -u learner -- bash -lc "$*" 2>&1; }
root() { local p=$1; shift; kubectl -n $NS exec $p -c node -- bash -c "$*" 2>&1; }
t() { local name=$1 want=$2; shift 2; out=$("$@"); rc=$?; if { [ $want = ok ] && [ $rc = 0 ]; } || { [ $want = fail ] && [ $rc != 0 ]; }; then r=PASS; else r=FAIL; fi; printf '%-4s %-62s (want %s, rc %s)\n' $r "$name" $want $rc; printf '%s\n' "$out" | sed 's/^/       /' | head -6; }
date -u +"%FT%TZ"; echo "session A: $WA $SA ($IPSA, subdomain $HA); session B: $WB $SB"
echo "== intra-lab (session A)"
t "A workstation resolves s3store" ok learner $WA 'getent hosts s3store && grep ^search /etc/resolv.conf'
t "A workstation: S3 API on s3store:8333 (bucket proof-state)" ok learner $WA 'curl -sf -o /dev/null -w "%{http_code}\n" --max-time 10 -I http://s3store:8333/proof-state'
t "A workstation: git ls-remote git://s3store/modules.git" ok learner $WA 'git ls-remote git://s3store/modules.git main'
t "A workstation: terraform s3 backend at http://s3store:8333" ok learner $WA 'set -e; d=$(mktemp -d); cd $d; cat > main.tf <<TF
terraform {
  backend "s3" {
    bucket = "proof-state"
    key = "peers/terraform.tfstate"
    region = "us-east-1"
    endpoints = { s3 = "http://s3store:8333" }
    use_path_style = true
    use_lockfile = true
    skip_credentials_validation = true
    skip_region_validation = true
    skip_requesting_account_id = true
    skip_metadata_api_check = true
  }
}
resource "random_pet" "p" {}
TF
iac init -input=false >/dev/null && iac apply -auto-approve -input=false >/dev/null && curl -s --max-time 10 "http://s3store:8333/proof-state/peers/terraform.tfstate" | jq -r ".resources[0].instances[0].attributes.id"'
t "A s3store resolves workstation (FQDN)" ok root $SA "getent hosts workstation.$HA.$NS.svc.cluster.local"
t "A s3store -> A workstation pod (ICMP)" ok root $SA 'ping -c1 -W3 workstation'
echo "== between labs"
t "B workstation: plain s3store is B's own node" ok learner $WB "getent hosts s3store | grep -v $IPSA"
t "B workstation -> A s3store by FQDN (S3 :8333)" fail learner $WB "curl -s --max-time 8 http://s3store.$HA.$NS.svc.cluster.local:8333/"
t "B workstation -> A s3store pod IP (git :9418)" fail learner $WB "timeout 8 git ls-remote git://$IPSA/modules.git"
t "B s3store -> A s3store pod IP (S3 :8333)" fail root $SB "curl -s --max-time 8 http://$IPSA:8333/"
t "B s3store -> A s3store (ICMP)" fail root $SB "ping -c1 -W3 $IPSA"
echo "== from a lab to the platform (A s3store, a non-entry node)"
t "kube-apiserver 10.96.0.1:443" fail root $SA 'curl -sk --max-time 8 https://10.96.0.1:443/version'
t "kind node / host gateway 172.18.0.1:8787" fail root $SA 'curl -s --max-time 8 http://172.18.0.1:8787/'
t "internet 1.1.1.1:443" fail root $SA 'curl -s --max-time 8 https://1.1.1.1/'
t "manager metrics (ct-platform5-system pod)" fail root $SA "curl -s --max-time 8 http://$(kubectl -n ct-platform5-system get pod -o jsonpath='{.items[0].status.podIP}'):8081/healthz"
t "cluster DNS still works" ok root $SA 'getent hosts kubernetes.default.svc.cluster.local'
t "shared mirrors still reachable (mirror service)" ok root $SA "curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://mirror.cloudtrain-mirrors.svc.cluster.local/"
echo "== into a lab from outside"
kubectl -n ct-platform5-system run peer-probe --image=cloudtrain/nettools:1 --image-pull-policy=Never --restart=Never --command -- sleep 600 >/dev/null 2>&1
kubectl -n ct-platform5-system wait --for=condition=Ready pod/peer-probe --timeout=120s >/dev/null
t "platform pod (ct-platform5-system) -> A s3store :8333" fail kubectl -n ct-platform5-system exec peer-probe -- sh -c "nc -z -w 8 $IPSA 8333"
t "platform pod (ct-platform5-system) -> A workstation (ICMP)" fail kubectl -n ct-platform5-system exec peer-probe -- sh -c "ping -c1 -W3 $(kubectl -n $NS get pod $WA -o jsonpath='{.status.podIP}')"
t "control: platform pod -> cluster DNS :53" ok kubectl -n ct-platform5-system exec peer-probe -- sh -c "nc -z -w 8 10.96.0.10 53"
kubectl -n ct-platform5-system delete pod peer-probe --now >/dev/null 2>&1
