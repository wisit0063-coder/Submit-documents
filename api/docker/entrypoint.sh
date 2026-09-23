#!/bin/sh
# Container entrypoint for the API.
#
# 1. apply pending migrations (retrying while the database finishes starting)
# 2. optionally load reference data
# 3. hand PID 1 to Node so stop signals reach the app
set -e

PRISMA=node_modules/.bin/prisma

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  attempt=1
  until "$PRISMA" migrate deploy; do
    if [ "$attempt" -ge "${MIGRATE_MAX_ATTEMPTS:-10}" ]; then
      echo "[entrypoint] migrations failed after $attempt attempts" >&2
      exit 1
    fi
    echo "[entrypoint] database not ready, retrying in 5s ($attempt)"
    attempt=$((attempt + 1))
    sleep 5
  done
fi

# The seed is idempotent: reference data is upserted and demo accounts are only
# created while the users table is empty.
if [ "${RUN_SEED:-false}" = "true" ]; then
  node dist/prisma/seed.js
fi

exec node app.js
