import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { actorFromRequest, AuthError } from "../auth/embedded.js";
import { withActor, type Actor } from "../db.js";
import { can, type Permission } from "../rbac.js";
import { zPayBand, type Role } from "@hr-os/contracts";

/**
 * Compensation. comp.read/comp.write gate the whole surface (only comp roles reach
 * it); RLS scopes rows to the tenant. Bands must be LOCKED before payroll/posting
 * (governance) -- the lock is an audited mutation. Market values are operator inputs,
 * never invented (§2 invariant 2). All writes flow through the audit trigger.
 */
const zCompInput = z.object({
  workerId: z.string().uuid(),
  amount: z.number().positive().max(10_000_000),
  unit: z.enum(["hourly", "annual"]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hoursWorked12mo: z.number().nonnegative().max(8784).optional(),
});

const zBandInput = zPayBand.and(z.object({ titleKey: z.string().min(1) }));

export async function compRoutes(app: FastifyInstance): Promise<void> {
  async function authed(req: FastifyRequest, reply: FastifyReply, perm: Permission): Promise<Actor | null> {
    let actor: Actor;
    try {
      actor = await actorFromRequest(req);
    } catch (e) {
      if (e instanceof AuthError) {
        reply.code(401).send({ error: e.message });
        return null;
      }
      throw e;
    }
    if (!can(actor.role as Role, perm)) {
      reply.code(403).send({ error: "forbidden" });
      return null;
    }
    return actor;
  }

  app.get("/comp/records", async (req, reply) => {
    const actor = await authed(req, reply, "comp.read");
    if (!actor) return;
    const rows = await withActor(actor, async (tx) =>
      (await tx.$queryRawUnsafe(
        `SELECT cr.id, cr.worker_id, w.first_name, w.last_name, p.title,
                cr.amount, cr.unit, cr.effective_date, cr.hours_worked_12mo
           FROM compensation_record cr
           JOIN worker w ON w.id = cr.worker_id
           LEFT JOIN position p ON p.id = w.position_id
          ORDER BY cr.effective_date DESC
          LIMIT 500`,
      )) as Array<Record<string, unknown>>);
    return { rows };
  });

  app.post("/comp/records", async (req, reply) => {
    const actor = await authed(req, reply, "comp.write");
    if (!actor) return;
    const parsed = zCompInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const c = parsed.data;
    const created = await withActor(actor, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `INSERT INTO compensation_record (tenant_id, worker_id, amount, unit, effective_date, hours_worked_12mo)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, worker_id, amount, unit, effective_date`,
        actor.tenantId, c.workerId, c.amount, c.unit, c.effectiveDate, c.hoursWorked12mo ?? null,
      )) as Array<Record<string, unknown>>;
      return rows[0];
    });
    return reply.code(201).send({ record: created });
  });

  app.get("/comp/bands", async (req, reply) => {
    const actor = await authed(req, reply, "comp.read");
    if (!actor) return;
    const rows = await withActor(actor, async (tx) =>
      (await tx.$queryRawUnsafe(
        `SELECT id, title_key, unit, p10, p25, p50, p75, p90, confidence, locked
           FROM pay_band ORDER BY title_key`,
      )) as Array<Record<string, unknown>>);
    return { rows };
  });

  app.post("/comp/bands", async (req, reply) => {
    const actor = await authed(req, reply, "comp.write");
    if (!actor) return;
    const parsed = zBandInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const b = parsed.data;
    const saved = await withActor(actor, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `INSERT INTO pay_band (tenant_id, title_key, unit, p10, p25, p50, p75, p90, confidence, locked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_id, title_key) DO UPDATE SET
            unit = EXCLUDED.unit, p10 = EXCLUDED.p10, p25 = EXCLUDED.p25,
            p50 = EXCLUDED.p50, p75 = EXCLUDED.p75, p90 = EXCLUDED.p90,
            confidence = EXCLUDED.confidence, updated_at = now()
         RETURNING id, title_key, locked`,
        actor.tenantId, b.titleKey, b.unit, b.p10 ?? null, b.p25 ?? null, b.p50 ?? null,
        b.p75 ?? null, b.p90 ?? null, b.confidence ?? null, b.locked ?? false,
      )) as Array<Record<string, unknown>>;
      return rows[0];
    });
    return { band: saved };
  });

  // Lock workflow: a band cannot reach payroll/posting until locked. Audited as UPDATE.
  app.post("/comp/bands/lock", async (req, reply) => {
    const actor = await authed(req, reply, "comp.write");
    if (!actor) return;
    const titleKey = (req.body as { titleKey?: string } | undefined)?.titleKey;
    if (!titleKey) return reply.code(400).send({ error: "titleKey required" });
    const locked = await withActor(actor, async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE pay_band SET locked = true, updated_at = now() WHERE title_key = $1`,
        titleKey,
      );
      return n;
    });
    if (!locked) return reply.code(404).send({ error: "band_not_found" });
    return { titleKey, locked: true };
  });
}
