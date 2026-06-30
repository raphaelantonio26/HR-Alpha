import type { FastifyInstance } from "fastify";
import { ping } from "../db.js";

/**
 * Liveness vs readiness (Azure Container Apps probes both):
 *  - /healthz is liveness — the process is up. It stays 200 even while draining
 *    so the platform does not kill a pod that is finishing in-flight requests.
 *  - /readyz is readiness — safe to route new traffic. It flips to 503 the moment
 *    we begin draining on SIGTERM, so the ingress stops sending new requests while
 *    the server closes its connections, and 503s if the database is unreachable.
 */
let draining = false;

/** Flipped true by the shutdown handler in index.ts on SIGTERM/SIGINT. */
export function setDraining(v: boolean): void {
  draining = v;
}

export function isDraining(): boolean {
  return draining;
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_req, reply) => {
    if (draining) {
      reply.code(503);
      return { status: "draining" };
    }
    try {
      await ping();
      return { status: "ready" };
    } catch {
      reply.code(503);
      return { status: "degraded", db: "unreachable" };
    }
  });
}
