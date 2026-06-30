/**
 * Phase 3 DOD — Entra ID (OIDC) token verification.
 *
 * We generate an RS256 keypair in-test and serve it through jose's LOCAL JWKS, so
 * the verifier runs its real path (issuer + audience + signature) with no network.
 * The cases the prompt requires: valid, expired, wrong issuer, wrong audience all
 * resolve correctly, and a verified Entra-shaped token produces an Actor that
 * drives the same read-path masking the rest of the platform uses.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from "jose";
import { makeOidcVerifier, OidcError, type OidcMapping } from "../../src/auth/oidc.js";
import { maskedFields } from "../../src/rbac.js";

const ISSUER = "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0";
const AUDIENCE = "api://hr-os";
const KID = "test-key-1";

const MAPPING: OidcMapping = {
  issuer: ISSUER,
  audience: AUDIENCE,
  tenantClaim: "extension_hrosTenantId",
  roleClaim: "roles",
};

let privateKey: CryptoKey;
let verify: ReturnType<typeof makeOidcVerifier>;

/** Mint an Entra v2-shaped token. Overrides let each test bend one dimension. */
async function mintToken(opts: {
  oid?: string | null;
  sub?: string;
  tenant?: string | null;
  roles?: string[] | null;
  issuer?: string;
  audience?: string;
  expSeconds?: number; // relative to now; negative = already expired
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.expSeconds ?? 3600);
  const payload: Record<string, unknown> = {};
  if (opts.oid !== null) payload.oid = opts.oid ?? "11111111-2222-3333-4444-555555555555";
  if (opts.sub !== undefined) payload.sub = opts.sub;
  if (opts.tenant !== null) payload[MAPPING.tenantClaim] = opts.tenant ?? "d3110000-0000-4000-8000-000000000001";
  if (opts.roles !== null) payload[MAPPING.roleClaim] = opts.roles ?? ["people_manager"];
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt(now)
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setExpirationTime(exp)
    .sign(privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  const pubJwk = (await exportJWK(kp.publicKey)) as JWK;
  pubJwk.kid = KID;
  pubJwk.alg = "RS256";
  pubJwk.use = "sig";
  const jwks = createLocalJWKSet({ keys: [pubJwk] });
  verify = makeOidcVerifier(jwks as unknown as Parameters<typeof makeOidcVerifier>[0], MAPPING);
});

describe("OIDC verifier (Entra ID)", () => {
  it("accepts a valid token and maps claims to an Actor", async () => {
    const token = await mintToken({ roles: ["comp_analyst"] });
    const actor = await verify(token);
    expect(actor.actorId).toBe("11111111-2222-3333-4444-555555555555");
    expect(actor.tenantId).toBe("d3110000-0000-4000-8000-000000000001");
    expect(actor.role).toBe("comp_analyst");
  });

  it("falls back to sub when oid is absent", async () => {
    const token = await mintToken({ oid: null, sub: "sub-only-id", roles: ["hrbp"] });
    const actor = await verify(token);
    expect(actor.actorId).toBe("sub-only-id");
  });

  it("rejects an expired token (401)", async () => {
    const token = await mintToken({ expSeconds: -60 });
    await expect(verify(token)).rejects.toBeInstanceOf(OidcError);
  });

  it("rejects a wrong issuer (401)", async () => {
    const token = await mintToken({ issuer: "https://evil.example/v2.0" });
    await expect(verify(token)).rejects.toBeInstanceOf(OidcError);
  });

  it("rejects a wrong audience (401)", async () => {
    const token = await mintToken({ audience: "api://not-hr-os" });
    await expect(verify(token)).rejects.toBeInstanceOf(OidcError);
  });

  it("rejects a token with no mapped HR OS role", async () => {
    const token = await mintToken({ roles: ["SomeAzureGroupName", "Reader"] });
    await expect(verify(token)).rejects.toThrow("no_mapped_role");
  });

  it("rejects a token missing the application tenant claim", async () => {
    const token = await mintToken({ tenant: null });
    await expect(verify(token)).rejects.toThrow("missing_tenant_claim");
  });

  it("a verified people_manager token drives pay masking (no leak of comp fields)", async () => {
    const token = await mintToken({ roles: ["people_manager"] });
    const actor = await verify(token);
    const masked = maskedFields(actor.role);
    expect(masked).toContain("amount");
    expect(masked).toContain("compaRatio");
    expect(masked).toContain("governmentId");
  });

  it("a verified administrator token masks nothing", async () => {
    const token = await mintToken({ roles: ["administrator"] });
    const actor = await verify(token);
    expect(maskedFields(actor.role)).toEqual([]);
  });
});
