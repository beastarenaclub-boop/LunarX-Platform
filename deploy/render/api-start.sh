#!/bin/sh
set -eu

: "${DATABASE_URL:?Set DATABASE_URL using the Render Postgres internal connection.}"
: "${SUPER_ADMIN_EMAIL:?Set SUPER_ADMIN_EMAIL in Render.}"
: "${SUPER_ADMIN_PASSWORD:?Set SUPER_ADMIN_PASSWORD in Render.}"
if [ "${#SUPER_ADMIN_PASSWORD}" -lt 16 ]; then
  echo "SUPER_ADMIN_PASSWORD must contain at least 16 characters." >&2
  exit 1
fi
if [ "${COOKIE_SECURE:-}" != "true" ]; then
  echo "The Render deployment requires COOKIE_SECURE=true." >&2
  exit 1
fi

# Run before the listener starts; do not launch against a partially migrated DB.
pnpm --filter @workspace/db migrate
exec node --enable-source-maps dist/index.mjs
