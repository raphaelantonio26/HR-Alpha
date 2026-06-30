import type { FastifyInstance } from "fastify";
import { actorFromRequest, AuthError } from "../auth/embedded.js";
import { withActor } from "../db.js";
import { can, maskedFields } from "../rbac.js";
import { zWorker, type Role } from "@hr-os/contracts";

/**
 * People directory. RLS scopes rows to the actor's tenant; pay masking is enforced
 * at the READ PATH, not the UI: when a role's masked fields include `amount`, the
 * query does not even select the latest pay rate, so the value never leaves the DB.
 * Writes go through withActor so the append-only audit trigger attributes them.
 */
export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/people", async (req, reply) => {
    let actor;
    try {
      actor = await actorFromRequest(req);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(401).send({ error: e.message });
      throw e;
    }
    if (!can(actor.role as Role, "people.read")) return reply.code(403).send({ error: "forbidden" });

    const masked = maskedFields(actor.role as Role);
    const payVisible = !masked.includes("amount") && !masked.includes("*");

    const rows = await withActor(actor, async (tx) => {
      // Latest comp rate per worker, joined ONLY when the role may see pay. RLS
      // applies to every joined table independently.
      const paySelect = payVisible
        ? `, (SELECT cr.amount FROM compensation_record cr
               WHERE cr.worker_id = w.id
               ORDER BY cr.effective_date DESC LIMIT 1) AS pay,
             (SELECT cr.unit FROM compensation_record cr
               WHERE cr.worker_id = w.id
               ORDER BY cr.effective_date DESC LIMIT 1) AS pay_unit`
        : "";
      return (await tx.$queryRawUnsafe(
        `SELECT w.id, w.file_number, w.first_name, w.last_name, w.status,
                w.employment_type, ws.name AS worksite, p.title AS title ${paySelect}
           FROM worker w
           LEFT JOIN worksite ws ON ws.id = w.worksite_id
           LEFT JOIN position p ON p.id = w.position_id
          ORDER BY w.last_name, w.first_name
          LIMIT 500`,
      )) as Array<Record<string, unknown>>;
    });
    return { rows, masked, payVisible };
  });

  app.post("/people", async (req, reply) => {
    let actor;
    try {
      actor = await actorFromRequest(req);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(401).send({ error: e.message });
      throw e;
    }
    if (!can(actor.role as Role, "people.write")) return reply.code(403).send({ error: "forbidden" });

    // The tenant is taken from the verified actor, never the body (anti-spoofing).
    const parsed = zWorker.omit({ id: true, tenantId: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const w = parsed.data;

    try {
      const created = await withActor(actor, async (tx) => {
        const rows = (await tx.$queryRawUnsafe(
          `INSERT INTO worker (tenant_id, file_number, first_name, last_name, status,
              worksite_id, position_id, manager_id, employment_type, hire_date, hours_per_week)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id, file_number, first_name, last_name, status`,
          actor.tenantId, w.fileNumber, w.firstName, w.lastName, w.status,
          w.worksiteId, w.positionId, w.managerId, w.employmentType, w.hireDate,
          w.hoursPerWeek ?? null,
        )) as Array<Record<string, unknown>>;
        return rows[0];
      });
      return reply.code(201).send({ worker: created });
    } catch (e) {
      // Unique (tenant_id, file_number) -> 23505.
      const code = (e as { code?: string }).code;
      if (code === "23505") return reply.code(409).send({ error: "duplicate_file_number" });
      throw e;
    }
  });
}
