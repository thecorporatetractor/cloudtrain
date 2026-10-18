#!/usr/bin/env bash
# Toolchain for the CloudTrain verify VM (run as ubuntu, uses sudo for /usr/local).
set -euo pipefail
GO_VERSION=1.27.2
NODE_VERSION=22.23.1
PNPM_VERSION=9.15.9
KUBECTL_VERSION=v1.37.1
HELM_VERSION=v4.3.0
HELM_TARBALL_SHA256=86584a54def73570558f66f5111cc53dfed56689637ae32c1201205d494f54fb
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cd "$tmp"

# Go: sha256 from go.dev's JSON release index
if ! /usr/local/go/bin/go version 2>/dev/null | grep -q "go$GO_VERSION "; then
  f=go$GO_VERSION.linux-amd64.tar.gz
  curl -fsSL --retry 3 -o "$f" "https://go.dev/dl/$f"
  sum=$(curl -fsSL 'https://go.dev/dl/?mode=json&include=all' | jq -r --arg f "$f" '.[].files[] | select(.filename==$f) | .sha256')
  [[ -n $sum ]] || { echo "no sha for $f"; exit 1; }
  echo "$sum  $f" | sha256sum -c -
  sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf "$f"
fi

# Node: SHASUMS256.txt from nodejs.org
if ! /usr/local/bin/node --version 2>/dev/null | grep -qx "v$NODE_VERSION"; then
  f=node-v$NODE_VERSION-linux-x64.tar.xz
  curl -fsSL --retry 3 -o "$f" "https://nodejs.org/dist/v$NODE_VERSION/$f"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep " $f\$" | sha256sum -c -
  sudo tar -C /usr/local --strip-components=1 -xJf "$f" --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
fi
# pnpm (npm checks the registry integrity hash)
pnpm --version 2>/dev/null | grep -qx "$PNPM_VERSION" || sudo /usr/local/bin/npm install -g --no-fund --no-audit "pnpm@$PNPM_VERSION"

# kubectl: sha256 from dl.k8s.io
if ! kubectl version --client 2>/dev/null | grep -q "$KUBECTL_VERSION"; then
  curl -fsSLO --retry 3 "https://dl.k8s.io/release/$KUBECTL_VERSION/bin/linux/amd64/kubectl"
  echo "$(curl -fsSL "https://dl.k8s.io/release/$KUBECTL_VERSION/bin/linux/amd64/kubectl.sha256")  kubectl" | sha256sum -c -
  sudo install -m 0755 kubectl /usr/local/bin/kubectl
fi
# helm: sha256 pinned in deploy/versions.env
if ! helm version --short 2>/dev/null | grep -q "$HELM_VERSION"; then
  f=helm-$HELM_VERSION-linux-amd64.tar.gz
  curl -fsSL --retry 3 -o "$f" "https://get.helm.sh/$f"
  echo "$HELM_TARBALL_SHA256  $f" | sha256sum -c -
  tar -xzf "$f" && sudo install -m 0755 linux-amd64/helm /usr/local/bin/helm
fi
# build-essential: gcc for cgo, which `go test -race` needs (tools/ci/run-local.sh).
sudo apt-get install -y -qq tmux rsync sysstat bzip2 build-essential >/dev/null
go_bin=/usr/local/go/bin
grep -q '/usr/local/go/bin' ~/.profile || cat >> ~/.profile <<'EOF'
export PATH="$HOME/.local/bin:/usr/local/go/bin:$HOME/go/bin:$PATH"
export GOTOOLCHAIN=go1.27.2
EOF
echo "go $($go_bin/go version | awk '{print $3}') node $(node --version) pnpm $(pnpm --version) kubectl $KUBECTL_VERSION helm $(helm version --short)"
