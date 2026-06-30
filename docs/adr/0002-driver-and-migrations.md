# ADR 0002 — Runtime driver: node-postgres + an explicit SQL migration runner

- **Status:** Accepted
- **Date:** 2026-06
- **Context:** Stage 1 chose Prisma + Postgres. The build environment could not
  reach `binaries.prisma.sh`, so the Prisma query engine could not be fetched, and
  the proven data/security layer was built and tested on **node-postgres** instead.
  Hardening for Azure made the same choice the right long-term one: the production
  runtime image is a slim `node:22` + `tsx`, and migrations run from a **separate
  admin principal** in a Container Apps Job, not from the app.

## Decision

Keep **node-postgres (`pg`)** as the runtime driver, behind the unchanged
`withActor()` contract in `packages/server/src/db.ts`. Tenant isolation and audit
attribution are carried by three transaction-local GUCs (`app.tenant_id`,
`app.actor_id`, `app.role`) set with `set_config(..., true)` per transaction, which
RLS policies and the audit trigger read. The app connects as the **non-superuser,
`NOBYPASSRLS`** role `hros_app`.

Run schema changes through an **explicit SQL runner**, not an ORM migration engine:

- **Local / Option B:** `infra/migrate.sh` (psql) applies
  `packages/server/prisma/migrations/0001_init/migration.sql`, idempotently.
- **Azure:** `infra/migrate.ts` runs in a Container Apps Job as the Postgres admin
  (a member of `azure_pg_admin`). The slim runtime image has no `psql`, so it
  applies the **same** `migration.sql` through node-postgres (a multi-statement
  simple query; the schema has no bind parameters), after idempotently
  bootstrapping the `hros_app` role. Same file, no rewrite, no drift.

`schema.prisma` remains the **authoritative human-readable model** and is kept in
sync, but is not in the runtime or migration path.

## Alternatives considered

- **Reintroduce PrismaClient at runtime.** Rejected for now: it could not be
  fetched in the build environment, and it adds an engine binary to an otherwise
  slim image. The GUC-per-transaction + RLS pattern is also more direct with raw
  `pg`. Reversible — PrismaClient can be reintroduced behind `withActor()` later
  without touching call sites.
- **ORM-managed migrations (`prisma migrate`).** Rejected: the reviewed, tested
  artifact is `migration.sql`. Applying it verbatim on every target is what keeps
  local, CI, and Azure identical; an ORM regenerating SQL per environment is a
  drift risk for the security-critical RLS/audit objects.
- **A dedicated migration image with `psql`.** Rejected: a second image to build
  and scan for no benefit. `tsx` + `pg` already ship in the app image, so the
  migrate and reseed Jobs reuse it.

## Consequences

- One driver, one image, one migration file across local / CI / Azure.
- The migrate Job is the only thing that runs as admin; the app is always the
  least-privileged role, so `FORCE ROW LEVEL SECURITY` and the `audit_log` REVOKE
  actually bind.
- CI reproduces the gate on a real Postgres 16 (apply twice for idempotency, then
  pgTAP as `hros_app`, then seed) — see `.github/workflows/ci.yml`.
