#!/usr/bin/env bash
# Path-aware CI: maps changed files to the check groups they need. One source of
# truth for the workflows' `changes` jobs and tools/ci/run-local.sh.
#
#   changes.sh --all                 every group true (push to main, schedule, manual)
#   changes.sh --pr <number>         the pull request's files (GitHub API; GH_TOKEN, REPO)
#   changes.sh < files.txt           one path per line (run-local.sh feeds git diff)
#
# Prints `group=true|false` lines (append to $GITHUB_OUTPUT) and a per-file trace on
# stderr. A file no rule knows, anything under .github/ or tools/ci/, or a pull
# request too large to list switches everything on (fail-safe). The table of what
# runs for each group is in docs/security-ci.md ("What runs when").
set -euo pipefail

GROUPS_ALL=(full content node web gateway go deps licenses lint code js actions)
declare -A on=()
for g in "${GROUPS_ALL[@]}"; do on[$g]=false; done

all() { for g in "${GROUPS_ALL[@]}"; do on[$g]=true; done; }
set_on() { for g in "$@"; do on[$g]=true; done; }
emit() { for g in "${GROUPS_ALL[@]}"; do echo "$g=${on[$g]}"; done; }

# classify <path>: switch on the groups the file needs.
classify() {
  local f=$1 hit=()
  case $f in
    .github/* | tools/ci/*) hit=(full) ;;
    # Lab content and the content tooling: the content gates (lab-verify, render --check,
    # schema and content tests, labctl validate, exam compile). Lab assets are excluded
    # from semgrep, shellcheck and CodeQL on purpose (deliberately insecure material).
    content/*) hit=(content) ;;
    THIRD_PARTY_LICENSES.md) hit=(licenses) ;;
    docs/* | *.md | LICENSE | NOTICE) hit=(content) ;;
    tools/curriculum/* | tools/lab-verify/*) hit=(content code js) ;;
    # TypeScript workspace.
    apps/web/*) hit=(node web code js) ;;
    services/gateway/*) hit=(node gateway code js) ;;
    packages/lab-schema/*) hit=(node web gateway go content code js) ;; # schema copy drift, lab-verify
    packages/*) hit=(node web gateway code js) ;;
    pnpm-lock.yaml | package.json | pnpm-workspace.yaml) hit=(node web gateway deps licenses code js) ;;
    turbo.json | tsconfig*.json | .npmrc) hit=(node code) ;;
    # Go: the gateway's content tests run the real labctl, hence content too.
    services/lab-orchestrator/*) hit=(go content code) ;;
    go.work | go.work.sum) hit=(go deps licenses code) ;;
    deploy/dev/postgres/*) hit=(node gateway code) ;;
    deploy/images/*) hit=(go code) ;; # labctl catalog check
    deploy/* | tools/*) hit=(code) ;;  # IaC and image builds run in iac.yml and images.yml
    .zap/*) hit=(web gateway) ;;
    osv-scanner.toml) hit=(deps) ;;
    .hadolint.yaml) hit=(lint) ;;
    .gitleaks.toml | .grype.yaml | .dockerignore | .gitignore | .editorconfig | Taskfile.yml) hit=(known) ;;
    *) hit=(full) ;; # unknown path: run everything
  esac
  # Cross-cutting file types (shellcheck/hadolint scope as in sast.yml; dependency manifests).
  case $f in content/*) ;; *.sh) hit+=(lint) ;; esac
  case ${f##*/} in
    *Dockerfile*) hit+=(lint) ;;
    package.json | go.mod | go.sum) hit+=(deps licenses) ;;
  esac
  case $f in tools/licenses/*) hit+=(licenses) ;; esac
  echo "  $f -> ${hit[*]}" >&2
  for g in "${hit[@]}"; do
    case $g in
      full) all ;;
      known) ;;
      *) on[$g]=true ;;
    esac
  done
}

case ${1:-} in
  --all)
    all
    echo "changes: full run (${2:-not a pull request})" >&2
    ;;
  --pr)
    pr=${2:?--pr needs a number}
    : "${REPO:?REPO=<owner/name> is required}"
    files=$(gh api --paginate "repos/$REPO/pulls/$pr/files?per_page=100" \
      --jq '.[] | .filename, (.previous_filename // empty)')
    n=$(grep -c . <<<"$files" || true)
    echo "changes: pull request #$pr, $n path(s)" >&2
    # The API lists at most 3000 files; an empty list means the call went wrong.
    if ((n == 0 || n >= 3000)); then all; else
      while IFS= read -r f; do [[ -n $f ]] && classify "$f"; done <<<"$files"
    fi
    ;;
  "")
    n=0
    while IFS= read -r f; do [[ -n $f ]] && { classify "$f"; n=$((n + 1)); }; done
    ((n > 0)) || echo "changes: no changed files" >&2
    ;;
  *) echo "usage: $0 [--all | --pr <number>] (or a file list on stdin)" >&2; exit 2 ;;
esac
${on[full]} && all
emit
