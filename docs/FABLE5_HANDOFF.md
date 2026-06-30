# HR OS — Fable5 Engineering Handoff

> The single source of truth for the next engineering session. Read this before
> touching code. It states what is built, what is proven, what is deliberately
> stubbed, and the exact next prompt to extend each surface. Nothing here
> overstates the build: every "green" claim is backed by command output in §5.

---

## 1. Executive state

HR OS is a multi-tenant, HRIS-agnostic enterprise HR platform delivered as a
TypeScript monorepo. **Stage 1 (this build) is the foundation + the
correctness-critical engines, fully typed and unit-proven, plus the server, web,
connector, and infra skeletons around them.**

What that means concretely:

- The **decision engines** (leave eligibility/entitlement, comp banding +
  construction pay, ER risk/statutes/patterns, JD generation, org/span analysis,
  governed metrics + suppression) are **written, typed, and covered by 88 passing
  unit tests**. These are the parts where a wrong answer has legal or pay
  consequences, so they were built first and proven first.
- The **server** (Fastify API, the server-side AI gateway, Prisma schema, an
  idempotent RLS + append-only-audit migration, RBAC, JWT auth) is written and
  typechecks.
- The **web app** (Vite + React + Tailwind on Atrium tokens, full app shell, 13
  module surfaces, 4 of them wired to the real engines) **builds for production**.
- **connectors** (the driver contract, ADP Workforce Now dry-run driver, generic
  CSV driver with formula-injection hardening, the validate→diff→commit sync
  pipeline) is written and typechecks.
- **infra** (docker-compose for Postgres 16 / Redis / MinIO, migration script,
  synthetic seed, CI workflow) is written.

What is **not** done and is explicitly Stage 2+: the live database wiring for the
remaining surfaces (ER/Org/JD UIs over the built engines, Metrics Studio, Service
Desk, Documents, Audit viewer, Admin/Connectors), the live ADP OAuth+mTLS driver,
SSO/SCIM, and the infra-dependent test gates (pgTAP for RLS/audit, Playwright+axe
e2e). See §3, §6, §7, §9.

---

## 2. Architecture as-built (and deviations from the brief)

Monorepo (npm workspaces). Dependency direction is strict and one-way:

```
contracts  ─►  core  ─►  (server, web)
                 ▲
            connectors ─► server
```

| Package | Role | State |
|---|---|---|
| `@hr-os/contracts` | Canonical types + zod schemas + enums. The shared vocabulary. | typecheck PASS |
| `@hr-os/core` | Pure, deterministic decision engines. No I/O, no framework. | typecheck PASS · **88/88 tests** |
| `@hr-os/connectors` | HRIS driver contract, ADP WFN (dry-run) + CSV drivers, sync pipeline. | typecheck PASS |
| `@hr-os/server` | Fastify API, AI gateway, Prisma + RLS + audit, RBAC, auth. | typecheck PASS |
| `@hr-os/web` | Vite/React/Tailwind SPA: shell + 13 surfaces. | **build PASS** |

**Key design decisions**

- **Engines are pure.** `core` has zero dependencies on the server, the DB, or
  React. The same function that the API calls is the one the web app calls and
  the one the tests call. This is why the engines could be proven before any
  infrastructure exists.
- **Tenant isolation is at the database**, via Postgres row-level security keyed
  on a request GUC (`app.tenant_id`) that `withActor()` sets `LOCAL` to each
  transaction. Application code cannot see another tenant's rows even if a query
  forgets a `WHERE` clause.
- **Audit is at the database**, via an `AFTER INSERT/UPDATE/DELETE` trigger that
  stamps the actor/tenant GUCs into an `audit_log` whose `UPDATE`/`DELETE` are
  revoked — append-only and tamper-evident, not dependent on app discipline.
- **The model is reached only through the server gateway.** The browser never
  holds a key and never calls Anthropic. The gateway centralizes the model id and
  token budget, screens for PII, rate-limits, scopes web_search by purpose,
  streams over SSE, and aborts upstream on client disconnect.

**Deviations from the brief (all deliberate, all reversible):**

1. **No `recharts`, `framer-motion`, or `lucide-react` in `web`.** To keep the
   Stage-1 build fast and dependency-light, the one chart is a hand-rolled SVG
   sparkline, motion uses CSS transitions, and icons are inline SVG/glyphs. These
   libraries are **additive** — adding them later changes no architecture. (Add
   with `npm i -w @hr-os/web recharts framer-motion lucide-react`.)
2. **Prisma data access in the skeleton routes uses `withActor` + raw SQL** rather
   than generated model methods, so the server typechecks before `prisma generate`
   runs. Once `prisma generate` is wired (it needs a reachable DB URL at build),
   routes can move to typed model calls; the `withActor` GUC pattern stays.
3. **The AI gateway's rate limiter is in-memory.** Production must back it with
   Redis (the dependency and URL are already configured). See §6.

---

## 3. Module status matrix

13 surfaces. "Wired" = backed by a real engine in `core`. "Scaffold" = designed
empty-state with the engine **already built and tested**, needing only UI. "Planned"
= surface designed, build scheduled.

| Surface | UI | Engine | Acceptance criteria for "done" |
|---|---|---|---|
| Command Center | Wired (sample) | n/a | Real cross-module counts from DB; attention queue from live cases. |
| People | Wired (sample) | n/a | Live roster via `/people` (RLS-scoped); role-masked pay verified by pgTAP. |
| Leave | **Wired to engine** | `core/leave` | Case CRUD persisted; eligibility/clocks from engine; await-designation zero-state honored. |
| Compensation | **Wired to engine** | `core/comp` | Bands persisted + lock workflow; placement from engine; P25 anchor; no fabricated market data. |
| Employee Relations | Scaffold | `core/er` **(tested)** | Case intake; deterministic risk + statute leads surfaced; privilege gating; cross-case patterns. |
| Org & Headcount | Scaffold | `core/org` **(tested)** | Tidy-tree from `manager_id`; span flags; HRBP coverage planner. |
| Job Descriptions | Scaffold | `core/jd` **(tested)** | Trade-aware JD draft; required/preferred split; EEO footer; no pay statements. |
| Metrics Studio | Scaffold | `core/metrics` **(tested)** | Governed measure/dimension picker; small-cell suppression; AI builder sees no raw PII. |
| HR Service Desk | Planned | — | Ticketing, KB, SLA; AI-drafted replies a human approves. |
| Tasks & Approvals | Planned | — | Unified approval/designation queue across modules. |
| Documents | Planned | — | Branded EN / Mexican-Spanish letters from canonical data. |
| Audit Trail | Planned | (DB ready) | Read-only viewer over `audit_log`, filter by actor/entity/date. |
| Settings & Connectors | Planned | (driver ready) | Tenant config, RBAC editor, rule-pack versions, ADP setup. |

---

## 4. Inviolable invariants (enforced, not aspirational)

These are the §2 invariants of the brief, mapped to where each is enforced:

1. **AI assists; humans decide.** Engines are deterministic; the gateway's system
   prompts forbid conclusions; ER explicitly returns leads, never dispositions.
2. **Never fabricate** pay, benefits, legal conclusions, or citations. Comp refuses
   absent inputs; JD emits no pay strings (unit-tested); policy/ER cite leads to verify.
3. **No PII to models or logs.** `gateway.findPii()` rejects PII-shaped keys/values;
   only whitelisted structured facts are forwarded; synthetic data is `Sample`/`.example`.
4. **Every mutation audited, append-only at the DB.** Trigger + revoked UPDATE/DELETE.
5. **Model + tokens centralized:** `MODEL_ID = "claude-sonnet-4-6"`, `MAX_TOKENS = 4096`,
   defined once in `config.ts`, never inlined or lowered.
6. **Tenant isolation at the DB** via RLS GUC + FORCE ROW LEVEL SECURITY.
7. **Graceful degradation:** no key / upstream failure → labeled deterministic
   fallback over SSE (`event: fallback`), UI shows the result is local.
8. **Conservative compliance:** ER recommendations escalate to investigation under
   uncertainty and never jump to discipline (unit-tested); leave rule-pack falls
   back to federal when a jurisdiction pack is absent.
9. **Brand + WCAG 2.2 AA:** fixed navy/red tokens, Arial, visible focus, reduced-motion.
10. **Additive idempotent migrations:** `IF NOT EXISTS` + guarded `DO` blocks; safe to re-run.
11. **Metrics safe by construction:** constrained DSL (measure/lit/op only),
    small-cell suppression with a raised threshold for sensitive dimensions (unit-tested).

---

## 5. Verified-build evidence (actual output)

Captured from this build. Reproduce with the commands shown.

```
## typecheck (all workspaces)  —  npm run typecheck
RESULT: PASS (exit 0, all 5 workspaces: contracts, core, connectors, server, web)

## core engine unit tests  —  (cd packages/core && npx vitest run)
 ✓ src/comp/comp.test.ts     (26 tests)
 ✓ src/leave/leave.test.ts   (16 tests)
 ✓ src/er/er.test.ts         (14 tests)
 ✓ src/jd/jd.test.ts         (19 tests)
 ✓ src/metrics/metrics.test.ts (6 tests)
 ✓ src/org/org.test.ts        (7 tests)
 Test Files  6 passed (6)
      Tests  88 passed (88)

## web production build  —  npm run build -w @hr-os/web  (tsc -b && vite build)
 ✓ 73 modules transformed.
 dist/index.html                 0.73 kB │ gzip:  0.43 kB
 dist/assets/index-*.css        11.54 kB │ gzip:  3.20 kB
 dist/assets/index-*.js        168.01 kB │ gzip: 54.48 kB
 ✓ built in ~2.5s
```

**What could NOT be verified in this environment, and why:** the build container
has no Postgres/Redis/S3, so the migration, RLS, audit trigger, and end-to-end
flows were authored but not executed here. The exact commands to verify them on
infra are in §9. No green status is claimed for anything not shown above.

---

## 6. Known issues / TODO(fable5)

Every stub is typed and marked in-source with `TODO(fable5):`. The load-bearing ones:

- **ADP Workforce Now driver is dry-run.** `fetchRoster/fetchCompensation` return
  empty; the field map is complete and correct. Implement OAuth client-credentials
  + mTLS, the Workers/Work-Assignments endpoints, and cursor incremental sync.
  (`packages/connectors/src/drivers/adpWorkforceNow.ts`)
- **AI gateway rate limiter is in-memory.** Replace `userBuckets/tenantBuckets`
  with a Redis token bucket; move long generations to a BullMQ worker.
  (`packages/server/src/ai/gateway.ts`)
- **Prisma client not generated in this env** (needs DB URL). Run `prisma generate`,
  then optionally migrate skeleton routes to typed model calls.
- **`Dockerfile.server` is a placeholder** single-stage build. Make it multi-stage
  (prisma generate + tsc), distroless, non-root.
- **SSO/SCIM not implemented.** Auth verifies a JWT shape; wire the IdP + SCIM
  provisioning. (`packages/server/src/auth/embedded.ts`)
- **Rule packs:** only `US-CA` and `US-FED` are populated. NY/WA/CO are typed
  placeholders. (`packages/core/src/leave/california.ts`)
- **Construction comp source fusion** (BLS OEWS + DIR prevailing wage + CBA) is a
  typed seam in `core/comp/construction.ts`; wire the data sources.

### 6b. Senior-pass backlog — record, do NOT build in routine extension
Two named features are deferred to the senior pass. Captured here so they are not lost:

- **Disciplinary / Corrective Action generator** (not yet built anywhere). Absorb
  AMPAM's attendance progressive-discipline ladder (3 occ → verbal, 4 → written, 5 →
  3-day suspension, 6 → termination) and the Safety Corrective Action Notice pattern
  (§3203 IIPP, Cal/OSHA citation classes, legal-review triggers, bilingual
  EN/Mexican-Spanish, signature blocks). Must be guideline-bound and conservative (HR
  decides; AI drafts only), and attach to the canonical `worker` record (audited).
- **Employee-file AI retrieval layer** — the governed, redacted, audited seam. The
  contract is already designed this phase as `WorkerFactView` in
  `packages/contracts/src/canonical.ts`: a server-side layer (behind `withActor`)
  assembles a minimized, non-PII fact set, audits every access, and forwards only that
  to the gateway. A full employee file is NEVER sent to a model. `findPii()` remains
  the backstop. Build the assembly + audit; do not loosen the contract.

### 6c. Stage 3 update — resolved this phase, and what it changes

Several §6 TODOs are now done (production-hardening + Profile D + UI elevation):

- **SSO/SCIM — done.** OIDC verification (`auth/oidc.ts`, jose; issuer+audience,
  claim->actor/tenant/role) and SCIM 2.0 Users (`routes/scim.ts`, persists
  `app_user`) are implemented and unit-tested (24/24). `auth/embedded.ts` now routes
  to OIDC or HS256 by `AUTH_MODE`.
- **AI rate limiter — now Redis-backed.** `ratelimit.ts` + `redis.ts`; the gateway
  limits per user/tenant/IP, Redis when `REDIS_URL` is set, in-memory otherwise.
  (BullMQ for long generations is still open.)
- **`Dockerfile.server` — now multi-stage, non-root**, with a compile gate, pruned
  dev deps, `HEALTHCHECK`, and `tsx` runtime. (Not built/scanned in the sandbox — no
  daemon; the CI `deploy-azure.yml` builds + Trivy-scans it via `az acr build`.)
- **Demo profile — added (ADR 0003).** One image, env-selected; tenant-pinned
  `/demo/session`, labeled-fallback AI, scale-to-zero, scheduled reseed, fail-closed
  boot guard. SPA front door (`DemoGate`) under `VITE_DEMO_MODE`.
- **Azure deploy — added.** `infra/azure/main.bicep` (both profiles), profile P/D
  params, `infra/migrate.ts` (admin role bootstrap + schema via `pg`; ADR 0002),
  `deploy-azure.yml` (keyless OIDC, ACR build, Trivy, SBOM), `docs/DEPLOY-AZURE.md`.
- **UI — elevated within the fixed brand.** Documented token system
  (`docs/DESIGN-SYSTEM.md`), refined components/states, lucide icons, motion.

Still open after this phase: the live ADP driver and rule-pack expansion (§6);
**VNet + Private Endpoints** for the Azure data plane (`TODO(prod-hardening)` markers
in `main.bicep`); browser Playwright + axe e2e; the §6b senior-pass features
(Disciplinary generator; employee-file AI retrieval over the `WorkerFactView` seam);
and the remaining surface UIs in §7 Phases B and C.

---

## 7. Extension backlog — ready-to-paste next prompts

Each is a self-contained next session. Run in order; each ends green before the next.

**Phase A — stand up the database path. ✅ DONE (Stage 2; see STATUS.md + RUN.md).**
Infra up (native Postgres 16 in the sandbox), migration applied + idempotent,
pgTAP `rls_audit.sql` proves RLS isolation, audit attribution, and append-only
(25/25), synthetic tenant seeded via `withActor`. Phases B (slices live), C
(hardening), and D (docs) are also complete this build.
> "In HR OS, bring up the infra stack (`docker compose -f infra/docker-compose.yml up -d postgres redis minio`), run `infra/migrate.sh`, then `prisma generate`. Write pgTAP tests proving: (a) RLS blocks cross-tenant SELECT/INSERT, (b) the audit trigger fires on every mutation with correct actor/tenant, (c) `audit_log` rejects UPDATE/DELETE. Seed the synthetic tenant. Show all tests green."

**Phase B — wire ER, Org, and JD UIs to their built engines.**
> "In HR OS, build the Employee Relations, Org & Headcount, and Job Descriptions surfaces against the existing, tested `core/er`, `core/org`, and `core/jd` engines. Persist cases/positions via `withActor`. Keep ER privilege-gated and conclusion-free. EEO footer on JD export. No new engine logic — UI + persistence only. Typecheck + build green."

**Phase C — Metrics Studio.**
> "In HR OS, build the Metrics Studio over `core/metrics`: a governed measure/dimension picker, the constrained-DSL builder, small-cell suppression on every cell, and an AI metric-builder that receives only catalog item names (never raw rows). Add unit tests for suppression on the new aggregations. Green."

**Phase D — live ADP + sync.**
> "In HR OS, implement the live ADP Workforce Now driver (OAuth client-credentials + mTLS) behind the existing `Connector` interface and `FIELD_MAP`, feeding the validate→diff→commit pipeline. Blanks never erase; every change audited with source. Add a CSV round-trip test (formula-injection neutralized). Green."

**Phase E — Playwright + axe e2e and SSO/SCIM.** *(SSO/SCIM ✅ done in Stage 3 — see §6c; browser Playwright + axe e2e still open.)*
> "In HR OS, add Playwright e2e for the People/Leave/Comp flows and axe accessibility assertions (WCAG 2.2 AA) on every surface. Wire SSO (OIDC) issuing the JWTs the API verifies, plus SCIM user provisioning. Green, with the e2e job added to CI."

---

## 8. Data, secrets, and the no-PII boundary

- **No secrets in source.** `packages/server/.env.example` documents every variable
  with placeholder values. `ANTHROPIC_API_KEY` is server-only; its absence triggers
  the labeled fallback rather than an error.
- **No real people anywhere.** All seed/demo data is `Sample` / `.example`. The web
  app ships only synthetic rows.
- **The PII boundary is the gateway.** `findPii()` rejects keys matching
  `ssn|social|dob|birth|name|email|phone|address|medical|diagnosis|narrative` and
  values matching SSN/email patterns. Modules forward only minimal structured facts
  (e.g. `{ tenureMonths, hoursLast12mo }`), never identities or narrative.
- **Logs:** the gateway never logs request facts; audit detail is structured and
  PII-free by construction at the engine boundary.

---

## 9. Test gaps + the full gate set

**Proven now (see §5):** typecheck (5/5 workspaces), 88 core unit tests, web build.

**Pending — require live infrastructure. Exact commands:**

```bash
# 1. Infra up
docker compose -f infra/docker-compose.yml up -d postgres redis minio

# 2. Schema (idempotent)
DATABASE_URL=postgresql://hros:hros@localhost:5432/hros ./infra/migrate.sh

# 3. RLS + audit (pgTAP) — Stage 2, tests to be authored in Phase A
#    proves cross-tenant isolation, trigger coverage, append-only audit
psql "$DATABASE_URL" -f packages/server/test/pgtap/rls_audit.sql   # (Phase A)

# 4. End-to-end + accessibility (Playwright + axe) — Stage 2, Phase E
npm run e2e -w @hr-os/web                                          # (Phase E)
```

**Coverage focus already in place (core):** leave eligibility boundaries and
rolling-window math; comp NaN/negative/divide-by-zero hardening and band
placement; ER determinism, score clamping, the 90-day retaliation window, and the
conservative-recommendation rule; JD trade routing + no-pay-leak; metrics
suppression including the raised sensitive-dimension threshold; org cycle-guard.

---

## 10. Adversarial brief — how to try to break it

When extending, attack these first; the build was designed expecting them:

- **Cross-tenant leak:** issue a query in tenant A's `withActor` context and assert
  zero rows from tenant B. Try to bypass by omitting `WHERE tenant_id` — RLS must
  still block it. (pgTAP, Phase A.)
- **Audit tamper:** attempt `UPDATE`/`DELETE` on `audit_log` as the app role — must
  fail. Confirm a mutation with no GUC set still records (or is rejected) sanely.
- **PII exfiltration via the gateway:** craft `facts` with a key named innocuously
  but a value that is an email/SSN; the value-pattern check must catch it. Try
  `enableWebSearch: true` on `er_enrich` — must be ignored (purpose not whitelisted).
- **Fabrication pressure:** ask comp for a market figure with no source provided —
  it must decline rather than invent. Ask JD for a salary — output must contain no
  pay string (already unit-tested; keep it true as templates grow).
- **Disconnect during generation:** drop the SSE client mid-stream; the upstream
  `AbortController` must fire (no orphaned generation).
- **Re-run a sync:** identical source twice must yield zero changes; a blank
  incoming field must never erase an existing value.
- **Migration re-run:** apply `0001_init` twice — must not error or drop data.
- **Metrics re-identification:** request a metric sliced so a cell has n<5 (or n<10
  on a sensitive dimension) — it must suppress.

---

*Brand: navy #004B87 · red #EF3340 · Arial · "Building on a Foundation of Trust."*
