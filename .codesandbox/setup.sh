#!/usr/bin/env bash
# CodeSandbox demo bring-up. Postgres 16 (Docker) -> non-superuser app role ->
# migration -> synthetic seed. Idempotent; safe to re-run. Mirrors RUN.md Option A,
# but applies the migration through the container's psql so the VM needs no psql.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

COMPOSE="docker compose -f infra/docker-compose.yml"

echo "[setup] starting Postgres 16..."
$COMPOSE up -d postgres

echo "[setup] waiting for Postgres to accept connections..."
for i in $(seq 1 60); do
  if $COMPOSE exec -T postgres pg_isready -U hros -d hros >/dev/null 2>&1; then
    echo "[setup] Postgres is ready."
    break
  fi
  [ "$i" -eq 60 ] && { echo "[setup] ERROR: Postgres never became ready"; exit 1; }
  sleep 2
done

# The app connects as a NON-superuser, NOBYPASSRLS role so FORCE RLS and the
# append-only audit REVOKE actually bind. Create it before migrating; ignore the
# error if it already exists.
echo "[setup] ensuring app role hros_app..."
$COMPOSE exec -T postgres psql -U hros -d hros \
  -c "CREATE ROLE hros_app LOGIN PASSWORD 'hros_app' NOSUPERUSER NOBYPASSRLS;" 2>/dev/null \
  || echo "[setup] hros_app already exists (ok)"

echo "[setup] applying migration (idempotent)..."
$COMPOSE exec -T postgres psql -U hros -d hros -v ON_ERROR_STOP=1 -f - \
  < packages/server/prisma/migrations/0001_init/migration.sql

echo "[setup] seeding synthetic demo tenant (Sample/.example; no PII)..."
DATABASE_URL="postgresql://hros_app:hros_app@localhost:5432/hros" npm run seed

echo "[setup] DONE - database ready with synthetic data. The API + Web tasks can start."
