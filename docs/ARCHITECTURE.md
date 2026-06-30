# Architecture

HR OS is a TypeScript monorepo. The organizing principle: **the parts where a
wrong answer has legal or pay consequences are pure, deterministic, and tested in
isolation; everything stateful or external is a thin layer around them.**

## Dependency graph

```
@hr-os/contracts ─►  @hr-os/core  ─►  @hr-os/server
        │                 ▲                 ▲
        │            @hr-os/connectors ─────┘
        └──────────► @hr-os/web ◄── @hr-os/core
```

One-way. `core` never imports `server`, `web`, a database client, or `react`.
`contracts` imports nothing internal. This is what lets the engines be proven
before any infrastructure exists, and what keeps a UI change from ever altering a
compliance calculation.

## Packages

### contracts — the shared vocabulary
Canonical domain types (Worker, Position, Worksite, OrgUnit, EmploymentRecord,
CompensationRecord, PayBand, LeaveCase, ErCase, MetricDefinition), enums
(jurisdictions, roles, FLSA, sync sources), and the zod schemas used at every
trust boundary (`zWorker`, `zPayBand`, `zLeaveCaseInput`, `zErIntake`,
`zAiRequest`). `fileNumber` is `TEXT` — payroll IDs have leading zeros that an
integer would destroy. Pay-band percentile fields are locked semantics: `p25` is
the floor anchor, `p50` the midpoint, `p75` the ceiling.

### core — the decision engines (pure, deterministic, 88 tests)
- **leave** — eligibility (12 months + 1,250 hours), entitlement with proration
  (PDL = 17.33 weeks), FMLA rolling-12-month-backward usage vs. PDL cumulative
  usage, an await-designation zero-state, concurrent clock resolution, exhaustion
  projection. Rule packs (`california.ts`) carry the jurisdiction specifics and
  fall back to federal when a state pack is absent.
- **comp** — hourly/annual conversion (2,080 hours), percentile interpolation,
  band placement (compa-ratio, percentile, penetration, distance-to-minimum),
  remediation cost, a confidence label, and a construction layer (fringe, fully
  burdened rate, open-shop vs. prevailing-wage vs. CBA regime comparison,
  apprentice step placement). Hardened against NaN/Infinity/negative inputs.
- **er** — statutory catalog (FEHA, LC1102.5, CFRA, FMLA, ADA/FEHA-IP, LC232.5,
  workplace-violence), a deterministic 0–100 risk score (clamped), a ≤90-day
  retaliation-window check, policy alignment, litigation-exposure banding,
  conservative recommendations (escalate to investigation under uncertainty,
  never jump to discipline), and cross-case pattern detection on attributes only.
- **jd** — title-key normalization, most-specific-trade inference
  (fire-sprinkler/fire-alarm/low-voltage/controls/plumbing/HVAC/electrical/
  solar-EV), section-scoped generation (only requested sections), required vs.
  preferred split, FLSA from level, and a hard no-pay-statement rule.
- **org** — span of control (direct reports, total descendants, max depth, flags),
  HRBP coverage math for the two-pillar plan, and a dependency-free tidy-tree
  layout. Cycle-guarded.
- **metrics** — a governed catalog of measures and dimensions, a constrained DSL
  (measure / literal / operator nodes only — no arbitrary expressions), safe
  evaluation against pre-aggregated values, and small-cell suppression (threshold
  5; raised to 10 for sensitive dimensions like EEO class).

### connectors — HRIS abstraction
A `Connector` contract (verify / fetchRoster / fetchCompensation / writeBack /
describeFieldMap) so modules never see a vendor's shape. The ADP Workforce Now
driver ships its complete field map and runs dry-run in Stage 1; the generic CSV
driver neutralizes formula injection on every cell. The sync pipeline is
validate → diff → commit: idempotent (re-running a source yields no changes),
blank-safe (an empty incoming value never erases data), and provenance-stamped
(every change records its source).

### server — API + the AI gateway
Fastify. The model is reached **only** here. `withActor()` opens a transaction and
sets `app.actor_id` / `app.tenant_id` / `app.role` as `LOCAL` GUCs, so RLS scopes
every statement and the audit trigger attributes every write. The AI gateway
(below) is the one egress to Anthropic. RBAC is a matrix in code that the secure
read-path and the API both consult.

### web — the surfaces
Vite + React + Tailwind on Atrium tokens (channel-triple RGB CSS variables, so
opacity utilities and light/dark are a single source of truth; brand navy/red
fixed). An app shell (sidebar, topbar, ⌘K palette, theme toggle) hosts 13 module
surfaces. People, Leave, Comp, and the Command Center call the real `core`
engines; the rest are designed empty-states whose engines (ER/Org/JD) are already
built and tested.

## Request flow (a leave eligibility check)

```
Browser ──POST /leave/eligibility──► Fastify route
   route: actorFromRequest()  → verify JWT → Actor{actorId,tenantId,role}
   route: can(role,"leave.read")?  → 403 if not
   route: zLeaveCaseInput.parse(body)  → 400 if invalid
   route: leave.eligibility(...) + leave.suggestedClocks(...)   ← pure engine
   ◄── { eligibility, suggestedClocks }
```

No DB write here, so no transaction; a mutating route would wrap the work in
`withActor()` and let the trigger record it.

## AI dispatch flow

```
Browser ──POST /ai/dispatch──► route → actorFromRequest() → handleAiDispatch()
   zAiRequest.parse        → 400 on bad shape
   findPii(facts)          → 422 if any PII-shaped key/value
   rate limit (user, then tenant)   → 429 if exceeded
   enableWeb = body.enableWebSearch && WEB_SEARCH_ALLOWED.has(purpose)
   begin SSE; AbortController bound to client 'close'
   no API key?  → event: fallback (deterministic, labeled) → done
   loop ≤ MAX_TOOL_ROUNDS:
       POST /v1/messages  { model: MODEL_ID, max_tokens: MAX_TOKENS, system, messages, tools? }
       relay text deltas as event: text
       stop_reason != tool_use → break
   event: done   (or event: fallback on upstream error)
```

The browser never holds a key. `web_search` is server-executed and enabled only
for `jd_research`, `policy_assistant`, and `comp_analyst` — `er_enrich` is
deliberately excluded so investigation inputs never leave for the open web.

## Enforcement points (where invariants actually live)

| Invariant | Enforced at |
|---|---|
| Tenant isolation | Postgres RLS + `FORCE ROW LEVEL SECURITY`, keyed on the `app.tenant_id` GUC set by `withActor` |
| Append-only audit | `AFTER` trigger `hros_audit()` + `REVOKE UPDATE,DELETE` on `audit_log` |
| No PII to models | `gateway.findPii()` + `zAiRequest` whitelist of structured facts |
| Model/token lock | `MODEL_ID`/`MAX_TOKENS` constants in `config.ts`, imported everywhere |
| No fabricated pay | `core/comp` declines absent inputs; `core/jd` emits no pay strings (unit-tested) |
| Conservative ER | `core/er` recommendation ladder; never disciplines on thin/uncertain signal (unit-tested) |
| Metric safety | constrained DSL + `suppress()` with raised sensitive-dimension threshold |
| Idempotent migrations | `IF NOT EXISTS` + guarded `DO` blocks |

## Why these choices

- **Engines before infrastructure** because correctness is the risk that matters
  here; a chart that renders late is recoverable, a wrong entitlement is not.
- **Security at the database** because application-layer tenant checks are one
  forgotten `WHERE` away from a cross-tenant leak; RLS fails closed.
- **A single AI egress** because a key in the browser or a model call from a
  module is the failure mode that leaks PII or fabricates a citation at scale.

See [`FABLE5_HANDOFF.md`](FABLE5_HANDOFF.md) for the build status and the
extension backlog, and [`adr/0001-stack-and-stage1-scope.md`](adr/0001-stack-and-stage1-scope.md)
for the stack rationale.
