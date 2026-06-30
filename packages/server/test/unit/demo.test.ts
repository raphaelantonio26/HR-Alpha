/**
 * Phase 4 DOD — the demo (Profile D) is safe by construction.
 *
 * Two security-critical proofs the prompt names explicitly:
 *  1. The demo minter cannot issue a token for any tenant other than the synthetic
 *     demo tenant, and refuses non-demo roles.
 *  2. Boot fails closed when DEMO_MODE is combined with a production marker, or
 *     when a live AI key is present in demo without the explicit, capped opt-in.
 */
import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { mintDemoToken } from "../../src/routes/demo.js";
import { DEMO_TENANT_ID, DEMO_ROLES } from "../../src/demo.js";
import { assertProfileSafety, type Config } from "../../src/config.js";

const sign = (payload: object) => jwt.sign(payload, "test-secret", { expiresIn: "1h" });

describe("demo session minter", () => {
  it("issues a token pinned to the demo tenant for an allowlisted role", () => {
    const res = mintDemoToken({ role: "hrbp" }, sign);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tenantId).toBe(DEMO_TENANT_ID);
    const decoded = jwt.verify(res.token, "test-secret") as Record<string, unknown>;
    expect(decoded.tenant_id).toBe(DEMO_TENANT_ID);
    expect(decoded.role).toBe("hrbp");
    expect(decoded.demo).toBe(true);
  });

  it("issues for every advertised demo role", () => {
    for (const role of DEMO_ROLES) {
      const res = mintDemoToken({ role }, sign);
      expect(res.ok, `role ${role} should mint`).toBe(true);
    }
  });

  it("REFUSES a request that names a non-demo tenant (403, never coerces)", () => {
    const res = mintDemoToken({ role: "administrator", tenantId: "99999999-0000-4000-8000-000000000000" }, sign);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(403);
    expect(res.error).toBe("demo_tenant_only");
  });

  it("still pins the demo tenant when the body echoes the demo tenant id", () => {
    const res = mintDemoToken({ role: "administrator", tenantId: DEMO_TENANT_ID }, sign);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tenantId).toBe(DEMO_TENANT_ID);
  });

  it("rejects a non-demo role (400)", () => {
    const res = mintDemoToken({ role: "employee" }, sign); // employee is NOT a demo role
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("rejects a missing/garbage role (400)", () => {
    expect(mintDemoToken({}, sign).ok).toBe(false);
    expect(mintDemoToken({ role: 42 }, sign).ok).toBe(false);
  });
});

/** Build a Config-shaped object with demo defaults, overridable per test. */
function demoConfig(over: Partial<Config["demo"]> & { oidcIssuer?: string; prodDataPlane?: boolean; scimEnabled?: boolean; apiKey?: string }): Config {
  return {
    env: "production",
    isProd: true,
    authMode: over.oidcIssuer ? "oidc" : "hs256",
    oidc: { issuer: over.oidcIssuer ?? "", audience: "", jwksUri: "", tenantClaim: "x", roleClaim: "roles" },
    scim: { enabled: over.scimEnabled ?? false, token: "", tenantId: "" },
    demo: {
      enabled: true,
      allowLiveAi: over.allowLiveAi ?? false,
      perIpPerMinute: 5,
      reseedHours: 0,
      readOnly: over.readOnly ?? false,
    },
    prodDataPlane: over.prodDataPlane ?? false,
    corsOrigins: ["https://demo.example"],
    anthropicApiKey: over.apiKey ?? "",
  } as unknown as Config;
}

describe("assertProfileSafety (fail-closed boot)", () => {
  it("passes for a clean demo profile", () => {
    expect(() => assertProfileSafety(demoConfig({}))).not.toThrow();
  });

  it("refuses demo + OIDC (a production auth plane)", () => {
    expect(() => assertProfileSafety(demoConfig({ oidcIssuer: "https://login.microsoftonline.com/x/v2.0" }))).toThrow(/production markers/);
  });

  it("refuses demo + PROD_DATA_PLANE", () => {
    expect(() => assertProfileSafety(demoConfig({ prodDataPlane: true }))).toThrow(/production markers/);
  });

  it("refuses demo + SCIM enabled", () => {
    expect(() => assertProfileSafety(demoConfig({ scimEnabled: true }))).toThrow(/production markers/);
  });

  it("refuses an unbounded key in demo (key set without DEMO_ALLOW_LIVE_AI)", () => {
    expect(() => assertProfileSafety(demoConfig({ apiKey: "sk-ant-xxx" }))).toThrow(/unbounded key/);
  });

  it("allows a key in demo ONLY with the explicit capped opt-in", () => {
    expect(() => assertProfileSafety(demoConfig({ apiKey: "sk-ant-xxx", allowLiveAi: true }))).not.toThrow();
  });
});
