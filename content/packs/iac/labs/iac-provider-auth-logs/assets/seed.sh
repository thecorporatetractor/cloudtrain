#!/bin/bash
# Seeds ~/stacks/inland once: a kubeconfig for the inland deployer, an applied stack, then
# the "CA rotation" change that broke it (inland.yaml now points at the retired CA bundle),
# and the pending turbine change the pipeline could not apply.
set -euo pipefail
d=$HOME/stacks/inland
[ -e "$d/.ct-seeded" ] && exit 0
want=$1
mkdir -p "$d" "$HOME/pki"
cl=$(kubectl config view -o jsonpath='{.contexts[?(@.name=="sm-grid")].context.cluster}')
host=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$cl\")].cluster.server}")
kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$cl\")].cluster.certificate-authority-data}" | base64 -d > "$HOME/pki/sm-grid-ca.pem"
openssl req -x509 -newkey rsa:2048 -nodes -days 400 -subj "/CN=sm-grid-ca-2025" -keyout /dev/null -out "$HOME/pki/sm-grid-ca-2025.pem" 2>/dev/null
tok=$(kubectl --context sm-grid -n inland-sites get secret inland-deployer-token -o jsonpath='{.data.token}' | base64 -d)
kc() { # kc <ca file>
  cat > "$HOME/.kube/inland.yaml" <<YML
apiVersion: v1
kind: Config
clusters:
  - name: sm-grid
    cluster:
      server: $host
      certificate-authority: $1
users:
  - name: inland-deployer
    user:
      token: $tok
contexts:
  - name: inland
    context: {cluster: sm-grid, user: inland-deployer, namespace: inland-sites}
current-context: inland
YML
  chmod 0600 "$HOME/.kube/inland.yaml"
}
kc "$HOME/pki/sm-grid-ca.pem"
sed "s/SEED_TURBINES/14/" /var/tmp/ct-seed/main.tf > "$d/main.tf"
cd "$d" && iac init -input=false -no-color >/dev/null && iac apply -auto-approve -input=false -no-color >/dev/null
kc "$HOME/pki/sm-grid-ca-2025.pem"
sed "s/SEED_TURBINES/$want/" /var/tmp/ct-seed/main.tf > "$d/main.tf"
touch .ct-seeded
