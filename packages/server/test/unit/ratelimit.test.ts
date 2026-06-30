/**
 * The pure fixed-window decision behind both the edge and AI-gateway limiters.
 * Deterministic given `now`, so we can prove the window math without Redis/timers.
 */
import { describe, it, expect } from "vitest";
import { bucketTake, type Bucket } from "../../src/ratelimit.js";

describe("bucketTake", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const map = new Map<string, Bucket>();
    const t0 = 1_000_000;
    expect(bucketTake(map, "ip:1", 3, 60_000, t0)).toBe(true);
    expect(bucketTake(map, "ip:1", 3, 60_000, t0 + 1)).toBe(true);
    expect(bucketTake(map, "ip:1", 3, 60_000, t0 + 2)).toBe(true);
    expect(bucketTake(map, "ip:1", 3, 60_000, t0 + 3)).toBe(false); // 4th in-window
  });

  it("resets after the window elapses", () => {
    const map = new Map<string, Bucket>();
    const t0 = 1_000_000;
    expect(bucketTake(map, "ip:1", 1, 60_000, t0)).toBe(true);
    expect(bucketTake(map, "ip:1", 1, 60_000, t0 + 10)).toBe(false);
    expect(bucketTake(map, "ip:1", 1, 60_000, t0 + 60_001)).toBe(true); // new window
  });

  it("tracks keys independently", () => {
    const map = new Map<string, Bucket>();
    const t0 = 1_000_000;
    expect(bucketTake(map, "user:a", 1, 60_000, t0)).toBe(true);
    expect(bucketTake(map, "user:b", 1, 60_000, t0)).toBe(true);
    expect(bucketTake(map, "user:a", 1, 60_000, t0 + 1)).toBe(false);
  });
});
