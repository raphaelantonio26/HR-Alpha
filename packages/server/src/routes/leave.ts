import type { FastifyInstance } from "fastify";
import { actorFromRequest, AuthError } from "../auth/embedded.js";
import { withActor } from "../db.js";
import { can } from "../rbac.js";
import { leave } from "@hr-os/core";
import { zLeaveCaseInput, type Role } from "@hr-os/contracts";

/**
 * Leave. Eligibility/clocks come from the pure engine (no fabrication). Cases are
 * the canonical leave record, attached to the worker by worker_id and persisted
 * through withActor so RLS + audit apply. Blank designation => await-designation:
 * no clocks run until HR assigns (the zero-state the UI honors).
 */
export async function leaveRoutes(app: FastifyInstance): Promise<void> {
  // Pure-engine eligibility calculator (no persistence).
  app.post("/leave/eligibility", async (req, reply) => {
    let actor;
    try {
      actor = await actorFromRequest(req);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(401).send({ error: e.message });
      throw e;
    }
    if (!can(actor.role as Role, "leave.read")) return reply.code(403).send({ error: "forbidden" });

    const parsed = zLeaveCaseInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const body = req.body as { hireDate?: string; hoursWorked12mo?: number };
    const elig = leave.eligibility({ hireDate: body.hireDate ?? "1970-01-01", hoursWorked12mo: body.hoursWorked12mo ?? 0 });
    const clocks = leave.suggestedClocks(parsed.data.reasonId, parsed.data.jurisdiction);
    return { eligibility: elig, suggestedClocks: clocks };
  });

  // Live leave cases (RLS-scoped), joined to the worker file.
  app.get("/leave/cases", async (req, reply) => {
    let actor;
    try {
      actor = await actorFromRequest(req);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(401).send({ error: e.message });
      throw e;
    }
    if (!can(actor.role as Role, "leave.read")) return reply.code(403).send({ error: "forbidden" });

    const rows = await withActor(actor, async (tx) =>
      (await tx.$queryRawUnsafe(
        `SELECT lc.id, lc.worker_id, w.first_name, w.last_name, lc.reason_id,
                lc.designation, lc.status, lc.start_date, lc.end_date,
                lc.intermittent, lc.priority, lc.jurisdiction
           FROM leave_case lc
           JOIN worker w ON w.id = lc.worker_id
          ORDER BY lc.created_at DESC
          LIMIT 500`,
      )) as Array<Record<string, unknown>>);
    return { rows };
  });

  // Create a leave case (audited). Tenant comes from the verified actor.
  app.post("/leave/cases", async (req, reply) => {
    let actor;
    try {
      actor = await actorFromRequest(req);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(401).send({ error: e.message });
      throw e;
    }
    if (!can(actor.role as Role, "leave.write")) return reply.code(403).send({ error: "forbidden" });

    const parsed = zLeaveCaseInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const c = parsed.data;
    // Empty designation array is treated as await-designation (NULL), same as the engine.
    const designation = c.designation && c.designation.length > 0 ? c.designation : null;

    const created = await withActor(actor, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `INSERT INTO leave_case (tenant_id, worker_id, reason_id, designation, status,
            start_date, end_date, intermittent, priority, jurisdiction)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, worker_id, reason_id, designation, status, jurisdiction`,
        actor.tenantId, c.workerId, c.reasonId, designation,
        designation ? "open" : "intake", c.startDate, c.endDate,
        c.intermittent, c.priority, c.jurisdiction,
      )) as Array<Record<string, unknown>>;
      return rows[0];
    });
    return reply.code(201).send({ case: created });
  });
}
