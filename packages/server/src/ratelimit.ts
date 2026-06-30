/**
 * Fixed-window rate limiter. Redis-backed when available (shared across replicas,
 * which the in-memory map could not be), with a transparent in-memory fallback so
 * dev/sandbox runs without Redis. The pure `bucketTake` below is unit-tested; the
 * class wires it to either store.
 *
 * Fairness/availability tradeoff: if Redis is configured but a command fails, we
 * fall back to the in-memory bucket for that call (degraded but available) and do
 * not fail the user's request closed on a transient infra blip.
 */
import type Redis from "ioredis";
import { getRedis } from "./redis.js";

export interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Pure fixed-window decision. Mutates `map` for the given key. Returns true if the
 * call is allowed. Deterministic given `now` — this is the unit-tested core.
 */
export function bucketTake(map: Map<string, Bucket>, key: string, limit: number, windowMs: number, now: number): boolean {
  const b = map.get(key);
  if (!b || now > b.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

export class RateLimiter {
  private readonly mem = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly prefix: string;
  private warned = false;

  constructor(opts: { windowMs?: number; prefix?: string } = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.prefix = opts.prefix ?? "rl";
  }

  /** Returns true if the call for `key` is within `limit` for the current window. */
  async take(key: string, limit: number): Promise<boolean> {
    const redis: Redis | null = getRedis();
    if (redis && redis.status === "ready") {
      try {
        const k = `${this.prefix}:${key}`;
        const n = await redis.incr(k);
        if (n === 1) await redis.pexpire(k, this.windowMs);
        return n <= limit;
      } catch (err) {
        if (!this.warned) {
          this.warned = true;
          // eslint-disable-next-line no-console
          console.warn(`[ratelimit] redis unavailable, falling back to in-memory: ${err instanceof Error ? err.message : "error"}`);
        }
        // fall through to in-memory
      }
    }
    return bucketTake(this.mem, key, limit, this.windowMs, Date.now());
  }
}
