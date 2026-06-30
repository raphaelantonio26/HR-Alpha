# Data Topology — what lives where, and the path to one store

HR OS is the **unification** of three systems that today have three separate
databases. This document records the current topology, the chosen consolidation
path (and why), and one environment-forced runtime decision.

---

## 1. Stores today (three, separate)

| System | Stack | Database | Notes |
|---|---|---|---|
| **LeaveIQ** | React/Vite + Supabase | its **own** Supabase Postgres | California statutory leave; roster imported via an ADP parser; case data lives here. |
| **ERIQ** | React/Vite + Supabase | its **own, separate** Supabase Postgres | ER investigations; evidence in a private `case-evidence` bucket with case-scoped RLS; separate migrations. |
| **HR OS** (this repo) | Prisma/Postgres monorepo | a **new** Postgres 16 with RLS + append-only audit | Intended to become the single system of record. |

So leave cases, ER cases, and the canonical people/comp data are in three places,
each with its own access model and audit story.

## 2. The unifying thesis

**The HR OS canonical `Worker` is the one employee file.** Leave cases, ER cases,
compensation history, and documents all attach to it by `workerId` within one
tenant-scoped, RLS-protected database. This build makes that real for the slices it
touches:

- `worker` is the canonical record (one row per employee, per tenant).
- `compensation_record.worker_id → worker.id` (pay history attaches to the file).
- `leave_case.worker_id → worker.id` (added this phase — the LeaveIQ case,
  consolidated; `designation = NULL` is await-designation, a first-class state).
- `pay_band.title_key` (governed bands per normalized title; lock-before-payroll).

Every one of these tables is `tenant_id`-scoped, RLS-FORCED, and audited by the same
append-only trigger — proven in `packages/server/test/pgtap/rls_audit.sql` (25/25).

## 3. Chosen path: consolidate into HR OS Postgres (not federate)

**Decision: consolidate.** LeaveIQ and ERIQ data migrate INTO the HR OS Postgres,
keyed to the canonical `worker`, rather than being federated/queried in place.

Why consolidate, not federate:
- **One access model.** RLS + the audit trigger live in one schema; federation
  would mean reconciling three RLS models and three audit trails (or trusting an
  app-tier join, which violates "isolation at the DB").
- **One employee file.** "Ask across the whole file" and cross-module views (a
  worker's leave + comp + ER posture) require co-located, same-tenant rows.
- **One audit answer.** Tamper-evident history of every mutation in one append-only
  log, not three.
- **Cost/operational simplicity** for a PE-backed consolidation: one database to
  back up, rotate, and reason about.

Federation was considered and rejected: it keeps three sources of truth and pushes
tenant-isolation correctness into application code.

### Migration shape (the senior pass — NOT done here)
This phase did **not** move LeaveIQ/ERIQ data (that is the senior pass). But every
model touched is already shaped so consolidation is a **data move, not a redesign**:
1. Map LeaveIQ workers → existing `worker` rows by `(tenant_id, file_number)`.
2. Load LeaveIQ cases → `leave_case` (designation/jurisdiction map straight across;
   blanks become await-designation, never a silent default).
3. Load ER cases → an `er_case` table (same `tenant_id` + `worker_id` shape; ER UI
   and engine are built/tested, persistence is the next pass) with evidence moved
   from the Supabase bucket to the documents store, preserving case-scoped access.
4. Every insert runs through `withActor` so RLS + audit apply to migrated rows too.
Blanks never erase; every change is audited with its source (`SYNC_SOURCES`).

## 4. Runtime driver decision (environment-forced, reversible)

`prisma/schema.prisma` is the **authoritative schema** and `infra/migrate.sh` applies
the hand-written, idempotent migration that matches it. At **runtime**, the server
uses **node-postgres (`pg`)** rather than the generated Prisma client, because the
Prisma query-engine binary host (`binaries.prisma.sh`) is blocked in the build
sandbox, so `prisma generate` and the PrismaClient runtime cannot run there.

What this changes: **nothing architectural.** The `withActor()` contract, the
GUC-per-transaction pattern, RLS, the append-only audit trigger, the pure engines,
and read-path masking are all identical and proven. `db.ts` is the only file that
differs, and it preserves the exact `Tx` surface (`$queryRawUnsafe`/
`$executeRawUnsafe`) so routes are untouched.

`TODO(fable5)`: when `binaries.prisma.sh` is reachable, run `prisma generate`; you
may keep this `pg` layer or restore the PrismaClient implementation of the same
contract. The SQL and the contract do not change either way.

---

*Brand: navy #004B87 · red #EF3340 · Arial · "Building on a Foundation of Trust."*
