/**
 * Dev-only token endpoint. It MINTS a real, signed JWT for a chosen role in the
 * demo tenant, so the local UI's role switcher exercises the genuine verified-JWT
 * auth path end to end (RLS, masking, audit all driven by the token's claims).
 *
 * This is NOT an auth bypass: the API still trusts only a verified JWT. This route
 * is the only "dev" concession, and it is mounted ONLY when NODE_ENV != production.
 * TODO(fable5): replace with the SSO/OIDC flow (the IdP issues these JWTs) and SCIM
 * provisioning; delete this route. See packages/server/src/auth/embedded.ts.
 */
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { ROLES, type Role } from "@hr-os/contracts";
import { DEMO_TENANT_ID, demoActorId } from "../demo.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Hard gate: never available in production, and never in a demo deployment
  // (demo uses the tenant-pinned /demo/session minter instead). Local dev only.
  if (config.env === "production" || config.demo.enabled) return;

  app.post("/auth/dev-token", async (req, reply) => {
    const role = (req.body as { role?: string } | undefined)?.role;
    if (!role || !(ROLES as readonly string[]).includes(role)) {
      return reply.code(400).send({ error: "invalid_role", allowed: ROLES });
    }
    const r = role as Role;
    const token = jwt.sign(
      { sub: demoActorId(r), tenant_id: DEMO_TENANT_ID, role: r },
      config.jwtSecret,
      { expiresIn: "8h" },
    );
    return { token, role: r, tenantId: DEMO_TENANT_ID, dev: true };
  });
}
