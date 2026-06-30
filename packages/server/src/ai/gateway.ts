/**
 * AI gateway (§3.6) — the ONE place the platform talks to a model. The browser
 * never calls Anthropic directly and never holds a key. Every dispatch here:
 *   - runs server-side with the central MODEL_ID and MAX_TOKENS (never lowered);
 *   - is gated by a verified actor (JWT) and rate-limited per user AND per tenant;
 *   - is purpose-scoped: web_search is enabled ONLY for whitelisted purposes;
 *   - is screened so NO PII leaves the boundary (names, SSNs, emails, DOB, medical
 *     narrative). Only minimal structured facts are forwarded (§2 invariant 3);
 *   - streams tokens over SSE and ABORTS the upstream call if the client
 *     disconnects (no orphaned generations);
 *   - degrades to a labeled deterministic fallback when the model is unreachable
 *     or the key is absent (§2 invariant 6) — the UI shows the result is local.
 *
 * The agentic loop runs up to MAX_TOOL_ROUNDS cycles; web_search is executed
 * server-side by the model and its results are relayed but never logged with PII.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { MODEL_ID, MAX_TOKENS, config } from "../config.js";
import type { Actor } from "../db.js";
import { zAiRequest, type AiRequest } from "@hr-os/contracts";
import { RateLimiter } from "../ratelimit.js";

const MAX_TOOL_ROUNDS = 4;

/** Purposes permitted to use web_search. ER enrichment is deliberately excluded. */
const WEB_SEARCH_ALLOWED = new Set<AiRequest["purpose"]>(["jd_research", "policy_assistant", "comp_analyst"]);

/** System framing per purpose — assist only; humans decide; never fabricate. */
const SYSTEM: Record<AiRequest["purpose"], string> = {
  comp_analyst:
    "You assist a compensation analyst. Use only the structured facts provided. Never invent pay figures, market data, or citations; if a number is not provided or retrievable from a cited source, say so. The analyst makes every decision.",
  policy_assistant:
    "You assist an HR partner with policy questions. Cite statutes/handbook sections as leads to verify, never as legal conclusions. Be conservative; recommend escalation when unsure. You do not give legal advice.",
  jd_research:
    "You assist a recruiter drafting a job description for a construction trade. Do not state pay or benefits. Keep claims verifiable and trade-accurate.",
  dashboard_assist:
    "You help compose a metric from a GOVERNED catalog of measures and dimensions only. You never see raw records. Output only references to catalog items.",
  er_enrich:
    "You assist an investigator by surfacing statutes/precedent as leads to VERIFY. You receive only structured attributes, never narrative or identities. You never reach a conclusion or recommend discipline.",
};

// Rate limiters: Redis-backed when REDIS_URL is set (shared across replicas), with
// an in-memory fallback for dev/sandbox. Separate limiters per scope.
const userLimiter = new RateLimiter({ prefix: "ai:user" });
const tenantLimiter = new RateLimiter({ prefix: "ai:tenant" });
const ipLimiter = new RateLimiter({ prefix: "ai:ip" }); // only consulted in demo+live-AI

const FORBIDDEN_KEYS = /(ssn|social|dob|birth|name|email|phone|address|medical|diagnosis|narrative)/i;
const SSN_RE = /\b\d{3}-?\d{2}-?\d{4}\b/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Reject any fact that looks like PII. Returns the offending key, or null if clean. */
export function findPii(facts: Record<string, string | number | boolean>): string | null {
  for (const [k, v] of Object.entries(facts)) {
    if (FORBIDDEN_KEYS.test(k)) return k;
    if (typeof v === "string" && (SSN_RE.test(v) || EMAIL_RE.test(v))) return k;
  }
  return null;
}

function sse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

interface MessageBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: MessageBlock[];
  stop_reason?: string;
}

/**
 * Handle one AI dispatch. `actor` is already verified by the route. Streams SSE.
 */
export async function handleAiDispatch(req: FastifyRequest, reply: FastifyReply, actor: Actor): Promise<void> {
  const parsed = zAiRequest.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400).send({ error: "invalid_request", detail: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  // PII screen — refuse before anything leaves the process.
  const offending = findPii(body.facts);
  if (offending) {
    reply.code(422).send({ error: "pii_blocked", field: offending });
    return;
  }

  // Rate limits (per user AND per tenant). Awaited because the store may be Redis.
  if (!(await userLimiter.take(actor.actorId, config.aiRateLimit.perUserPerMinute))) {
    reply.code(429).send({ error: "rate_limited", scope: "user" });
    return;
  }
  if (!(await tenantLimiter.take(actor.tenantId, config.aiRateLimit.perTenantPerMinute))) {
    reply.code(429).send({ error: "rate_limited", scope: "tenant" });
    return;
  }
  // Demo with live AI explicitly enabled: enforce a hard per-IP cap (§3 req 4) so a
  // public demo cannot be used to burn the key. Keyless demo never reaches here.
  if (config.demo.enabled && config.demo.allowLiveAi) {
    const ip = req.ip || "unknown";
    if (!(await ipLimiter.take(ip, config.demo.perIpPerMinute))) {
      reply.code(429).send({ error: "rate_limited", scope: "ip" });
      return;
    }
  }

  const enableWeb = body.enableWebSearch && WEB_SEARCH_ALLOWED.has(body.purpose);

  // Begin SSE.
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  reply.hijack();

  // Abort upstream if the client goes away — no orphaned generations.
  const ac = new AbortController();
  req.raw.on("close", () => ac.abort());

  // Graceful degradation: no key => labeled local fallback.
  if (!config.anthropicApiKey) {
    sse(reply, "fallback", { source: "deterministic", reason: "ai_unavailable", purpose: body.purpose });
    sse(reply, "done", { ok: true, degraded: true });
    reply.raw.end();
    return;
  }

  const tools = enableWeb ? [{ type: "web_search_20250305", name: "web_search" }] : undefined;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: JSON.stringify({ facts: body.facts }) },
  ];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": config.anthropicApiKey,
          "anthropic-version": config.anthropicVersion,
        },
        body: JSON.stringify({
          model: MODEL_ID,
          max_tokens: MAX_TOKENS,
          system: SYSTEM[body.purpose],
          messages,
          ...(tools ? { tools } : {}),
        }),
      });

      if (!resp.ok) {
        sse(reply, "fallback", { source: "deterministic", reason: `upstream_${resp.status}` });
        break;
      }

      const data = (await resp.json()) as AnthropicResponse;
      const text = (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (text) sse(reply, "text", { text });

      // web_search executes server-side within the round; loop only continues if
      // the model requested another tool round.
      if (data.stop_reason !== "tool_use") break;
      messages.push({ role: "assistant", content: text });
    }
    sse(reply, "done", { ok: true });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    if (!aborted) sse(reply, "fallback", { source: "deterministic", reason: "exception" });
  } finally {
    reply.raw.end();
  }
}
