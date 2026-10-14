#!/usr/bin/env bash
# Prints a GitHub Actions multiline output `list` of docker build args taken
# from deploy/versions.env. Argument: space-separated specs, each NAME (build
# arg and versions.env variable share the name) or ARG=VAR.
set -euo pipefail
set -a
# shellcheck source=deploy/versions.env
. deploy/versions.env
set +a
echo 'list<<BUILD_ARGS_EOF'
for spec in ${1:-}; do
  arg=${spec%%=*}; var=${spec#*=}
  [[ -n ${!var:-} ]] || { echo "build-args: $var is not set in deploy/versions.env" >&2; exit 1; }
  echo "$arg=${!var}"
done
echo 'BUILD_ARGS_EOF'
