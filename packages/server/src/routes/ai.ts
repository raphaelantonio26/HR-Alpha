import type { FastifyInstance } from "fastify";
import { actorFromRequest, AuthError } from "../auth/embedded.js";
import { handleAiDispatch } from "../ai/gateway.js";

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ai/dispatch", async (req, reply) => {
    let actor;
    try {
      actor = await actorFromRequest(req);
    } catch (e) {
      if (e instanceof AuthError) return reply.code(401).send({ error: e.message });
      throw e;
    }
    await handleAiDispatch(req, reply, actor);
  });
}
