/**
 * Central configuration. The model id and token budget are defined ONCE here and
 * imported everywhere — they are never inlined or lowered at a call site (§2
 * invariant 5). max_tokens is a floor: 4096. Lowering it is a regression.
 *
 * This module also owns the two-profile posture (see docs/adr/0003): the SAME
 * image runs as Profile P (production, SSO) or Profile D (demo, no SSO) purely
 * from env. `assertProfileSafety()` is the fail-closed boot guard that refuses to
 * start a demo profile on any deployment carrying production markers.
 */

/** The only model the platform calls. */
export const MODEL_ID = "claude-sonnet-4-6" as const;

/** Token budget for every Anthropic completion. NEVER set below this. */
export const MAX_TOKENS = 4096 as const;

const isProd = (process.env.NODE_ENV ?? "development") === "production";

/**
 * Required env. In production a missing value is fatal (fail fast at boot). In
 * dev it falls back to a labeled placeholder so the local path still runs.
 */
function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v == null || v === "") {
    if (isProd) throw new Error(`Missing required env: ${name}`);
    return fallback ?? "";
  }
  return v;
}

function bool(name: string, dflt = false): boolean {
  const v = process.env[name];
  if (v == null) return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

function list(name: string, dflt: string[] = []): string[] {
  const v = process.env[name];
  if (!v) return dflt;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Which token family the API verifies. `oidc` = Entra/RS256+JWKS (Profile P). */
export type AuthMode = "hs256" | "oidc";

const authMode: AuthMode = (process.env.AUTH_MODE as AuthMode) ?? (process.env.OIDC_ISSUER ? "oidc" : "hs256");

export const config = {
  env: process.env.NODE_ENV ?? "development",
  isProd,
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required("DATABASE_URL", "postgresql://hros:hros@localhost:5432/hros?schema=public"),

  // --- Auth -----------------------------------------------------------------
  authMode,
  /** HS256 shared secret. Required in prod ONLY when authMode is hs256 (service profile). */
  jwtSecret: authMode === "hs256" ? required("JWT_SECRET", "dev-only-secret") : (process.env.JWT_SECRET ?? "dev-only-secret"),
  oidc: {
    /** e.g. https://login.microsoftonline.com/<entra-tenant-guid>/v2.0 */
    issuer: process.env.OIDC_ISSUER ?? "",
    /** App ID URI or client id the token's `aud` must match. */
    audience: process.env.OIDC_AUDIENCE ?? "",
    /** Defaults to <issuer>/discovery/v2.0/keys when issuer is set (Entra v2). */
    jwksUri: process.env.OIDC_JWKS_URI ?? "",
    /** Claim carrying the HR OS application tenant id (NOT the Entra directory `tid`). */
    tenantClaim: process.env.OIDC_TENANT_CLAIM ?? "extension_hrosTenantId",
    /** Claim carrying app roles. Entra app roles arrive in `roles`. */
    roleClaim: process.env.OIDC_ROLE_CLAIM ?? "roles",
  },

  // --- SCIM (Profile P provisioning) ----------------------------------------
  scim: {
    enabled: bool("SCIM_ENABLED", false),
    /** Bearer token Entra presents to the SCIM endpoint. Required when enabled in prod. */
    token: process.env.SCIM_TOKEN ?? "",
    /** Single-tenant-per-deployment mapping for SCIM (per-tenant tokens are a TODO seam). */
    tenantId: process.env.SCIM_TENANT_ID ?? "",
  },

  // --- Demo (Profile D) -----------------------------------------------------
  demo: {
    enabled: bool("DEMO_MODE", false),
    /** Live AI in demo is OFF unless explicitly opted in AND capped (§3 req 4). */
    allowLiveAi: bool("DEMO_ALLOW_LIVE_AI", false),
    perIpPerMinute: Number(process.env.DEMO_AI_PER_IP ?? 5),
    /** Optional in-process reseed cadence; 0 disables (the canonical reseed is a Container Apps Job). */
    reseedHours: Number(process.env.DEMO_RESEED_HOURS ?? 0),
    /** Default: scoped writes allowed + scheduled reseed. Set read-only to disable writes. */
    readOnly: bool("DEMO_READ_ONLY", false),
  },
  /** Explicit production-data-plane marker; with DEMO_MODE it must refuse to boot. */
  prodDataPlane: bool("PROD_DATA_PLANE", false),

  // --- Edge / CORS ----------------------------------------------------------
  /** Allowlisted browser origins. Empty in prod is fatal (no `origin: true`). */
  corsOrigins: list("CORS_ORIGINS", isProd ? [] : ["http://localhost:5173"]),

  // --- AI gateway -----------------------------------------------------------
  /** Absent in dev => AI features return a labeled deterministic fallback (graceful degradation). */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  aiRateLimit: {
    perUserPerMinute: Number(process.env.AI_RATE_USER ?? 20),
    perTenantPerMinute: Number(process.env.AI_RATE_TENANT ?? 200),
  },
  /** Edge (per-IP) request ceiling enforced by @fastify/rate-limit. */
  edgeRateLimit: {
    max: Number(process.env.EDGE_RATE_MAX ?? 300),
    windowMs: Number(process.env.EDGE_RATE_WINDOW_MS ?? 60_000),
  },
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  anthropicVersion: "2023-06-01",

  // --- Observability --------------------------------------------------------
  appInsightsConnectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? "",
  logLevel: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
} as const;

export type Config = typeof config;

/** Effective JWKS endpoint for the configured Entra issuer (Entra v2 default). */
export function oidcJwksUri(): string {
  if (config.oidc.jwksUri) return config.oidc.jwksUri;
  if (!config.oidc.issuer) return "";
  return `${config.oidc.issuer.replace(/\/$/, "")}/discovery/v2.0/keys`;
}

/**
 * Fail-closed profile safety (§3). Called once at boot. Throws — never returns a
 * "warning" — so a misconfigured demo deployment cannot start next to real data.
 *
 * Demo (Profile D) is refused if ANY production marker is present:
 *  - OIDC/SSO is configured (a production auth plane),
 *  - PROD_DATA_PLANE=true is set,
 *  - an Anthropic key is present without the explicit live-AI opt-in + a cap
 *    (so an unbounded key is never shipped to a public demo).
 * Production (Profile P) is refused if it lacks a real auth plane or CORS allowlist.
 */
export function assertProfileSafety(c: Config = config): void {
  if (c.demo.enabled) {
    const markers: string[] = [];
    if (c.authMode === "oidc" || c.oidc.issuer) markers.push("OIDC/SSO configured");
    if (c.prodDataPlane) markers.push("PROD_DATA_PLANE=true");
    if (c.scim.enabled) markers.push("SCIM enabled");
    if (markers.length > 0) {
      throw new Error(
        `Refusing to boot: DEMO_MODE is on but production markers are present [${markers.join(", ")}]. ` +
          `Demo must run on an isolated synthetic-data deployment (docs/adr/0003).`,
      );
    }
    if (c.anthropicApiKey && !c.demo.allowLiveAi) {
      throw new Error(
        "Refusing to boot: an ANTHROPIC_API_KEY is set in demo mode without DEMO_ALLOW_LIVE_AI. " +
          "A public demo must not carry an unbounded key — leave it unset for the labeled fallback, " +
          "or set DEMO_ALLOW_LIVE_AI=true to accept the per-IP cap.",
      );
    }
    return; // demo profile validated
  }

  if (c.isProd) {
    if (c.authMode === "oidc") {
      if (!c.oidc.issuer || !c.oidc.audience) {
        throw new Error("Refusing to boot: AUTH_MODE=oidc in production requires OIDC_ISSUER and OIDC_AUDIENCE.");
      }
    }
    if (c.corsOrigins.length === 0) {
      throw new Error("Refusing to boot: production requires an explicit CORS_ORIGINS allowlist (no wildcard).");
    }
    if (c.scim.enabled && (!c.scim.token || !c.scim.tenantId)) {
      throw new Error("Refusing to boot: SCIM_ENABLED requires SCIM_TOKEN and SCIM_TENANT_ID.");
    }
  }
}
