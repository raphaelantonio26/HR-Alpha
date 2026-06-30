/**
 * Synthetic demo identity (§ Profile D). ONE fixed tenant id so the seed and the
 * demo-session minter agree, plus a deterministic actor per role. Every value is
 * `.example` — no PII, no real person (§2 invariant 3). Production uses SSO-issued
 * JWTs, never this.
 *
 * DEMO_ROLES is the allowlist the demo minter may issue. It deliberately excludes
 * `anonymous` (no access) and is the only set a visitor can choose from. The
 * minter NEVER reads a tenant from the request — it pins DEMO_TENANT_ID — so demo
 * mode cannot mint a token for any other tenant even if asked.
 */
import type { Role } from "@hr-os/contracts";

/** The synthetic demo tenant. All seeded rows belong to it. */
export const DEMO_TENANT_ID = "d3110000-0000-4000-8000-000000000001";
export const DEMO_TENANT_NAME = "Sample Tenant (.example)";

/** Roles a visitor may assume in the demo. Chosen to showcase RBAC + pay masking. */
export const DEMO_ROLES: readonly Role[] = ["administrator", "hrbp", "comp_analyst", "people_manager", "legal_compliance"] as const;

export function isDemoRole(role: string): role is Role {
  return (DEMO_ROLES as readonly string[]).includes(role);
}

/** A stable, fake actor id per role for the local demo. */
export function demoActorId(role: Role): string {
  return `demo.${role}@hros.example`;
}
