#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh. This REPLACES the current database contents.
# Usage: scripts/restore.sh backups/drawai-20261120T120000Z.sql.gz [--yes]
set -euo pipefail

cd "$(dirname "$0")/.."

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Usage: $0 <backup.sql.gz> [--yes]" >&2
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
DB_USER="${POSTGRES_USER:-drawai}"
DB_NAME="${POSTGRES_DB:-drawai}"

if [ "${2:-}" != "--yes" ]; then
  read -r -p "This overwrites database '${DB_NAME}' with ${file}. Continue? [y/N] " answer
  case "$answer" in
    y | Y | yes | YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo "Stopping app services (postgres stays up)..."
docker compose stop web sync api

echo "Restoring ${file}..."
gunzip -c "$file" | docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 --single-transaction -q

echo "Starting services..."
docker compose up -d
echo "Restore complete."
