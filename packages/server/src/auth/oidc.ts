/**
 * Production SSO verification (§ Profile P). Verifies an RS256 JWT issued by
 * Microsoft Entra ID against the issuer's JWKS, checking issuer + audience, with
 * key caching/rotation handled by jose's remote key set. The verified claims map
 * to the same `Actor` shape the rest of the platform already uses, so withActor,
 * RLS, the audit trigger, and read-path masking are all unchanged downstream.
 *
 * Claim mapping (Entra v2):
 *  - actorId  <- `oid` (stable object id) falling back to `sub`
 *  - tenantId <- a configurable application-tenant claim (NOT the directory `tid`)
 *  - role     <- the first value in the app-roles claim that is a known HR OS role
 *
 * The verifier is built around an injectable key resolver so it is unit-testable
 * with a LOCAL key set (no network), while production uses the remote JWKS.
 */
import { jwtVerify, createRemoteJWKSet } from "jose";
import { config, oidcJwksUri } from "../config.js";
import { ROLES, type Role } from "@hr-os/contracts";

export class OidcError extends Error {}

type KeyInput = Parameters<typeof jwtVerify>[1];

export interface OidcMapping {
  issuer: string;
  audience: string;
  tenantClaim: string;
  roleClaim: string;
}

export interface ResolvedActor {
  actorId: string;
  tenantId: string;
  role: Role;
}

function mapRole(claim: unknown): Role {
  const values = Array.isArray(claim) ? claim : typeof claim === "string" ? [claim] : [];
  for (const v of values) {
    if ((ROLES as readonly string[]).includes(v)) return v as Role;
  }
  throw new OidcError("no_mapped_role");
}

/**
 * Build a verifier from a key resolver + mapping. Throws OidcError on any failure
 * (bad signature, expired, wrong issuer/audience, missing tenant, unmapped role).
 */
export function makeOidcVerifier(getKey: KeyInput, mapping: OidcMapping) {
  return async function verify(token: string): Promise<ResolvedActor> {
    let payload: Record<string, unknown>;
    try {
      const res = await jwtVerify(token, getKey, {
        issuer: mapping.issuer,
        audience: mapping.audience,
      });
      payload = res.payload as Record<string, unknown>;
    } catch (err) {
      throw new OidcError(err instanceof Error ? err.message : "verify_failed");
    }
    const actorId = (payload.oid as string) || (payload.sub as string);
    const tenantId = payload[mapping.tenantClaim] as string | undefined;
    if (!actorId) throw new OidcError("missing_subject");
    if (!tenantId) throw new OidcError("missing_tenant_claim");
    const role = mapRole(payload[mapping.roleClaim]);
    return { actorId, tenantId, role };
  };
}

let cached: ReturnType<typeof makeOidcVerifier> | null = null;

/** The production verifier, lazily built from config against Entra's remote JWKS. */
export function defaultOidcVerifier() {
  if (cached) return cached;
  const jwks = oidcJwksUri();
  if (!jwks || !config.oidc.issuer || !config.oidc.audience) {
    throw new OidcError("oidc_not_configured");
  }
  const getKey = createRemoteJWKSet(new URL(jwks)) as unknown as KeyInput;
  cached = makeOidcVerifier(getKey, {
    issuer: config.oidc.issuer,
    audience: config.oidc.audience,
    tenantClaim: config.oidc.tenantClaim,
    roleClaim: config.oidc.roleClaim,
  });
  return cached;
}
