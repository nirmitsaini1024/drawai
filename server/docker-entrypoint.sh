#!/bin/sh
# Wait for Postgres, apply migrations, then exec the server command.
set -eu

attempts=0
max_attempts="${MIGRATION_MAX_ATTEMPTS:-30}"

until alembic upgrade head; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    echo "[entrypoint] database not ready after ${max_attempts} attempts, giving up" >&2
    exit 1
  fi
  echo "[entrypoint] migration failed (is Postgres up?), retry ${attempts}/${max_attempts} in 2s..." >&2
  sleep 2
done

echo "[entrypoint] migrations applied"
exec "$@"
