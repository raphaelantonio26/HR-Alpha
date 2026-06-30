import { describe, it, expect } from "vitest";
import {
  validateDefinition,
  validateExpr,
  evalExpr,
  suppress,
  DEFAULT_SUPPRESSION_THRESHOLD,
  type DslExpr,
} from "./dsl.js";
import type { MetricDefinition } from "@hr-os/contracts";

describe("validateDefinition rejects unknowns", () => {
  it("accepts a governed definition", () => {
    const def: MetricDefinition = { id: "m1", version: 1, label: "HC by office", measure: "headcount", dimensions: ["worksite"], grain: "worksite" };
    expect(validateDefinition(def).valid).toBe(true);
  });
  it("rejects unknown measure and dimension", () => {
    const def: MetricDefinition = { id: "m2", version: 1, label: "bad", measure: "salaries_raw", dimensions: ["ssn"], grain: "tenant" };
    const r = validateDefinition(def);
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining("unknown measure"), expect.stringContaining("unknown dimension")]));
  });
});

describe("constrained DSL is safe by construction", () => {
  it("only measure/lit/op nodes validate", () => {
    const ok: DslExpr = { kind: "op", op: "/", left: { kind: "measure", key: "ot_hours" as never }, right: { kind: "measure", key: "headcount" } };
    // ot_hours is not a measure key -> rejected
    expect(validateExpr(ok).valid).toBe(false);
    const good: DslExpr = { kind: "op", op: "-", left: { kind: "lit", value: 1 }, right: { kind: "measure", key: "comp_ratio" } };
    expect(validateExpr(good).valid).toBe(true);
  });
  it("evaluates arithmetic against pre-aggregated values; divide-by-zero -> 0", () => {
    const expr: DslExpr = { kind: "op", op: "/", left: { kind: "measure", key: "headcount" }, right: { kind: "measure", key: "fte" } };
    expect(evalExpr(expr, { headcount: 100, fte: 80 })).toBeCloseTo(1.25, 10);
    expect(evalExpr(expr, { headcount: 100, fte: 0 })).toBe(0);
  });
});

describe("small-cell suppression prevents re-identification", () => {
  it("suppresses cells below the default threshold", () => {
    const cells = [
      { dims: { worksite: "Fremont" }, value: 3, n: 3 },
      { dims: { worksite: "Carson HQ" }, value: 120, n: 120 },
    ];
    const out = suppress(cells);
    const fremont = out.find((c) => c.dims.worksite === "Fremont")!;
    const carson = out.find((c) => c.dims.worksite === "Carson HQ")!;
    expect(DEFAULT_SUPPRESSION_THRESHOLD).toBe(5);
    expect(fremont.suppressed).toBe(true);
    expect(fremont.value).toBeNull();
    expect(carson.suppressed).toBe(false);
    expect(carson.value).toBe(120);
  });
  it("raises threshold for sensitive dimensions (EEO class)", () => {
    const cells = [{ dims: { eeo_class: "X" }, value: 8, n: 8 }];
    const out = suppress(cells);
    expect(out[0]!.suppressed).toBe(true); // 8 < 10 sensitive threshold
  });
});
