/**
 * SCIM 2.0 provisioning (§ Profile P). Microsoft Entra pushes user lifecycle here
 * with a bearer token. We implement the core /Users surface Entra exercises
 * (create / get / list / replace-active / deactivate), persisting to the
 * tenant-scoped, RLS-FORCED, audited `app_user` table via withActor.
 *
 * Scope/auth:
 *  - Mounted only when SCIM_ENABLED. The bearer token is compared in constant time.
 *  - Single-tenant-per-deployment: writes are scoped to SCIM_TENANT_ID. Per-tenant
 *    SCIM (a token-per-tenant map) is a documented TODO(fable5) seam.
 *  - The provisioning principal is a synthetic admin actor used only for RLS scope
 *    + audit attribution; it is never a user session.
 *
 * Role mapping: a SCIM `roles[0].value` that is a known HR OS role is honored,
 * else the user is provisioned as `employee` and elevated later via Entra app roles
 * on the access token (the OIDC path maps roles at sign-in).
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";
import { withActor, type Actor } from "../db.js";
import { ROLES, type Role } from "@hr-os/contracts";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

function scimActor(): Actor {
  return { actorId: "scim-provisioner@hros.example", tenantId: config.scim.tenantId, role: "administrator" };
}

function tokenOk(req: FastifyRequest): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.scim.token);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

interface AppUserRow {
  id: string;
  external_id: string;
  user_name: string;
  role: string;
  active: boolean;
}

function toScim(u: AppUserRow): object {
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    externalId: u.external_id,
    userName: u.user_name,
    active: u.active,
    roles: [{ value: u.role, primary: true }],
    meta: { resourceType: "User" },
  };
}

function roleFrom(body: Record<string, unknown>): Role {
  const roles = body.roles as Array<{ value?: string }> | undefined;
  const v = roles?.[0]?.value;
  return v && (ROLES as readonly string[]).includes(v) ? (v as Role) : "employee";
}

function scimError(reply: FastifyReply, status: number, detail: string): FastifyReply {
  return reply.code(status).type("application/scim+json").send({ schemas: [ERR_SCHEMA], status: String(status), detail });
}

export async function scimRoutes(app: FastifyInstance): Promise<void> {
  if (!config.scim.enabled) return;

  // All SCIM routes require the provisioning bearer token.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/scim/")) return;
    if (!tokenOk(req)) {
      reply.header("WWW-Authenticate", "Bearer");
      return scimError(reply, 401, "invalid_scim_token");
    }
  });

  app.post("/scim/v2/Users", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userName = body.userName as string | undefined;
    const externalId = (body.externalId as string | undefined) ?? userName;
    if (!userName || !externalId) return scimError(reply, 400, "userName and externalId required");
    const role = roleFrom(body);
    const active = body.active === undefined ? true : Boolean(body.active);
    try {
      const created = await withActor(scimActor(), async (tx) => {
        const rows = (await tx.$queryRawUnsafe(
          `INSERT INTO app_user (tenant_id, external_id, user_name, role, active)
           VALUES ($1,$2,$3,$4,$5) RETURNING id, external_id, user_name, role, active`,
          config.scim.tenantId, externalId, userName, role, active,
        )) as AppUserRow[];
        const r = rows[0];
        if (!r) throw new Error("scim_insert_returned_no_row");
        return r;
      });
      return reply.code(201).type("application/scim+json").send(toScim(created));
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return scimError(reply, 409, "user_exists");
      throw e;
    }
  });

  app.get("/scim/v2/Users", async (req, reply) => {
    const rows = await withActor(scimActor(), async (tx) =>
      (await tx.$queryRawUnsafe(
        `SELECT id, external_id, user_name, role, active FROM app_user ORDER BY user_name LIMIT 200`,
      )) as AppUserRow[],
    );
    return reply.type("application/scim+json").send({
      schemas: [LIST_SCHEMA],
      totalResults: rows.length,
      startIndex: 1,
      itemsPerPage: rows.length,
      Resources: rows.map(toScim),
    });
  });

  app.get("/scim/v2/Users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await withActor(scimActor(), async (tx) =>
      (await tx.$queryRawUnsafe(
        `SELECT id, external_id, user_name, role, active FROM app_user WHERE id = $1`, id,
      )) as AppUserRow[],
    );
    const row = rows[0];
    if (!row) return scimError(reply, 404, "not_found");
    return reply.type("application/scim+json").send(toScim(row));
  });

  // Entra deprovisioning typically PATCHes active=false (soft delete).
  app.patch("/scim/v2/Users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { Operations?: Array<{ op?: string; path?: string; value?: unknown }> };
    let active: boolean | null = null;
    for (const op of body.Operations ?? []) {
      const path = (op.path ?? "").toLowerCase();
      if (path === "active" || (op.value && typeof op.value === "object" && "active" in (op.value as object))) {
        active = path === "active" ? Boolean(op.value) : Boolean((op.value as { active?: unknown }).active);
      }
    }
    if (active === null) return scimError(reply, 400, "unsupported_patch");
    const rows = await withActor(scimActor(), async (tx) =>
      (await tx.$queryRawUnsafe(
        `UPDATE app_user SET active = $2, updated_at = now() WHERE id = $1
         RETURNING id, external_id, user_name, role, active`, id, active,
      )) as AppUserRow[],
    );
    const row = rows[0];
    if (!row) return scimError(reply, 404, "not_found");
    return reply.type("application/scim+json").send(toScim(row));
  });

  // Hard delete is supported but Entra prefers PATCH active=false.
  app.delete("/scim/v2/Users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const n = await withActor(scimActor(), async (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM app_user WHERE id = $1`, id),
    );
    if (n === 0) return scimError(reply, 404, "not_found");
    return reply.code(204).send();
  });
}
