#!/usr/bin/env bash
# The images workflow's build matrix for one run: every image of the publish
# matrix (jobs.publish.strategy.matrix.include), or on a pull request only the
# images whose `paths` (space-separated shell patterns, `*` crosses `/`) match a
# changed file. Changes to images.yml or the shared scripts rebuild every image;
# deploy/versions.env rebuilds every image that takes build args from it.
#
#   image-matrix.sh <images.yml> --all
#   image-matrix.sh <images.yml> --pr <number>     (GitHub API; GH_TOKEN, REPO)
#   image-matrix.sh <images.yml> < files.txt
#
# Prints the GitHub outputs `matrix` ({"include": [...]}) and `any` (true|false).
set -euo pipefail

wf=${1:?usage: $0 <images.yml> [--all | --pr <number>]}
shift
all=$(yq -o=json -I=0 '.jobs.publish.strategy.matrix.include' "$wf")
[[ $(jq length <<<"$all") -gt 0 ]] || { echo "image-matrix: no images in $wf" >&2; exit 1; }

case ${1:-} in
  --all) files=ALL ;;
  --pr)
    : "${REPO:?REPO=<owner/name> is required}"
    files=$(gh api --paginate "repos/$REPO/pulls/${2:?--pr needs a number}/files?per_page=100" \
      --jq '.[] | .filename, (.previous_filename // empty)')
    n=$(grep -c . <<<"$files" || true)
    ((n > 0 && n < 3000)) || files=ALL
    ;;
  "") files=$(cat) ;;
  *) echo "usage: $0 <images.yml> [--all | --pr <number>]" >&2; exit 2 ;;
esac

rebuild_all=false
args_all=false
if [[ $files == ALL ]]; then rebuild_all=true; else
  while IFS= read -r f; do
    case $f in
      .github/workflows/images.yml | .github/scripts/install-tools.sh | .github/scripts/build-args.sh | \
        .github/scripts/image-matrix.sh | .github/images/* | .grype.yaml) rebuild_all=true ;;
      deploy/versions.env) args_all=true ;;
    esac
  done <<<"$files"
fi

picked='[]'
count=$(jq length <<<"$all")
for ((i = 0; i < count; i++)); do
  entry=$(jq -c ".[$i]" <<<"$all")
  name=$(jq -r .name <<<"$entry")
  hit=$rebuild_all
  if ! $hit && $args_all && [[ -n $(jq -r '.args // ""' <<<"$entry") ]]; then hit=true; fi
  if ! $hit; then
    read -r -a pats <<<"$(jq -r '.paths // ""' <<<"$entry")"
    while IFS= read -r f && ! $hit; do
      for p in "${pats[@]}"; do
        # shellcheck disable=SC2053 # $p is a pattern on purpose
        [[ -n $f && $f == $p ]] && { hit=true; break; }
      done
    done <<<"$files"
  fi
  if $hit; then
    picked=$(jq -c --argjson e "$entry" '. + [$e]' <<<"$picked")
    echo "  build $name" >&2
  else
    echo "  skip  $name" >&2
  fi
done

echo "matrix={\"include\":$picked}"
if [[ $picked == '[]' ]]; then echo "any=false"; else echo "any=true"; fi
