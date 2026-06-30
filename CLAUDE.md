# CLAUDE.md — operating contract for agentic work on HR OS

Any model or engineer extending this repo MUST hold these invariants. They are
enforced in code where possible; do not weaken one to make a check pass. If the
environment blocks a step, stub it honestly with a typed `TODO(fable5):` and say
so — never fake a green result.

## Inviolable invariants
1. **AI assists; humans decide.** Engines are deterministic. The AI gateway never
   reaches conclusions; ER returns leads to verify, never dispositions.
2. **Never fabricate** pay, benefits, legal conclusions, or citations. If a value
   isn't provided or sourced, say so.
3. **No PII to models or logs.** Forward only whitelisted structured facts. All
   sample data is `Sample` / `.example`. The PII screen lives in the gateway.
4. **Every mutation audited, append-only at the DB.** Trigger + revoked UPDATE/DELETE.
5. **Model + tokens centralized.** `MODEL_ID = "claude-sonnet-4-6"`,
   `MAX_TOKENS = 4096` in `packages/server/src/config.ts`. Never inline or lower them.
6. **Tenant isolation at the DB** via RLS + the `app.tenant_id` GUC set by `withActor`.
7. **Graceful degradation** with a clearly labeled fallback when the model is unreachable.
8. **Conservative compliance.** Escalate under uncertainty; federal fallback for leave packs.
9. **Brand + WCAG 2.2 AA.** Fixed navy/red, Arial, visible focus, reduced-motion.
10. **Additive idempotent migrations.** `IF NOT EXISTS` / guarded `DO`. Safe to re-run.
11. **Metrics safe by construction.** Constrained DSL; small-cell suppression
    (threshold 5; 10 for sensitive dimensions).

## House rules
- `core` stays pure: no DB, no framework, no network. The engine the API calls is
  the engine the UI calls is the engine the tests call.
- All DB access goes through `withActor()` so RLS and the audit trigger apply.
- The browser never holds a key and never calls a model directly.
- Em dashes corrupt to "?" in some downstream exports — prefer hyphens in any
  generated document content.
- Lean, deploy-ready output. No placeholder lorem; if it's a stub, type it and mark it.
