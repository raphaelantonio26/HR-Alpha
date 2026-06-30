/**
 * Observability (§4 invariant: never log PII). Two concerns:
 *  1. Logger configuration for Fastify/pino — request ids (honoring an inbound
 *     x-request-id), and REDACTION of auth/cookie headers so secrets and bearer
 *     tokens never reach the logs.
 *  2. Azure Application Insights / OpenTelemetry, wired ONLY when a connection
 *     string is present. It is loaded by dynamic import so the SDK is never a
 *     hard runtime dependency (it is an optionalDependency) and the dev/demo and
 *     sandbox paths carry zero overhead. If the string is set but the SDK is not
 *     installed, we log a structured warning and continue — honest degradation,
 *     never a crash.
 */
import { randomUUID } from "node:crypto";
import type { FastifyServerOptions } from "fastify";
import { config } from "./config.js";

/**
 * Fastify logger options. Redaction is the load-bearing part: the gateway already
 * forwards no PII to the model, and here we ensure the request log never captures
 * Authorization/Cookie/api-key headers either.
 */
export function loggerOptions(): FastifyServerOptions["logger"] {
  return {
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-api-key"]',
        'req.headers["x-scim-token"]',
        "headers.authorization",
        "headers.cookie",
      ],
      censor: "[redacted]",
    },
  };
}

/** Honor an inbound correlation id, else mint one. Used as Fastify's genReqId. */
export function genReqId(req: { headers: Record<string, unknown> }): string {
  const inbound = req.headers["x-request-id"];
  if (typeof inbound === "string" && inbound.length > 0 && inbound.length <= 200) return inbound;
  return randomUUID();
}

let appInsightsStarted = false;

/**
 * Start Application Insights if configured. Safe to call once at boot. Returns a
 * short status string for the boot log. Never throws.
 */
export async function startTelemetry(log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void }): Promise<string> {
  if (!config.appInsightsConnectionString) return "telemetry: disabled (no connection string)";
  if (appInsightsStarted) return "telemetry: already started";
  try {
    // Dynamic import keeps `applicationinsights` optional; absent in lean builds.
    const appInsights = (await import("applicationinsights")) as unknown as {
      setup: (cs: string) => { setAutoCollectConsole: (b: boolean, c?: boolean) => unknown; start: () => unknown };
      defaultClient?: { context?: { tags?: Record<string, string>; keys?: { cloudRole?: string } } };
    };
    const setup = appInsights.setup(config.appInsightsConnectionString);
    // Do NOT auto-collect console PII; we emit structured, redacted logs ourselves.
    setup.setAutoCollectConsole(false);
    setup.start();
    const c = appInsights.defaultClient;
    if (c?.context?.tags && c.context.keys?.cloudRole) c.context.tags[c.context.keys.cloudRole] = "hr-os-api";
    appInsightsStarted = true;
    log.info({ telemetry: "application-insights" }, "telemetry started");
    return "telemetry: application-insights started";
  } catch (err) {
    // The connection string was set but the SDK isn't installed (or failed). Be honest.
    log.warn(
      { telemetry: "unavailable", reason: err instanceof Error ? err.message : "unknown" },
      "APPLICATIONINSIGHTS_CONNECTION_STRING set but the SDK is not installed; continuing without telemetry",
    );
    return "telemetry: requested but SDK unavailable (continuing)";
  }
}
