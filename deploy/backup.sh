#!/usr/bin/env bash
# Резервная копия БД на сервере: pg_dump → gzip в $DEPLOY_DIR/backups, хранится KEEP_DAYS дней.
# Вручную или по cron (deploy/README.md, «Резервные копии»):
#
#   15 3 * * * bash /opt/dentbook/src/deploy/backup.sh >> /opt/dentbook/backups/backup.log 2>&1
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/dentbook}"
KEEP_DAYS="${KEEP_DAYS:-14}"
BACKUP_DIR="$DEPLOY_DIR/backups"

umask 077
mkdir -p "$BACKUP_DIR"
cd "$DEPLOY_DIR"

file="$BACKUP_DIR/dentbook-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
trap 'rm -f "$file.tmp"' EXIT

# -T без TTY; </dev/null — compose exec не читает stdin вызывающего скрипта
docker compose exec -T postgres pg_dump -U dentbook --no-owner dentbook </dev/null \
  | gzip -9 > "$file.tmp"
mv "$file.tmp" "$file"

find "$BACKUP_DIR" -name 'dentbook-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) $file $(du -h "$file" | cut -f1)"
