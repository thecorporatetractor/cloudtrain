#!/usr/bin/env bash
# Refuses to start the dev deps on a Postgres data volume from an older major.
#
# Postgres 18 cannot read a 17 data directory, and its image keeps data under
# /var/lib/postgresql/18/docker (the volume is mounted at /var/lib/postgresql)
# instead of /var/lib/postgresql/data. A pgdata volume created before the 18
# upgrade holds a 17 cluster at its root; the 18 entrypoint would only exit
# with an error, so this check says what to do instead.
#
# Usage: check-volume.sh [compose-file]   (honours COMPOSE_PROJECT_NAME)
set -euo pipefail

compose_file=${1:-deploy/dev/compose.yaml}
project=$(docker compose -f "$compose_file" config | sed -n 's/^name: //p' | head -1)
volume="${project}_pgdata"

docker volume inspect "$volume" >/dev/null 2>&1 || exit 0 # first start: fresh init

image=$(docker compose -f "$compose_file" config --images | grep -m1 '^postgres:')
want=$(sed -E 's/^postgres:([0-9]+).*/\1/' <<<"$image")

# PG_VERSION of every cluster in the volume: the 17 layout keeps it at the root
# (old mount /var/lib/postgresql/data), the 18+ layout under <major>/docker.
found=$(docker run --rm --network none -v "$volume:/v:ro" --entrypoint sh "$image" -c \
  'for f in /v/PG_VERSION /v/data/PG_VERSION /v/*/docker/PG_VERSION; do [ -s "$f" ] && cat "$f"; done; true' |
  sort -u | tr '\n' ' ')

for v in $found; do
  if [[ $v != "$want" ]]; then
    cat >&2 <<EOF

  The dev Postgres volume "$volume" holds a Postgres $v data directory,
  but deploy/dev/compose.yaml now runs Postgres $want, which cannot read it.

  Recreate the dev data (fictional seed data; realms are re-imported and the
  seed runs again on the next start):

      task dev:deps:reset && task dev:deps

  To keep data you added by hand, dump it with the old image first:
  docs/dev-environment.md, "Postgres major upgrades".

EOF
    exit 1
  fi
done
