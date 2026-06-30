/** @hr-os/core — pure, deterministic domain engines (no I/O). The correctness-
 *  critical heart of HR OS; components never inline this math, routes never bypass it. */
export * as leave from "./leave/index.js";
export * as comp from "./comp/index.js";
export * as er from "./er/index.js";
export * as jd from "./jd/index.js";
export * as org from "./org/analysis.js";
export * as metrics from "./metrics/index.js";
