/**
 * HR OS API server bootstrap (Fastify). Composes routes; the AI gateway is the
 * only path to a model. Run behind TLS; in Profile P, Microsoft Entra ID (OIDC)
 * issues the JWTs the routes verify, in Profile D the tenant-pinned demo minter
 * does. Boot is FAIL-CLOSED: assertProfileSafety() throws before we ever listen
 * if demo and production markers are mixed, or a prod secret/allowlist is missing.
 *
 * Production posture wired here (§4 Phase 1):
 *  - @fastify/helmet           security headers
 *  - @fastify/cors             explicit origin allowlist (NEVER origin:true)
 *  - @fastify/rate-limit       per-IP edge ceiling, Redis-backed when available
 *  - pino logger               redacted (no auth/cookie/PII), correlation ids
 *  - Application Insights       wired only when a connection string is present
 *  - graceful shutdown         SIGTERM drains /readyz, closes pool + redis
 */
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config, assertProfileSafety } from "./config.js";
import { loggerOptions, genReqId, startTelemetry } from "./observability.js";
import { getRedis, closeRedis } from "./redis.js";
import { close as closePool } from "./db.js";
import { healthRoutes, setDraining } from "./routes/health.js";
import { peopleRoutes } from "./routes/people.js";
import { leaveRoutes } from "./routes/leave.js";
import { compRoutes } from "./routes/comp.js";
import { authRoutes } from "./routes/auth.js";
import { aiRoutes } from "./routes/ai.js";
import { demoRoutes } from "./routes/demo.js";
import { scimRoutes } from "./routes/scim.js";

export async function build() {
  // Fail closed BEFORE anything binds. A misconfigured demo never starts next to real data.
  assertProfileSafety(config);

  const app = Fastify({
    logger: loggerOptions(),
    genReqId,
    trustProxy: true, // behind Azure Front Door / Container Apps ingress; req.ip = client
  });

  // Security headers. API serves JSON, so the default CSP is harmless and we keep it.
  await app.register(helmet, { contentSecurityPolicy: config.isProd });

  // CORS: explicit allowlist from config. In prod an empty list already refused boot.
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });

  // Edge rate limit (per IP). Redis store when configured so it is shared across
  // replicas; otherwise the plugin's in-process store. Health probes are exempt.
  const redis = getRedis();
  await app.register(rateLimit, {
    max: config.edgeRateLimit.max,
    timeWindow: config.edgeRateLimit.windowMs,
    ...(redis ? { redis } : {}),
    keyGenerator: (req) => req.ip,
    allowList: (req) => req.url === "/healthz" || req.url === "/readyz",
  });

  await app.register(healthRoutes);
  await app.register(peopleRoutes);
  await app.register(leaveRoutes);
  await app.register(compRoutes);
  await app.register(authRoutes);
  await app.register(aiRoutes);
  // Self-guarding: each is a no-op unless its profile flag is set.
  await app.register(demoRoutes);
  await app.register(scimRoutes);

  return app;
}

/** Install SIGTERM/SIGINT handlers that drain readiness, then close resources. */
function installShutdown(app: Awaited<ReturnType<typeof build>>): void {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutdown: draining");
    setDraining(true); // /readyz -> 503 so ingress stops sending new traffic
    // Hard cap: do not hang forever if a connection wedges.
    const guard = setTimeout(() => {
      app.log.error("shutdown: timed out, forcing exit");
      process.exit(1);
    }, 25_000);
    guard.unref();
    try {
      await app.close(); // stop accepting, finish in-flight
      await closePool(); // pg pool.end()
      await closeRedis();
      app.log.info("shutdown: clean");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown: error during close");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Only start when run directly.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  build()
    .then(async (app) => {
      const status = await startTelemetry(app.log);
      app.log.info({ telemetry: status, env: config.env, authMode: config.authMode, demo: config.demo.enabled }, "boot");
      installShutdown(app);
      await app.listen({ port: config.port, host: "0.0.0.0" });
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
