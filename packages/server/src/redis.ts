/**
 * Redis client (lazy, optional). Backs the edge rate-limiter and the AI gateway
 * token bucket in production. When REDIS_URL is unset (dev/sandbox) this returns
 * null and callers fall back to an in-memory limiter, so the local path runs with
 * no Redis. Connection failures never crash the process — they degrade.
 */
import Redis from "ioredis";
import { config } from "./config.js";

let client: Redis | null = null;
let attempted = false;

export function getRedis(): Redis | null {
  if (attempted) return client;
  attempted = true;
  if (!config.redisUrl) return null;
  client = new Redis(config.redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    // Bounded backoff; give up reconnecting after a few tries rather than spinning.
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
  });
  client.on("error", (err) => {
    // Logged once by the limiter the first time a command fails; avoid log spam here.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[redis] ${err.message}`);
    }
  });
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
    client = null;
  }
}
