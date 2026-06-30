# ADR 0001 — Stack and Stage-1 scope

- **Status:** Accepted
- **Date:** 2026-06
- **Context:** Stage-1 build of HR OS, a multi-tenant, HRIS-agnostic enterprise HR
  platform, from a master build specification.

## Decision

Build a TypeScript monorepo (npm workspaces) with a strict one-way dependency
graph: `contracts → core → {server, web}`, `connectors → server`. Implement the
**correctness-critical decision engines first**, as pure deterministic functions
in `core`, fully unit-tested, before building any stateful or external layer.
Enforce the security-critical invariants **at the database** (Postgres RLS for
tenant isolation; an `AFTER` trigger plus a revoked-`UPDATE`/`DELETE` `audit_log`
for an append-only trail). Reach the model through a **single server-side AI
gateway** with PII screening, purpose-scoped web search, rate limiting, SSE
streaming with client-disconnect abort, and a labeled deterministic fallback.

### Stack
- **Language/build:** TypeScript 5.5, strict, `noUncheckedIndexedAccess`, Bundler
  resolution. npm workspaces (no extra monorepo tool needed at this size).
- **Validation/contracts:** zod at every trust boundary; shared canonical types.
- **Engines:** pure TS in `core`; **vitest** for unit tests.
- **Server:** Fastify; Prisma + Postgres 16; JWT auth; `jsonwebtoken`.
- **Web:** Vite + React 18 + Tailwind on Atrium channel-triple tokens; zustand.
- **Infra:** docker-compose (Postgres/Redis/MinIO); GitHub Actions CI.

### Stage-1 scope (delivered)
contracts; the six `core` engines with 88 passing tests; the server (API + AI
gateway + Prisma schema + idempotent RLS/audit migration + RBAC + auth);
connectors (contract + ADP dry-run + CSV + sync pipeline); the web shell with 13
surfaces (4 wired to engines); infra + docs. Verified gates: typecheck (5/5
workspaces), 88 unit tests, web production build.

### Out of scope for Stage 1 (deferred)
Live ADP OAuth+mTLS; SSO/SCIM; Redis-backed rate limiting + BullMQ; the remaining
module UIs over built engines (ER/Org/JD) and the unbuilt surfaces (Metrics
Studio, Service Desk, Tasks, Documents, Audit viewer, Admin); pgTAP (RLS/audit)
and Playwright + axe e2e gates.

## Alternatives considered

- **A heavier monorepo toolchain (Turborepo/Nx).** Rejected for Stage 1 — npm
  workspaces cover build ordering and dependency wiring at this scale; adding a
  tool now is overhead without payoff. Reversible later.
- **Application-layer tenant scoping instead of RLS.** Rejected — one forgotten
  `WHERE` is a cross-tenant leak. RLS fails closed and survives query mistakes.
- **Application-written audit instead of a DB trigger.** Rejected — app-layer
  audit depends on every write path remembering to log. A trigger + revoked
  mutations is tamper-evident and unavoidable.
- **Letting the browser call the model (key in client / per-module calls).**
  Rejected outright — the failure mode is PII exfiltration and fabricated
  citations at scale. One server gateway is the only egress.
- **Building all 13 surfaces shallowly first.** Rejected — correctness is the real
  risk; a late chart is recoverable, a wrong entitlement is not. Engines were
  proven before UI.

## Deviations from the brief (deliberate, reversible)

1. **No `recharts` / `framer-motion` / `lucide-react` in `web`** for Stage 1 —
   hand-rolled SVG sparkline, CSS-transition motion, inline icons — to keep the
   build fast and dependency-light. Purely additive to re-introduce.
2. **Skeleton routes use `withActor` + raw SQL** rather than generated Prisma model
   methods, so the server typechecks before `prisma generate` (which needs a live
   DB URL). The GUC pattern stays when routes move to typed model calls.
3. **In-memory rate limiter** in the gateway, to be replaced by Redis before
   multi-instance deploy.

## Consequences

- **Positive:** the parts with legal/pay consequence are isolated, deterministic,
  and proven; security fails closed; the model has exactly one, screened egress;
  the platform is genuinely HRIS-agnostic; migrations are safe to re-run.
- **Negative / debts:** several surfaces are designed empty-states pending UI; live
  ADP, SSO/SCIM, Redis limiting, and the infra-dependent test gates are Stage 2.
  All are tracked with typed `TODO(fable5)` markers and ready-to-paste prompts in
  `docs/FABLE5_HANDOFF.md`.
EOF
