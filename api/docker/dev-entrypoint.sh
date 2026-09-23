#!/bin/sh
# Development entrypoint: source is bind-mounted, dependencies live in the image.
set -e

PRISMA=node_modules/.bin/prisma

"$PRISMA" generate

attempt=1
until "$PRISMA" migrate deploy; do
  if [ "$attempt" -ge 10 ]; then
    echo "[dev] migrations failed after $attempt attempts" >&2
    exit 1
  fi
  echo "[dev] database not ready, retrying in 5s ($attempt)"
  attempt=$((attempt + 1))
  sleep 5
done

if [ "${RUN_SEED:-false}" = "true" ]; then
  npm run seed
fi

# nodemon polls instead of relying on file events, which Docker Desktop does not
# forward from Windows bind mounts.
exec npm run dev:docker
