#!/usr/bin/env bash
# Install pinned security CLIs into $RUNNER_TEMP/bin (CI) or $TOOLS_BIN, each
# verified against a pinned sha256. Usage: install-tools.sh gitleaks trivy ...
# Dependabot cannot bump these: update the version and sha256 together (the
# release's checksums file, or sha256sum of the asset) and note it in the PR.
set -euo pipefail

BIN=${TOOLS_BIN:-${RUNNER_TEMP:?}/bin}
mkdir -p "$BIN"
GH=https://github.com

# name|version|url|sha256|binary path inside the archive ("" for a bare binary)
TOOLS=(
  "actionlint|1.7.12|$GH/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz|8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8|actionlint"
  "gitleaks|8.30.1|$GH/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz|551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb|gitleaks"
  "gosec|2.29.0|$GH/securego/gosec/releases/download/v2.29.0/gosec_2.29.0_linux_amd64.tar.gz|6431b119741c1f4a50fdfcf94e782e16b9e642afc8c7fa9b5d39d48bf3003095|gosec"
  "grype|0.120.1|$GH/anchore/grype/releases/download/v0.120.1/grype_0.120.1_linux_amd64.tar.gz|0a9ee97ef5ae2ee953b0a80098105052e846cdbe319a57d808b519c33cd1343d|grype"
  "helm|3.22.0|https://get.helm.sh/helm-v3.22.0-linux-amd64.tar.gz|1e4ab49e429626cf6c6958d914248b78c9730803c2751b87627e171dc800e7bb|linux-amd64/helm"
  "hadolint|2.15.1|$GH/hadolint/hadolint/releases/download/v2.15.1/hadolint-linux-x86_64|c7187db94eeeeca956519a6af171adc31453941a1e777961f6e680f697c8c507|"
  "kube-linter|0.8.3|$GH/stackrox/kube-linter/releases/download/v0.8.3/kube-linter-linux.tar.gz|1a6d8419b11971372971fdbc22682b684ebfb7cf1c39591662d1b6ca736c41df|kube-linter"
  "osv-scanner|2.7.0|$GH/google/osv-scanner/releases/download/v2.7.0/osv-scanner_linux_amd64|160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b|"
  "shellcheck|0.11.0|$GH/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.linux.x86_64.tar.xz|8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198|shellcheck-v0.11.0/shellcheck"
  "syft|1.54.1|$GH/anchore/syft/releases/download/v1.54.1/syft_1.54.1_linux_amd64.tar.gz|c069905b391cc4c20a5ba65ad5c10be2a7ba074f8ea6ad203e24d14e303dad47|syft"
  "trivy|0.76.0|$GH/aquasecurity/trivy/releases/download/v0.76.0/trivy_0.76.0_Linux-64bit.tar.gz|e24b1c51293c1b15e4ba8d45bbc7891ba053f90278ec2698f3562c993e145fe7|trivy"
  "zizmor|1.30.1|$GH/zizmorcore/zizmor/releases/download/v1.30.1/zizmor-x86_64-unknown-linux-gnu.tar.gz|e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a|zizmor"
)

(($#)) || { echo "usage: $0 <tool>..." >&2; exit 2; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for want in "$@"; do
  found=
  for entry in "${TOOLS[@]}"; do
    IFS='|' read -r name version url sum member <<<"$entry"
    [[ $name == "$want" ]] || continue
    found=1
    file="$tmp/$(basename "$url")"
    curl -fsSL --retry 3 -o "$file" "$url"
    echo "$sum  $file" | sha256sum -c --quiet -
    if [[ -z $member ]]; then
      install -m 0755 "$file" "$BIN/$name"
    else
      mkdir -p "$tmp/$name"
      case $file in
        *.tar.xz) tar -xJf "$file" -C "$tmp/$name" ;;
        *) tar -xzf "$file" -C "$tmp/$name" ;;
      esac
      install -m 0755 "$tmp/$name/$member" "$BIN/$name"
    fi
    echo "installed $name $version"
  done
  [[ -n $found ]] || { echo "unknown tool: $want" >&2; exit 2; }
done
if [[ -n ${GITHUB_PATH:-} ]]; then echo "$BIN" >>"$GITHUB_PATH"; fi
