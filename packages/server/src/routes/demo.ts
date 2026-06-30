/**
 * Demo session minter (§ Profile D — no SSO). Mounted ONLY when DEMO_MODE is on.
 * It lets a visitor pick a role and receive a short-lived signed JWT so they can
 * click through the product as that role — bound EXCLUSIVELY to the synthetic demo
 * tenant.
 *
 * Security-critical guarantees (defense in depth on top of RLS):
 *   1. The tenant is HARD-PINNED to DEMO_TENANT_ID. The request body's tenant (if
 *      any) is never trusted; a request naming any other tenant is REFUSED (403).
 *   2. Only DEMO_ROLES may be issued; anything else is 400.
 *   3. Tokens are short-lived and carry `demo: true`.
 * Because the minter only ever sets DEMO_TENANT_ID, and RLS scopes every row to
 * the token's tenant claim, demo mode cannot read or write any other tenant.
 *
 * `mintDemoToken` is exported pure (sign function injected) so it is unit-tested
 * without standing up Fastify — including the proof that a spoofed tenant is
 * ignored and the issued token is always the demo tenant.
 */
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { DEMO_TENANT_ID, DEMO_TENANT_NAME, DEMO_ROLES, isDemoRole, demoActorId } from "../demo.js";
import type { Role } from "@hr-os/contracts";

export interface DemoMintInput {
  role?: unknown;
  /** If present and NOT the demo tenant, the request is rejected. */
  tenantId?: unknown;
}

export type DemoMintResult =
  | { ok: true; role: Role; tenantId: string; token: string }
  | { ok: false; status: 400 | 403; error: string };

type SignFn = (payload: object) => string;

/**
 * Pure minting decision. Pins the demo tenant; refuses any other tenant; refuses
 * non-demo roles. The signer is injected for testability.
 */
export function mintDemoToken(input: DemoMintInput, sign: SignFn): DemoMintResult {
  // (1) Refuse any attempt to mint for a non-demo tenant — never silently coerce.
  if (input.tenantId != null && input.tenantId !== DEMO_TENANT_ID) {
    return { ok: false, status: 403, error: "demo_tenant_only" };
  }
  // (2) Only allowlisted demo roles.
  const role = input.role;
  if (typeof role !== "string" || !isDemoRole(role)) {
    return { ok: false, status: 400, error: "invalid_demo_role" };
  }
  const r = role as Role;
  // (3) Pin the tenant. The body never decides this.
  const token = sign({ sub: demoActorId(r), tenant_id: DEMO_TENANT_ID, role: r, demo: true });
  return { ok: true, role: r, tenantId: DEMO_TENANT_ID, token };
}

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  if (!config.demo.enabled) return; // not mounted outside demo profile

  // Public metadata so the SPA can render the role picker and the synthetic banner.
  app.get("/demo/info", async () => ({
    demo: true,
    tenant: DEMO_TENANT_NAME,
    roles: DEMO_ROLES,
    readOnly: config.demo.readOnly,
    aiLive: config.demo.allowLiveAi,
    note: "Demo data - all records are synthetic (.example). No real people.",
  }));

  app.post("/demo/session", async (req, reply) => {
    const body = (req.body ?? {}) as DemoMintInput;
    const sign: SignFn = (payload) => jwt.sign(payload, config.jwtSecret, { expiresIn: "1h" });
    const res = mintDemoToken(body, sign);
    if (!res.ok) return reply.code(res.status).send({ error: res.error, allowed: DEMO_ROLES });
    return { token: res.token, role: res.role, tenantId: res.tenantId, demo: true };
  });
}
