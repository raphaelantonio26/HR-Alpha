# Security

Defense in depth, with the load-bearing controls at the database where they fail
closed rather than in application code where they fail open.

## Tenant isolation — Postgres RLS

Every business table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and a
`tenant_isolation` policy comparing `tenant_id` to the `app.tenant_id` GUC.
`withActor()` (`packages/server/src/db.ts`) sets that GUC `LOCAL` to each
transaction. Consequences:

- A query that forgets `WHERE tenant_id = …` **still** returns only the actor's
  tenant — RLS scopes it.
- `FORCE` means even the table owner is subject to the policy.
- Code that bypasses `withActor` has no tenant context and sees nothing.

**Verify (Stage 2, pgTAP):** open tenant A's context, assert zero tenant-B rows on
SELECT and rejection on INSERT with a B `tenant_id`.

## Append-only audit

`hros_audit()` fires `AFTER INSERT/UPDATE/DELETE` on every business table and writes
actor/tenant (from the GUCs), entity, action, and a row snapshot to `audit_log`.
`UPDATE`, `DELETE`, and `TRUNCATE` on `audit_log` are **revoked** from the app role;
only `INSERT`/`SELECT` are granted. The trail is tamper-evident and does not depend
on application discipline.

**Verify (Stage 2, pgTAP):** assert the trigger fires on each operation with correct
attribution, and that UPDATE/DELETE on `audit_log` fail.

## The PII boundary is the AI gateway

`packages/server/src/ai/gateway.ts`:

- `findPii()` rejects keys matching `ssn|social|dob|birth|name|email|phone|address|
  medical|diagnosis|narrative` and values matching SSN/email patterns → `422`.
- `zAiRequest` whitelists the request shape; modules forward only minimal structured
  facts (e.g. `{ tenureMonths, hoursLast12mo }`), never identities or narrative.
- The gateway does not log request facts.
- `web_search` is enabled only for `jd_research`, `policy_assistant`, `comp_analyst`.
  `er_enrich` is excluded so investigation inputs never reach the open web.
- Client disconnect aborts the upstream call (no orphaned generation).
- No key → labeled deterministic fallback (the UI shows the result is local).

## Secrets

No secrets in source. `packages/server/.env.example` documents every variable with
placeholders. `ANTHROPIC_API_KEY` is server-only; the browser never holds it. Rotate
`JWT_SECRET`; never commit a real value.

## AuthN / AuthZ

App authorization is a verified JWT (SSO-issued in production) carrying
`sub`/`tenant_id`/`role`. A trusted internal header may carry the acting principal
for **audit attribution only** and is never a substitute for authorization. RBAC is a
matrix (`packages/server/src/rbac.ts`); sensitive fields (pay, government IDs) are
masked at the read path per role, not merely hidden in the UI.

## CSV / spreadsheet injection

Every imported and exported cell is neutralized (`csvGuard.ts`): a leading
`= + - @` / tab / CR gets an apostrophe prefix so it renders as text and cannot
execute on reopen.

## Known gaps (Stage 2)

- Redis-backed rate limiting (in-memory today).
- SSO/SCIM provisioning.
- pgTAP (RLS/audit) and Playwright + axe e2e in CI.
- Hardened (multi-stage, distroless, non-root) server image.
