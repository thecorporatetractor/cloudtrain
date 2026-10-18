#!/usr/bin/env bash
# run-local.sh: the pre-push gate. Runs the checks CI would run for this branch's
# diff, chosen by the same change detection as the workflows
# (.github/scripts/changes.sh), and prints a pass/fail table. Exit 1 on any failure.
#
#   tools/ci/run-local.sh                       here (the VM clone, or any box with the toolchain)
#   tools/ci/run-local.sh --remote ct-testvm    sync this checkout to the VM and run it there
#
# Options:
#   --base <ref>       diff base (default: merge-base with origin/main)
#   --all              every check, whatever changed (what main runs)
#   --semgrep          also run semgrep (report-only, as in CI) on the changed files
#   --remote <host>    run on <host> in /srv/ct-work/dev/<slug> (ssh + rsync)
#   --slug <name>      clone directory name on the remote (default: the branch name)
#
# Not covered locally (CI only): CodeQL, DAST (ZAP), image builds and scans, IaC
# scanners, dependency-review, osv-scanner, SBOM. See docs/security-ci.md.
# Needs: git, node 22 + pnpm 9, go (go.mod's toolchain), gcc (go test -race), docker
# (Postgres for the gateway's DB suites). The scanner CLIs (gitleaks, actionlint,
# zizmor, hadolint and the shell linter) come pinned from .github/scripts/install-tools.sh
# into ~/.cache/cloudtrain-ci/bin.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "run-local: not in a git checkout" >&2; exit 2; }
cd "$ROOT" || exit 2

base="" mode_all=false semgrep=false remote="" slug="" pass_args=()
while (($#)); do
  case $1 in
    --base) base=${2:?--base needs a ref}; pass_args+=("$1" "$2"); shift ;;
    --all) mode_all=true; pass_args+=("$1") ;;
    --semgrep) semgrep=true; pass_args+=("$1") ;;
    --remote) remote=${2:?--remote needs a host}; shift ;;
    --slug) slug=${2:?--slug needs a name}; shift ;;
    -h | --help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "run-local: unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# --- remote mode: ship the checkout (commits as a bundle, uncommitted files by rsync) ---
if [[ -n $remote ]]; then
  git fetch -q origin main 2>/dev/null || echo "run-local: could not fetch origin/main, using the local copy" >&2
  mb=$(git merge-base origin/main HEAD) || { echo "run-local: no merge-base with origin/main" >&2; exit 2; }
  head=$(git rev-parse HEAD)
  branch=$(git rev-parse --abbrev-ref HEAD)
  [[ -n $slug ]] || slug=$(tr -c 'A-Za-z0-9._-' '-' <<<"${branch/#HEAD/detached}" | sed 's/-*$//')
  dir=/srv/ct-work/dev/$slug
  url=$(git remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#')
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  echo "run-local: $branch @ ${head:0:12} -> $remote:$dir"
  # The remote clone is ours only if it carries the marker; never reuse another agent's directory.
  # shellcheck disable=SC2029 # expand locally on purpose
  ssh "$remote" "set -e
    if [ -d '$dir' ] && [ ! -f '$dir/.git/run-local' ]; then echo 'run-local: $dir exists and is not a run-local clone; pass --slug' >&2; exit 3; fi
    if [ ! -d '$dir/.git' ]; then git clone -q '$url' '$dir' && touch '$dir/.git/run-local'; fi
    cd '$dir' && git fetch -q origin main" || exit 2
  if [[ $mb != "$head" ]]; then
    git bundle create -q "$tmp/branch.bundle" HEAD "^$mb" || exit 2
    rsync -q "$tmp/branch.bundle" "$remote:$dir/.git/run-local.bundle" || exit 2
    # shellcheck disable=SC2029
    ssh "$remote" "cd '$dir' && git fetch -q .git/run-local.bundle +HEAD:refs/run-local/head && rm -f .git/run-local.bundle" || exit 2
  fi
  # shellcheck disable=SC2029
  ssh "$remote" "cd '$dir' && git checkout -qf --detach '$head' && git clean -qfd -e node_modules -e bin" || exit 2
  # Uncommitted work: modified and untracked files are copied, deleted files removed.
  git ls-files -z -m -o --exclude-standard >"$tmp/changed"
  git ls-files -z -d >"$tmp/deleted"
  if [[ -s $tmp/changed ]]; then rsync -q -a --from0 --files-from="$tmp/changed" ./ "$remote:$dir/" || exit 2; fi
  if [[ -s $tmp/deleted ]]; then
    # shellcheck disable=SC2029
    tr '\0' '\n' <"$tmp/deleted" | ssh "$remote" "cd '$dir' && xargs -r -d '\n' rm -f --" || exit 2
  fi
  # shellcheck disable=SC2029
  ssh "$remote" "bash -lc 'cd $dir && tools/ci/run-local.sh --base $mb ${pass_args[*]}'"
  exit $?
fi

# --- what changed ---
CACHE=${CT_CI_CACHE:-$HOME/.cache/cloudtrain-ci}
LOGS=$(mktemp -d "${TMPDIR:-/tmp}/run-local.XXXXXX")
export TOOLS_BIN=$CACHE/bin
export PATH="$TOOLS_BIN:$PATH"
mkdir -p "$TOOLS_BIN"

if [[ -z $base ]]; then
  git fetch -q origin main 2>/dev/null || true
  base=$(git merge-base origin/main HEAD 2>/dev/null) || { echo "run-local: no merge-base with origin/main; pass --base" >&2; exit 2; }
fi
base=$(git rev-parse "$base") || exit 2

if $mode_all; then
  flags=$(bash .github/scripts/changes.sh --all "run-local --all" 2>"$LOGS/changes.log")
else
  flags=$({ git diff --name-only "$base"...HEAD; git diff --name-only HEAD; git ls-files -o --exclude-standard; } |
    sort -u | bash .github/scripts/changes.sh 2>"$LOGS/changes.log")
fi
declare -A on=()
while IFS='=' read -r k v; do on[$k]=$v; done <<<"$flags"
echo "run-local: $(git rev-parse --short HEAD) vs base $(git rev-parse --short "$base"); logs in $LOGS"
echo "groups on: $(for k in "${!on[@]}"; do [[ ${on[$k]} == true ]] && printf '%s ' "$k"; done)"
is() { [[ ${on[$1]:-false} == true ]]; }

# --- result table ---
names=() results=() secs=()
failed=0
run() { # run <name> <command...>: one row of the table; output in $LOGS/<name>.log
  local name=$1 log t0 rc
  shift
  log="$LOGS/$(printf %s "$name" | tr -c 'A-Za-z0-9._-' '_').log"
  printf '  %-44s ' "$name"
  t0=$SECONDS
  "$@" >"$log" 2>&1
  rc=$?
  names+=("$name") secs+=($((SECONDS - t0)))
  if ((rc == 0)); then results+=(PASS); echo "PASS ($((SECONDS - t0))s)"
  else results+=(FAIL); failed=1; echo "FAIL ($((SECONDS - t0))s) -> $log"; tail -n 15 "$log" | sed 's/^/      /'; fi
}
skip() { names+=("$1") results+=("SKIP") secs+=(0); printf '  %-44s SKIP (%s)\n' "$1" "$2"; }
report() { names+=("$1") results+=("REPORT") secs+=("$2"); }

# --- preflight: fail fast on a missing toolchain ---
need=() missing=()
if is node || is content; then need+=(node pnpm go); fi
if is go || is content || is licenses; then need+=(go); fi
is licenses && need+=(pnpm)
is go && need+=(gcc)
is node && need+=(docker)
for t in git "${need[@]}"; do command -v "$t" >/dev/null || missing+=("$t"); done
if ((${#missing[@]})); then
  echo "run-local: missing toolchain: ${missing[*]}" >&2
  for t in "${missing[@]}"; do
    case $t in
      gcc) echo "  gcc: go test -race needs cgo. Install build-essential (tools/verify-vm/toolchain.sh does on the VM)." >&2 ;;
      docker) echo "  docker: the gateway's DB suites run against a throwaway Postgres container." >&2 ;;
      *) echo "  $t: see tools/verify-vm/toolchain.sh for the pinned versions." >&2 ;;
    esac
  done
  exit 2
fi
# Pinned scanner CLIs, installed once per version into the cache.
tools=(gitleaks)
is lint && tools+=(actionlint zizmor shellcheck hadolint)
for t in "${tools[@]}"; do
  ver=$(grep -oE "\"$t\|[^|]+" .github/scripts/install-tools.sh | cut -d'|' -f2)
  stamp="$TOOLS_BIN/.$t-$ver"
  [[ -x $TOOLS_BIN/$t && -f $stamp ]] && continue
  bash .github/scripts/install-tools.sh "$t" >"$LOGS/install-$t.log" 2>&1 || { echo "run-local: installing $t failed ($LOGS/install-$t.log)" >&2; exit 2; }
  rm -f "$TOOLS_BIN/.$t-"*; touch "$stamp"
done

# --- Postgres for the gateway's DB suites (throwaway container, random port) ---
PG=""
pg_up() {
  local img port
  img=$(grep -m1 -oE 'postgres:[^ ]+@sha256:[0-9a-f]+' .github/workflows/ci.yml)
  port=$((20000 + RANDOM % 20000))
  PG=ct-run-local-pg-$$
  docker run -d --rm --name "$PG" -e POSTGRES_PASSWORD=postgres-ci-only -p "127.0.0.1:$port:5432" "$img" >/dev/null || return 1
  for _ in $(seq 1 60); do docker exec "$PG" pg_isready -U postgres -q 2>/dev/null && break; sleep 1; done
  sleep 1
  docker exec -i "$PG" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 <deploy/dev/postgres/init.sql || return 1
  export CT_TEST_DATABASE_URL="postgres://cloudtrain_owner:owner-dev-only@127.0.0.1:$port/cloudtrain"
}
cleanup() { [[ -n $PG ]] && docker rm -f "$PG" >/dev/null 2>&1; }
trap cleanup EXIT

echo
echo "checks:"
GODIR=services/lab-orchestrator

# node (build, typecheck, test, content)
if is node || is content; then
  run "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile
  run "labctl build" go build -C "$GODIR" -o bin/labctl ./cmd/labctl
  if is node; then
    run "postgres (throwaway container)" pg_up
    run "pnpm -r build" pnpm -r build
    run "pnpm -r typecheck" pnpm -r --if-present typecheck
    run "pnpm -r test" pnpm -r test
  else
    run "schema + content tests (content mode)" bash -c '
      pnpm --filter "@cloudtrain/gateway^..." build &&
      pnpm --filter @cloudtrain/lab-schema --filter @cloudtrain/lab-verify test &&
      pnpm --filter @cloudtrain/gateway exec vitest run --testTimeout=30000 test/content.test.ts'
  fi
  run "lab-verify --strict" node tools/lab-verify/bin/lab-verify.mjs --strict
  run "curriculum render --check" node tools/curriculum/render.mjs --check
else
  skip "node (build, typecheck, test, content)" "no node or content change"
fi

# go (vet, test, build, generate drift, labs)
labs_gate() {
  for d in ../../content/packs/*/labs; do bin/labctl validate "$d" || return 1; done
  make samples
}
exams_gate() {
  # Same exam list as ci.yml (the exams whose pools are complete).
  local exams
  exams=$(grep -m1 -oE 'bin/labctl exam compile sim-[a-z0-9 -]+' "$ROOT/.github/workflows/ci.yml" | sed 's#bin/labctl exam compile ##')
  # shellcheck disable=SC2086 # word splitting on purpose
  bin/labctl exam compile $exams >/dev/null &&
    bin/labctl exam compile --exams testdata/exams/exams.yaml --labs testdata/exams/tasks sim-test-k8s-dev >/dev/null
}
generate_drift() {
  make generate && git diff --exit-code -- . ../../packages/lab-schema && test -z "$(git status --porcelain -- .)"
}
if is go || is content; then
  pushd "$GODIR" >/dev/null || exit 2
  if is go; then
    run "go vet" go vet ./...
    run "go test -race" go test -race ./...
    run "make build" make build
    run "make generate drift" generate_drift
    run "labctl catalog check" bin/labctl catalog check \
      --catalog ../../deploy/images/catalog.yaml,../../deploy/images/overlays/iac-opentofu.yaml \
      --workflow ../../.github/workflows/images.yml
  else
    run "make labctl" make labctl
  fi
  run "labctl validate (every pack)" labs_gate
  run "labctl exam compile" exams_gate
  popd >/dev/null || exit 2
else
  skip "go (vet, test, build, generate drift, labs)" "no go or content change"
fi

# licenses (inventory drift, copyleft gate)
licenses_gate() {
  pnpm install --frozen-lockfile || return 1
  (cd "$GODIR" && go install github.com/google/go-licenses/v2@v2.0.1) || return 1
  PATH="$(go env GOPATH)/bin:$PATH" bash tools/licenses/inventory.sh || return 1
  git diff --exit-code --stat -- THIRD_PARTY_LICENSES.md || { echo "THIRD_PARTY_LICENSES.md is stale: run tools/licenses/inventory.sh and commit it"; return 1; }
  bash tools/licenses/check.sh
}
if is licenses; then run "licenses (inventory drift, copyleft)" licenses_gate
else skip "licenses (inventory drift, copyleft gate)" "no dependency change"; fi

# gitleaks over the branch's commits (as on a PR), plus the uncommitted files.
gitleaks_gate() {
  gitleaks git --config .gitleaks.toml --redact --no-banner --log-opts="--no-merges $base..HEAD" . || return 1
  local f
  f=$(mktemp -d)
  { git diff --name-only HEAD; git ls-files -o --exclude-standard; } | sort -u | while IFS= read -r p; do
    [[ -f $p ]] && mkdir -p "$f/$(dirname "$p")" && cp "$p" "$f/$p"
  done
  if [[ -n $(ls -A "$f") ]]; then gitleaks dir --config .gitleaks.toml --redact --no-banner "$f" || { rm -rf "$f"; return 1; }; fi
  rm -rf "$f"
}
run "gitleaks (branch commits + uncommitted)" gitleaks_gate

# hadolint, shellcheck, actionlint, zizmor (sast.yml lint job)
if is lint; then
  run "hadolint (error)" bash -c "git ls-files -z '*Dockerfile*' | xargs -0 hadolint --failure-threshold error"
  run "shellcheck (warning)" bash -c "git ls-files -z 'deploy/*.sh' 'tools/*.sh' 'services/*.sh' '.github/*.sh' | xargs -0 shellcheck -S warning"
  run "actionlint" actionlint -shellcheck "$TOOLS_BIN/shellcheck"
  zizmor_gate() {
    local tok=${GH_TOKEN:-${GITHUB_TOKEN:-}}
    [[ -n $tok ]] || tok=$(gh auth token 2>/dev/null || true)
    if [[ -n $tok ]]; then GH_TOKEN=$tok zizmor --min-severity medium .github
    else echo "no GitHub token: offline audits only (CI also runs the online ones)"; zizmor --offline --min-severity medium .github; fi
  }
  run "zizmor (medium)" zizmor_gate
else
  skip "hadolint, shellcheck, actionlint, zizmor" "no workflow, script or Dockerfile change"
fi

# semgrep (optional; report-only, as in CI): the changed files outside content/ and docs/.
if $semgrep; then
  if is code; then
    t0=$SECONDS
    if [[ ! -x $CACHE/semgrep/bin/semgrep ]]; then
      python3 -m venv "$CACHE/semgrep" && "$CACHE/semgrep/bin/pip" install -q --disable-pip-version-check semgrep==1.180.0 >"$LOGS/install-semgrep.log" 2>&1
    fi
    mapfile -t files < <({ git diff --name-only "$base"...HEAD; git diff --name-only HEAD; git ls-files -o --exclude-standard; } |
      sort -u | grep -vE '^(content|docs)/' | while IFS= read -r p; do [[ -f $p ]] && echo "$p"; done)
    if ((${#files[@]})); then
      "$CACHE/semgrep/bin/semgrep" scan --metrics=off --timeout 60 --quiet \
        --config p/default --config p/typescript --config p/golang --config p/secrets \
        --config p/dockerfile --config p/kubernetes --json --output "$LOGS/semgrep.json" "${files[@]}" >"$LOGS/semgrep.log" 2>&1
      n=$(jq '.results | length' "$LOGS/semgrep.json" 2>/dev/null || echo "?")
      report "semgrep: $n finding(s), see $LOGS/semgrep.json" $((SECONDS - t0))
      printf '  %-44s REPORT\n' "semgrep ($n finding(s))"
    else skip "semgrep (report)" "no code files"; fi
  else skip "semgrep (report)" "no code change"; fi
fi

# --- summary ---
echo
printf '%-50s %-7s %s\n' CHECK RESULT SECONDS
printf '%-50s %-7s %s\n' "$(printf '%.0s-' {1..50})" ------- -------
for i in "${!names[@]}"; do printf '%-50s %-7s %s\n' "${names[$i]}" "${results[$i]}" "${secs[$i]}"; done
echo
echo "Not run here (CI only): CodeQL, ZAP, image build+scan, IaC scanners, dependency-review, osv-scanner, SBOM."
if ((failed)); then echo "run-local: FAILED (logs in $LOGS)"; exit 1; fi
echo "run-local: all checks passed"
