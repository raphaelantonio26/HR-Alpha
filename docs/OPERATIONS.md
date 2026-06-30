# Operations

## Health

- `GET /healthz` — process liveness (always `ok` if the server is up).
- `GET /readyz` — readiness; runs `SELECT 1` and returns `503 degraded` if the DB is
  unreachable. Wire this to the orchestrator's readiness probe.

## AI gateway operations

- **Model/tokens** are fixed in `packages/server/src/config.ts`
  (`claude-sonnet-4-6`, `max_tokens 4096`). Do not lower them.
- **Rate limits** (per minute): per user (`AI_RATE_USER`, default 20) and per tenant
  (`AI_RATE_TENANT`, default 200). Exceeding returns `429` with the offending scope.
  **The limiter is in-memory in Stage 1** — replace with a Redis token bucket before
  multi-instance deploy, or each instance limits independently.
  **TODO(fable5):** Redis-backed limiter + BullMQ for long generations.
- **Degradation** is expected and safe: missing key or upstream error emits
  `event: fallback` over SSE and the UI labels the result as local/deterministic.
- **Disconnects**: the gateway aborts the upstream call when the client closes, so a
  user navigating away does not leave a generation running.

## Audit & investigation

`audit_log` is append-only. To investigate activity, query by `tenant_id` + time
window or by `entity`/`entity_id` (both indexed). Do not attempt to mutate the table
— UPDATE/DELETE are revoked by design. The Audit Trail surface (Stage 2) is a
read-only viewer over this table.

## Sync operations

Connector syncs are idempotent; a re-run with an unchanged source is a no-op. A sync
that hits invalid rows aborts the commit and preserves last-known-good — investigate
the reported invalid set, fix at the source, and re-run. Every applied change carries
its `source` in the audit trail.

## Backups & retention

- Back up Postgres including `audit_log` (it is the system of record for "who did
  what"). Treat it as write-once; retention is governed by policy, deletion only by a
  controlled, audited archival process — never ad hoc.
- Object storage holds generated documents; back up alongside the database.

## Observability (Stage 2)

Add structured request logging (PII-free), metrics on AI dispatch latency / fallback
rate / 429 rate, and DB connection-pool health. Alert on a rising fallback rate (model
reachability) and on `readyz` failures.

## Runbooks (stubs to fill in Stage 2)

- **AI upstream outage** → confirm fallback is serving; no action needed for
  correctness; monitor fallback rate.
- **DB unreachable** → `readyz` flips to 503; check Postgres; the app fails closed.
- **Connector auth failure** → driver `verify()` reports it; re-issue credentials;
  last-known-good data remains served.
