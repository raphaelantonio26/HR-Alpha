#!/usr/bin/env bash
# Apply the idempotent schema to the configured database. Safe to re-run.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/server/prisma/migrations/0001_init/migration.sql
echo "migration applied."
