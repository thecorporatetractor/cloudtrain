#!/bin/sh
# Nightly dump of the website database (the waitlist), run from cron on the VM:
#   15 3 * * * /opt/cloudtrain-site/backup.sh >> /var/log/cloudtrain-site-backup.log 2>&1
# Keeps the last KEEP_DAYS dumps in BACKUP_DIR. The dumps hold personal data (waitlist
# emails): the directory is root-only, and copies off the VM follow the privacy notice.
set -eu
cd "$(dirname "$0")"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/cloudtrain-site}
KEEP_DAYS=${KEEP_DAYS:-14}
umask 077
mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/cloudtrain-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres pg_dump -U postgres -d cloudtrain --format=custom > "$out.tmp"
mv "$out.tmp" "$out"
find "$BACKUP_DIR" -name 'cloudtrain-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup: $out ($(wc -c < "$out") bytes)"
