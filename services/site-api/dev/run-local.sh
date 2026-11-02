#!/usr/bin/env bash
# The local integration run (docs/deploy-site-vm.md, "Local run"): Azurite and the Functions' real
# handlers on this machine, Caddy and the sidecar from deploy/site-vm/compose.yaml in containers, on
# ports of their own, and a real browser driving the form. Never touches Azure or Cloudflare.
#
#   dev/run-local.sh up <work dir> <built site dir>    # starts everything
#   dev/run-local.sh down <work dir>
#   SITE_LOCAL_WORK=<work dir> node dev/integration.mjs   # the checks, while it is up
set -euo pipefail
cmd=${1:?up or down}; work=${2:?work dir}; site=${3:-}
here=$(cd "$(dirname "$0")/.." && pwd); repo=$(cd "$here/../.." && pwd)
project=ct-siteapi-local
: "${AZURITE_BASE:=16100}" "${SITE_DEV_PORT:=16110}" "${HTTPS_PORT:=16143}"
compose() { docker compose -p "$project" --project-directory "$work/vm" -f "$work/vm/compose.yaml" -f "$work/vm/compose.local.yaml" --env-file "$work/vm/.env" "$@"; }

if [[ $cmd == down ]]; then
  compose down --volumes --remove-orphans 2>/dev/null || true
  for f in host azurite; do [[ -f $work/$f.pid ]] && kill "$(cat "$work/$f.pid")" 2>/dev/null || true; rm -f "$work/$f.pid"; done
  exit 0
fi

mkdir -p "$work/azurite" "$work/vm"
cp -r "$repo/deploy/site-vm/." "$work/vm/"
rm -rf "$work/vm/site"; cp -r "${site:?built site dir}" "$work/vm/site"
mkdir -p "$work/vm/certs"
# A local stand-in for Cloudflare's origin pull CA, and a second one that must be refused. Nothing
# here comes from Cloudflare. SITE_CLIENT_AUTH_MODE=verify_if_given is the mode without enforcement,
# for local development by hand.
ca() { openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=$1" -keyout "$work/vm/certs/$1.key" -out "$work/vm/certs/$1.pem" 2>/dev/null; }
leaf() {
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$2" -keyout "$work/$2.key" -out "$work/$2.csr" 2>/dev/null
  openssl x509 -req -days 2 -in "$work/$2.csr" -CA "$work/vm/certs/$1.pem" -CAkey "$work/vm/certs/$1.key" -CAcreateserial -out "$work/$2.pem" 2>/dev/null
}
if [[ ! -f $work/client.pem ]]; then
  ca local-pull-ca; ca wrong-ca; leaf local-pull-ca client; leaf wrong-ca wrong-client
fi
cp "$work/vm/certs/local-pull-ca.pem" "$work/vm/certs/origin-pull-ca.pem"
[[ -f $work/vm/certs/origin.pem ]] || openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,DNS:www.localhost' -keyout "$work/vm/certs/origin.key" -out "$work/vm/certs/origin.pem" 2>/dev/null
chmod 644 "$work/vm/certs/origin.key"
cat > "$work/vm/.env" <<ENV
SITE_HOST=localhost
HTTPS_PORT=$HTTPS_PORT
SITE_PROXY_IMAGE=${SITE_PROXY_IMAGE:-cloudtrain/site-proxy:siteapi-local}
SITE_PROXY_FUNCTION_URL=http://host.docker.internal:$SITE_DEV_PORT
SITE_PROXY_FUNCTION_AUDIENCE=api://local
SITE_PROXY_CLIENT_ID=00000000-0000-0000-0000-000000000001
SITE_PROXY_IMDS_URL=http://host.docker.internal:$SITE_DEV_PORT/metadata/identity/oauth2/token
${SITE_CLIENT_AUTH_MODE:+SITE_CLIENT_AUTH_MODE=$SITE_CLIENT_AUTH_MODE}
ENV
cat > "$work/vm/compose.local.yaml" <<'YAML'
name: ct-siteapi-local
services:
  site-proxy:
    extra_hosts: ['host.docker.internal:host-gateway']
networks:
  site:
    ipam:
      config: [{ subnet: 10.250.77.0/24 }]
YAML
# The local network has its own subnet, so the fixed addresses move with it.
sed -i 's/10\.250\.50\./10.250.77./' "$work/vm/compose.yaml"

# The emulator's public, documented development key, from its own package.
key=$(grep -rhoE '[A-Za-z0-9+/]{86}==' "$here/node_modules/azurite/dist/src/common/utils/constants.js" | head -1)
[[ -n $key ]] || { echo "no Azurite key found" >&2; exit 1; }
export SITE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=$key;BlobEndpoint=http://127.0.0.1:$AZURITE_BASE/devstoreaccount1;QueueEndpoint=http://127.0.0.1:$((AZURITE_BASE + 1))/devstoreaccount1;TableEndpoint=http://127.0.0.1:$((AZURITE_BASE + 2))/devstoreaccount1;"
nohup "$here/node_modules/.bin/azurite" --silent --skipApiVersionCheck --location "$work/azurite" --blobPort "$AZURITE_BASE" --queuePort "$((AZURITE_BASE + 1))" --tablePort "$((AZURITE_BASE + 2))" > "$work/azurite.log" 2>&1 &
echo $! > "$work/azurite.pid"
sleep 2

export SITE_DEV_PORT CT_GDPR_HMAC_KEY=local-only-not-a-secret SITE_ALLOWED_PRINCIPAL_ID=00000000-0000-0000-0000-00000000aaaa AZURE_CLIENT_ID=unused SITE_PUBLIC_URL=https://localhost:$HTTPS_PORT SITE_QUEUE_NAME=privacy-requests SITE_LEDGER_COPY_CONTAINER=ledger-copy SITE_LOG_SAMPLE=1
( cd "$here" && exec nohup node --import tsx dev/local-host.ts ) > "$work/host.log" 2>&1 &
echo $! > "$work/host.pid"
for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$SITE_DEV_PORT/__dev/mail" >/dev/null && break; sleep 1; done
compose up -d --quiet-pull
compose ps
