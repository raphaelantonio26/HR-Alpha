# CHANGES

## 0.3.0 — Stage 3: Azure production-hardening + Profile D demo + UI elevation

Hardened the proven spine to production-grade on Microsoft Azure, added a
fail-closed no-SSO demo profile, and elevated the SPA within the fixed AMPAM brand.
No re-architecture: every change extends behind the existing contracts. All Stage-2
gates were re-run green first (no drift), then new work was added with its own gates.

**Server hardening (Phases 1, 3, 4).**
- Config grew an auth mode (`hs256` | `oidc`), Entra OIDC settings, SCIM settings, a
  demo block, prod-data-plane and CORS controls, Redis, edge rate-limit, App Insights,
  and a **fail-closed `assertProfileSafety()`** (refuses contradictory env at boot).
- New `auth/oidc.ts` (jose; verifies issuer+audience, maps oid/sub -> actor, tenant
  and role from claims, with an injectable key resolver for tests). `actorFromRequest`
  is now async and routes to OIDC or HS256.
- New `observability.ts` (pino with secret redaction; optional App Insights),
  `redis.ts` (lazy, null without a URL), `ratelimit.ts` (pure token-bucket + a
  Redis/in-memory limiter). The AI gateway now rate-limits per user/tenant/IP.
- New `routes/demo.ts` (self-guarded; tenant-pinned session minter) and
  `routes/scim.ts` (SCIM 2.0 Users, constant-time bearer, persists `app_user`).
  Health gained a drain flag (`/readyz` -> 503 while draining); `index.ts` adds
  helmet, CORS, a rate-limit store, graceful SIGTERM shutdown (25s, within Azure's
  30s grace), and telemetry. Migration appended an additive, RLS-forced, audited
  `app_user` table.
- New server unit tests: **24/24** (OIDC 9, demo 12, rate limit 3).

**Azure IaC + CI/CD (Phase 2).**
- `infra/azure/main.bicep` — one parameterized template provisions **both profiles**
  (34 resources): user-assigned identity, Log Analytics + App Insights, ACR (pull via
  identity), Key Vault (RBAC; secret refs), PostgreSQL Flexible Server 16 with
  `pgcrypto` allowlisted via `azure.extensions`, Azure Cache for Redis (TLS), Storage
  (private blob container — the document-store seam), Container Apps env + API app
  (liveness/readiness/startup probes on `/healthz` `/readyz`), a manual **migrate Job**
  and a Profile-D scheduled **reseed Job**, Static Web App, and Front Door + WAF.
  Profile P/D parameter files; secrets via a bootstrap Key Vault reference.
- `infra/migrate.ts` — Azure DB Job runner: bootstraps the non-superuser `hros_app`
  role, then applies the proven `migration.sql` through node-postgres (the slim image
  has no psql). See ADR 0002.
- CI extended to run the server suite + a real-Postgres pgTAP/migrate/seed job.
  New keyless `deploy-azure.yml`: GitHub -> Azure **OIDC** (no secret), `az acr build`
  (server-side), Trivy scan, Syft SBOM, migrate Job, Container App roll, SWA deploy.
- `docs/DEPLOY-AZURE.md` runbook; ADRs 0002 (driver) and 0003 (two-profile model).
- Verified Azure facts via search before writing (extensions allowlist; Container
  Apps SIGTERM 30s + probes; OIDC federation). Not deployed (no Azure creds, by
  design); `az bicep build` is the operator's pre-apply step (CLI unavailable in the
  build sandbox — stated honestly, not faked).

**UI elevation (Phase 5).**
- Documented the Atrium token system (`docs/DESIGN-SYSTEM.md`): type ramp, 8px
  rhythm, theme-aware elevation (`--shadow-1/2/3`), a single brand motion curve with
  a 150–250ms band, and the accessibility floor — all within the fixed navy/red/Arial.
- Reworked `ui.tsx` (lucide icons; refined Card/Stat; a Button primitive; Skeleton +
  SkeletonTable loaders; icon-led empty/error/403 states). Sidebar gained per-module
  glyphs and an active navy rail; the topbar is sticky/translucent; the command
  palette is a labeled dialog. Data surfaces show skeleton loaders while fetching.
- Added the **Profile-D demo front door** (`DemoGate`): synthetic-data notice up
  front, a five-role picker, mints a session via `/demo/session`, and a persistent
  "every record is synthetic" strip. Gated by `VITE_DEMO_MODE`; absent outside demo.
- Added `lucide-react` (tree-shaken). Deferred a chart library: the bespoke SVG
  sparkline/gauge read more intentionally and keep the bundle lean.

**Gates (this phase, all green, output pasted in STATUS.md).**
- typecheck 5/5; core 88/88; **server 24/24**; web build clean (57 kB gzip main,
  modules still code-split); **web axe 6/6**; migration idempotent (applied twice);
  **pgTAP 25/25** as `hros_app` (incl. `app_user`); synthetic seed canonical; demo
  reseed self-heal proven. Bicep delimiters balanced (34 resources / 25 params /
  12 outputs); both deploy workflows YAML-valid; parameter JSON valid.


## 0.2.0 — Stage 2, Phases A–D: foundation proven + three slices live + hardened

**Phase A — proved the data/security layer against a real Postgres 16.**
- Stood up Postgres natively (sandbox has no Docker) with roles `hros` (superuser
  migration runner) and `hros_app` (NON-superuser app principal, so `FORCE ROW LEVEL
  SECURITY` and the `audit_log` REVOKE actually bind).
- `infra/migrate.sh` applies clean and is idempotent on a second run.
- New pgTAP suite `packages/server/test/pgtap/rls_audit.sql` — **25/25** as `hros_app`:
  cross-tenant SELECT+INSERT blocked both ways; audit trigger attribution on
  INSERT/UPDATE/DELETE; DELETE captures OLD; deny-by-default with no tenant GUC;
  `audit_log` rejects UPDATE/DELETE/TRUNCATE.

**Phase B — three vertical slices persist + read through the API.**
- Added two canonical tables (additive, idempotent, RLS-FORCED, audited):
  `leave_case` (attaches to `worker` by `worker_id`; `designation = NULL` =
  await-designation) and `pay_band` (governed band per `title_key`, lock-before-payroll).
  Mirrored in `schema.prisma`; both added to the audit-trigger + RLS loops and the
  consolidated `hros_app` grant block.
- **People** `/people`: live RLS-scoped roster with **read-path pay masking** — for a
  masked role the query never selects the rate, so pay is absent from the payload
  (not hidden in the UI). Audited create with tenant taken from the verified actor.
- **Comp** `/comp/records` + `/comp/bands` + `/comp/bands/lock`: persisted records and
  bands (comp.read/write gated); lock workflow audited; placement from the pure engine.
- **Leave** `/leave/cases` + `/leave/eligibility`: persisted cases (await-designation
  honored) plus the pure-engine eligibility calculator.
- Dev-only `/auth/dev-token` mints a real signed JWT per role (genuine verified-JWT
  path, not a bypass; mounted only when `NODE_ENV != production`). `TODO(fable5)` → SSO.
- `infra/seed.ts` seeds a synthetic demo tenant (Sample/.example) via `withActor` so
  RLS + audit apply to every row; idempotent.
- **Runtime driver:** `db.ts` now uses node-postgres behind the unchanged
  `withActor`/`Tx` contract (Prisma engine host blocked in sandbox). `schema.prisma`
  remains authoritative; migration unchanged. See `docs/DATA-TOPOLOGY.md`.

**Phase C — Toyota baseline hardening.**
- `api.ts` client (per-role dev-JWT cache, typed fetchers, SSE reader); `useApiData`
  hook; `Async`/`Spinner`/`ErrorState` primitives; app-level `ErrorBoundary` wrapping
  every module surface.
- People/Comp/Leave/Command Center rewritten to live data with explicit
  loading/empty/error states; forbidden (403) renders a calm role-scoped state.
- Web bundle **code-split**: each wired surface + the API client lazy-load as their
  own chunks.
- Command Center AI assist streams from the gateway and **visibly labels the local
  fallback** ("Running locally — AI unavailable") when no key is present.
- axe-core a11y test (`npm run test -w @hr-os/web`): zero serious/critical on the
  built surfaces and the empty/error states.

**Phase D — captured truth.**
- `RUN.md` (exact run steps, Docker + native), `docs/DATA-TOPOLOGY.md` (three stores
  today, consolidation path, driver note), `STATUS.md`/`CHANGES.md` updated with
  pasted gate evidence, and the `WorkerFactView` design-only seam for the future
  employee-file AI retrieval layer (`packages/contracts/src/canonical.ts`).

## 0.1.0 — Stage 1 foundation
- Monorepo scaffold (npm workspaces): contracts, core, connectors, server, web.
- **contracts:** canonical types, zod schemas, enums. Typecheck green.
- **core:** leave, comp (+construction), er (+statutes/patterns), jd, org, metrics
  engines. Pure & deterministic. **88 unit tests, all passing.**
- **connectors:** Connector interface, ADP WFN dry-run driver, generic CSV driver
  with formula-injection hardening, validate→diff→commit sync pipeline. Typecheck green.
- **server:** Fastify API; centralized model/token config; server-side AI gateway
  (SSE streaming, client-disconnect abort, per-user/tenant rate limit, PII screen,
  purpose-scoped web_search, labeled fallback); RBAC + field masking; JWT auth;
  Prisma schema; idempotent init migration with RLS + append-only audit trigger.
  Typecheck green.
- **web:** Vite + React + Tailwind on Atrium channel-triple tokens; app shell
  (sidebar, topbar, ⌘K command palette, light/dark); 13 surfaces with People,
  Leave, Comp, and Command Center wired to the real engines; designed empty-states
  for the rest. **Production build green.**
- **infra:** docker-compose (Postgres 16 / Redis / MinIO), migration script,
  synthetic seed, GitHub Actions CI (typecheck + core tests + web build).
- **docs:** README, CLAUDE invariants, STATUS, ARCHITECTURE, the Fable5 handoff,
  and topic guides (connectors, rule packs, metrics, security, deploy, operations) + ADR-0001.
