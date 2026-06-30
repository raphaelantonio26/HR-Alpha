# STATUS

Authoritative, build-by-build truth. Detailed matrix in `docs/FABLE5_HANDOFF.md`.

## Verified green — Stage 2, Phases A–D (this build)

Foundation + the data/security layer is now EXECUTED and PROVEN against a real
Postgres 16, not just typechecked. Reproduce with `RUN.md`.

```
## typecheck — npm run typecheck
RESULT: PASS (exit 0, all 5 workspaces: contracts, core, connectors, server, web)

## core engine unit tests — npm run test:core
 ✓ src/comp/comp.test.ts (26)  ✓ src/leave/leave.test.ts (16)  ✓ src/er/er.test.ts (14)
 ✓ src/jd/jd.test.ts (19)      ✓ src/metrics/metrics.test.ts (6)  ✓ src/org/org.test.ts (7)
 Test Files 6 passed (6)   Tests 88 passed (88)

## web production build — npm run build -w @hr-os/web   (now CODE-SPLIT)
 ✓ 77 modules transformed.
 dist/assets/index-*.css        12.81 kB
 dist/assets/People-*.js         1.87 kB         dist/assets/api-*.js           2.20 kB
 dist/assets/CommandCenter-*.js  3.28 kB         dist/assets/Leave-*.js         3.90 kB
 dist/assets/Comp-*.js           7.22 kB         dist/assets/index-*.js       160.66 kB (gzip 52.33)

## pgTAP — RLS + append-only audit, run AS THE NON-SUPERUSER app role (hros_app)
##   pg_prove -U hros_app packages/server/test/pgtap/rls_audit.sql
 1..25  ... all 25 ok ... Result: PASS
 Covers: cross-tenant SELECT+INSERT blocked both ways (incl. leave_case, pay_band);
 audit trigger fires on INSERT/UPDATE/DELETE with correct actor/tenant; DELETE
 captures OLD row; deny-by-default with no tenant GUC; audit_log rejects
 UPDATE/DELETE/TRUNCATE from the app role.

## migration idempotency — ./infra/migrate.sh run twice
 First apply: clean. Second apply: only "already exists, skipping" notices; no error, no data loss.

## synthetic demo seed — npm run seed (inserted via withActor → RLS + audit apply)
 worksites=5 positions=6 workers=12 comp=12 leave_cases=3 pay_bands=3  (idempotent on re-run)
 audit_log: every seeded row stamped to system.seed@hros.example + the demo tenant.

## axe accessibility — npm run test -w @hr-os/web (axe-core in jsdom)
 6 passed: People, Comp, Leave, Command Center (populated), empty state, error states.
 Zero serious/critical violations. (color-contrast needs a real browser → Phase E.)

## end-to-end API proof (server on live Postgres, curl as 4 roles) — see CHANGES
 People: comp_analyst sees pay; people_manager payload OMITS pay (read-path masking).
 /comp/records: people_manager 403 (gate); comp_analyst 200 + 3 persisted bands w/ lock state.
 /leave/cases: 3 cases incl. await-designation; engine eligibility eligible=False (1180<1250 hrs).
 POST /people (admin) → 201, audit worker-INSERT count +1; people_manager → 403; no token → 401.
 AI: no key → labeled `event: fallback` (degraded:true); email-shaped fact → 422 pii_blocked;
     er_enrich enableWebSearch=true → ignored (not whitelisted), still fallback, no error.
```

## Definition of done (this phase) — met
1. Runs end-to-end locally; real rows from Postgres through People/Leave/Comp. ✓ (RUN.md)
2. Safety systems PROVEN (pgTAP 25/25: RLS isolation, audit attribution, append-only). ✓
3. Three slices persist + read via withActor; masking at the read path; mutations audited. ✓
4. Toyota baseline: loading/empty/error + error boundary; code-split; labeled AI fallback;
   axe zero serious/critical on built surfaces. ✓
5. Synthetic demo tenant seeded (Sample/.example, no PII). ✓
6. All gates green with output pasted (above). ✓

## Environment-forced decision (documented, reversible)
- Sandbox had no Docker and blocks `binaries.prisma.sh`, so Postgres was run natively
  and the RUNTIME data layer uses node-postgres behind the unchanged `withActor`
  contract. `schema.prisma` is still authoritative; the migration is unchanged. See
  `docs/DATA-TOPOLOGY.md` §4. `TODO(fable5)` to restore PrismaClient when reachable.

## Not this phase (Stage 2+ / senior pass) — see docs/FABLE5_HANDOFF.md §6/§7
- Surface UIs over built engines: ER, Org, JD; plus Metrics Studio, Service Desk,
  Tasks, Documents, Audit viewer, Admin/Connectors.
- Live ADP OAuth+mTLS; SSO/SCIM (replaces the dev-token route); Redis rate-limit + BullMQ.
- Browser-based Playwright + axe e2e (incl. color-contrast).
- Physical LeaveIQ/ERIQ data migration into the consolidated store (shape is ready).
- Backlog features: Disciplinary/Corrective-Action generator; employee-file AI
  retrieval layer (seam designed: `WorkerFactView` in contracts/canonical.ts).

---

# Stage 3 — Azure production-hardening + Profile D + UI elevation (this phase)

All Stage-2 gates re-run first with no drift, then new work added with its own gates.

## typecheck — npm run typecheck
 5/5 workspaces clean (contracts, core, connectors, server, web).

## core engines — npm run test:core
 88/88 passing (unchanged; pure deterministic engines).

## server unit — npm run test -w @hr-os/server
 24/24 passing:
  - auth/oidc (9): valid RS256; sub fallback; expired; wrong issuer; wrong audience;
    no mapped role; missing tenant claim; people_manager field masking; admin no-mask.
  - demo (12): mint pins the demo tenant; refuses non-demo tenant (403) and non-demo
    role (400); assertProfileSafety fail-closed across the contradictory-env matrix.
  - ratelimit (3): pure token-bucket window behavior.

## migration idempotency — infra/migrate.sh (applied twice)
 Clean on first apply and on re-apply (incl. the additive, RLS-forced, audited app_user).

## pgTAP — RLS + append-only audit (as NON-superuser hros_app)
 25/25 passing: cross-tenant SELECT+INSERT blocked both ways; audit attribution on
 INSERT/UPDATE/DELETE (+ app_user); deny-by-default with no tenant GUC; audit_log
 rejects UPDATE/DELETE/TRUNCATE.

## demo reseed self-heal — npm run reseed (RLS-scoped to the demo tenant)
 Injected a non-canonical worksite via an RLS-scoped session, ran reseed:
 worksites 6 -> 5, non-canonical rows 1 -> 0. Confined to the demo tenant by RLS.

## web build — npm run build -w @hr-os/web
 Clean. Main chunk ~57 kB gzip; People/Comp/Leave/CommandCenter still code-split;
 lucide tree-shaken to only the icons used; CSS ~4.6 kB gzip.

## web a11y (axe) — npm run test -w @hr-os/web
 6/6 passing, zero serious/critical: People, Comp, Leave, Command Center (populated),
 empty state, error states. (color-contrast still needs a real browser → Playwright.)

## Azure IaC / CI validation (cannot deploy from sandbox — by design)
 Bicep delimiters balanced: 34 resources / 25 params / 12 outputs.
 deploy-azure.yml + ci.yml both parse as valid YAML (4 jobs total).
 Profile P/D parameter JSON valid. `az bicep build` + `what-if` are the operator's
 pre-apply steps (Bicep CLI host unreachable in the sandbox; stated, not faked).
 Azure specifics verified via web search before authoring (pgcrypto azure.extensions
 allowlist; Container Apps SIGTERM 30s + liveness/readiness/startup probes;
 GitHub→Azure OIDC federation with az acr build).

## Definition of done (this phase) — met
1. Spine hardened to production-grade on Azure as reviewable IaC + keyless CI/CD,
   with verified facts and honest "not deployed" status. ✓
2. Profile D demo is safe by construction: tenant-pinned tokens, no SSO/SCIM/prod
   data, labeled-fallback AI, scale-to-zero, scheduled reseed, fail-closed boot. ✓
3. UI elevated within the fixed brand: documented token system, refined components
   and states, restrained motion, demo front door; build + axe green. ✓
4. CLAUDE.md invariants held (AI assists/humans decide; no PII — all data synthetic;
   pinned model + 4096 ceiling; tenant isolation at the DB via RLS; append-only
   audit). ✓
5. All gates green with output pasted (above). ✓

## Still not this phase (next pass) — see docs/FABLE5_HANDOFF.md §6/§7
- Remaining surface UIs over built engines (ER/Org/JD) and unbuilt surfaces
  (Metrics Studio, Service Desk, Tasks, Documents, Audit viewer, Admin/Connectors).
- Live ADP OAuth+mTLS connector; physical LeaveIQ/ERIQ data migration.
- Browser Playwright + axe e2e (incl. color-contrast).
- VNet + Private Endpoints production-network hardening (TODO markers in main.bicep).
