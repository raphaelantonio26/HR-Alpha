/**
 * Audit helper. The authoritative audit trail is written by a DB AFTER trigger on
 * every INSERT/UPDATE/DELETE (see prisma/migrations/0001_init), and the audit
 * table REVOKEs UPDATE/DELETE so it is append-only and tamper-evident (§3.2).
 * This helper records explicit business events (an engine run, an AI dispatch,
 * an export) that are not row mutations but still belong in the trail.
 */
import type { Tx } from "./db.js";

export interface BusinessEvent {
  entity: string;
  entityId: string;
  action: string;
  /** Structured, PII-free detail only. */
  detail?: Record<string, string | number | boolean>;
}

export async function recordEvent(tx: Tx, ev: BusinessEvent): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO audit_log (id, tenant_id, actor_id, entity, entity_id, action, detail, at)
     VALUES (gen_random_uuid(), current_setting('app.tenant_id', true), current_setting('app.actor_id', true), $1, $2, $3, $4::jsonb, now())`,
    ev.entity,
    ev.entityId,
    ev.action,
    JSON.stringify(ev.detail ?? {}),
  );
}
