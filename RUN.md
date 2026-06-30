# RUN.md — bring HR OS up locally and prove it

Two paths. **Option A (Docker)** is the intended one-command path the repo's
`infra/docker-compose.yml` targets. **Option B (native Postgres)** is what was used
to PROVE this build in a sandbox without Docker — every gate in `STATUS.md` §Phase
A–C was produced via Option B. Both end at the same place: real rows from Postgres
through the API, role-masked, every mutation audited.

Prereqs: Node >= 20. Postgres 16 (container or native). No model key is required —
AI degrades to a labeled local fallback without one.

---

## 0. Install
```bash
npm install            # workspaces: contracts, core, connectors, server, web
```

## 1. Database up

### Option A — Docker
```bash
docker compose -f infra/docker-compose.yml up -d postgres
# Create the NON-superuser app role BEFORE migrating, so FORCE RLS + the audit_log
# REVOKE bind to it (a superuser/owner bypasses RLS; the app must not).
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U hros -d hros -c "CREATE ROLE hros_app LOGIN PASSWORD 'hros_app' NOSUPERUSER NOBYPASSRLS;"
```

### Option B — native Postgres 16 (what was used here)
```bash
sudo apt-get install -y postgresql-16 postgresql-client-16 postgresql-16-pgtap pgtap
sudo -u postgres initdb -D "$PGDATA" --auth=trust      # if not already initialized
sudo -u postgres pg_ctl -D "$PGDATA" -o "-p 5432" -l pg.log start
psql -h 127.0.0.1 -U postgres -d postgres <<'SQL'
CREATE ROLE hros     LOGIN PASSWORD 'hros'     SUPERUSER;            -- migration runner
CREATE ROLE hros_app LOGIN PASSWORD 'hros_app' NOSUPERUSER NOBYPASSRLS; -- the app
CREATE DATABASE hros OWNER hros;
SQL
psql -h 127.0.0.1 -U hros -d hros -c "CREATE EXTENSION IF NOT EXISTS pgtap;"  # for step 3
```

## 2. Migrate (idempotent — safe to re-run)
```bash
DATABASE_URL="postgresql://hros:hros@127.0.0.1:5432/hros" ./infra/migrate.sh
DATABASE_URL="postgresql://hros:hros@127.0.0.1:5432/hros" ./infra/migrate.sh   # prove idempotency
```
The migration creates the schema, the append-only audit trigger, RLS (FORCE) on
every business table, and — guarded by `IF EXISTS hros_app` — grants the app role
DML on business tables and INSERT/SELECT only on `audit_log`.

## 3. Prove the safety systems (RLS + append-only audit), as the app role
```bash
PGPASSWORD=hros_app pg_prove -d hros -h 127.0.0.1 -p 5432 -U hros_app \
  packages/server/test/pgtap/rls_audit.sql        # expect: 25/25 PASS
```

## 4. Seed the synthetic demo tenant (via withActor → RLS + audit apply)
```bash
DATABASE_URL="postgresql://hros_app:hros_app@127.0.0.1:5432/hros" npm run seed
# -> worksites=5 positions=6 workers=12 comp=12 leave_cases=3 pay_bands=3 (idempotent)
```

## 5. Run the API (connect as the NON-superuser app role so RLS binds)
```bash
DATABASE_URL="postgresql://hros_app:hros_app@127.0.0.1:5432/hros" \
JWT_SECRET="dev-only-secret" NODE_ENV="development" \
npm run dev -w @hr-os/server          # http://localhost:8080  (/healthz, /readyz)
```

## 6. Run the web app
```bash
npm run dev -w @hr-os/web              # http://localhost:5173
# Optional: VITE_API_URL=http://localhost:8080 (this is the default)
```

## 7. Click through (the manual check for DOD #1)
Open `http://localhost:5173`. Use the **role switcher** (top bar) — it mints a real
signed JWT per role from `/auth/dev-token` (dev only), so masking/RBAC are exercised
end to end, not faked:
- **People** — live roster from Postgres. As `comp_analyst` a Rate column appears;
  as `people_manager` it does not (pay is omitted at the read path, not hidden).
- **Leave** — live cases incl. an **await-designation** case; the eligibility
  calculator calls the pure engine.
- **Compensation** — as a comp role: persisted records + a governed band with a
  lock state, placement from the engine. As `people_manager`: a clear
  "not available for your role" state (comp.read is denied).
- **Command Center → "Summarize with AI"** — with no `ANTHROPIC_API_KEY`, shows a
  labeled **"Running locally — AI unavailable"** result (graceful degradation).

## Gates (CI mirrors these)
```bash
npm run typecheck            # all 5 workspaces
npm run test:core            # 88 engine unit tests
npm run build -w @hr-os/web  # production build (code-split)
npm run test -w @hr-os/web   # axe a11y (zero serious/critical)
# + the pgTAP run in step 3
```

> Driver note: this build runs the data layer on `node-postgres` because the Prisma
> engine binary host is blocked in the sandbox; `prisma/schema.prisma` remains the
> authoritative schema and the migration is unchanged. See `docs/DATA-TOPOLOGY.md`.
