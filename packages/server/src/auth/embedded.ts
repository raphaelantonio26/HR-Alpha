/**
 * Authentication / actor resolution. App authorization comes from a verified JWT.
 * Two verification modes, selected by config.authMode (one image, two profiles):
 *   - `oidc`  (Profile P): RS256 verified against Microsoft Entra's JWKS, with
 *             issuer + audience checks (see ./oidc.ts).
 *   - `hs256` (dev / demo / embedded service): HS256 verified with a shared
 *             secret, the path the dev-token and demo-session minters use.
 *
 * Either way the result is the same `Actor`, so withActor/RLS/audit/masking are
 * unchanged downstream. A trusted internal header is NOT honored as authorization;
 * authorization is the verified token, full stop.
 */
import type { FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { Actor } from "../db.js";
import type { Role } from "@hr-os/contracts";
import { defaultOidcVerifier, OidcError } from "./oidc.js";

interface Claims {
  sub: string;
  tenant_id: string;
  role: Role;
}

export class AuthError extends Error {}

function bearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) throw new AuthError("missing bearer token");
  return header.slice("Bearer ".length);
}

/**
 * Resolve and verify the acting principal from the request, or throw AuthError.
 * Async because OIDC verification consults a (cached) remote JWKS.
 */
export async function actorFromRequest(req: FastifyRequest): Promise<Actor> {
  const token = bearer(req);

  if (config.authMode === "oidc") {
    try {
      const verify = defaultOidcVerifier();
      const a = await verify(token);
      return { actorId: a.actorId, tenantId: a.tenantId, role: a.role };
    } catch (e) {
      if (e instanceof OidcError) throw new AuthError(`invalid token: ${e.message}`);
      throw new AuthError("invalid token");
    }
  }

  // HS256 (dev / demo / service)
  let claims: Claims;
  try {
    claims = jwt.verify(token, config.jwtSecret) as Claims;
  } catch {
    throw new AuthError("invalid token");
  }
  if (!claims.sub || !claims.tenant_id || !claims.role) throw new AuthError("incomplete claims");
  return { actorId: claims.sub, tenantId: claims.tenant_id, role: claims.role };
}
