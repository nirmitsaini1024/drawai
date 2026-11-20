#!/usr/bin/env bash
# Dump the DrawAI database to ./backups/drawai-<timestamp>.sql.gz using pg_dump inside the postgres container.
# Usage: scripts/backup.sh            (stack must be running: docker compose up -d)
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
DB_USER="${POSTGRES_USER:-drawai}"
DB_NAME="${POSTGRES_DB:-drawai}"

mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="backups/drawai-${stamp}.sql.gz"
tmp="${out}.partial"

# --clean --if-exists makes the dump restorable over an existing database.
if docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner \
  | gzip -9 > "$tmp"; then
  mv "$tmp" "$out"
  chmod 600 "$out"
  echo "Backup written to $out ($(du -h "$out" | cut -f1))"
else
  rm -f "$tmp"
  echo "Backup failed" >&2
  exit 1
fi
