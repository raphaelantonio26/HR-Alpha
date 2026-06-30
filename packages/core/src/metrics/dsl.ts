/**
 * Semantic metrics layer — foundation (§3.9, §4 module 13). Safe by construction
 * (§2 invariant 11):
 *  - A metric formula is a CONSTRAINED DSL, never arbitrary executable code.
 *  - Queries are tenant- and role-scoped and run over PRE-AGGREGATED rows.
 *  - Small-cell suppression prevents any metric/filter combination from
 *    re-identifying an individual.
 *
 * The AI dashboard builder reads only governed definitions + aggregates — it can
 * never reach raw PII. This module provides the definition catalog, a safe DSL
 * evaluator for composing measures, and the suppression gate.
 */
import type { Dimension, Measure, MetricCell, MetricDefinition } from "@hr-os/contracts";

/** Minimum population below which a cell is suppressed (configurable per tenant). */
export const DEFAULT_SUPPRESSION_THRESHOLD = 5;

export const DIMENSIONS: Dimension[] = [
  { key: "tenant", label: "Tenant" },
  { key: "worksite", label: "Office / Worksite" },
  { key: "region", label: "Region" },
  { key: "craft", label: "Craft / Trade" },
  { key: "department", label: "Department" },
  { key: "manager", label: "Manager / Foreman" },
  { key: "project", label: "Project" },
  { key: "employment_type", label: "Union / Open-Shop" },
  { key: "flsa", label: "Exempt / Non-Exempt" },
  { key: "tenure_band", label: "Tenure Band" },
  { key: "eeo_class", label: "EEO Class", sensitive: true },
  { key: "status", label: "Status" },
];

export const MEASURES: Measure[] = [
  { key: "headcount", label: "Headcount", agg: "count", field: "worker_id" },
  { key: "fte", label: "FTE", agg: "sum", field: "fte" },
  { key: "attrition", label: "Attrition", agg: "ratio", field: "is_active", numeratorFilter: "terminated_in_period" },
  { key: "comp_ratio", label: "Comp-Ratio", agg: "avg", field: "compa_ratio" },
  { key: "range_penetration", label: "Range Penetration", agg: "avg", field: "penetration" },
  { key: "pct_below_market", label: "% Below Market", agg: "ratio", field: "worker_id", numeratorFilter: "below_band" },
  { key: "pct_below_prevailing", label: "% Below Prevailing Wage", agg: "ratio", field: "worker_id", numeratorFilter: "below_prevailing" },
  { key: "burdened_cost", label: "Fully-Burdened Labor Cost", agg: "sum", field: "burdened_cost" },
  { key: "ot_pct", label: "OT %", agg: "ratio", field: "reg_hours", numeratorFilter: "ot_hours" },
  { key: "er_case_rate", label: "ER Case Rate", agg: "ratio", field: "worker_id", numeratorFilter: "open_case" },
  { key: "leave_incidence", label: "Leave Incidence", agg: "ratio", field: "worker_id", numeratorFilter: "on_leave" },
  { key: "sla_attainment", label: "SLA Attainment", agg: "ratio", field: "sla_total", numeratorFilter: "sla_met" },
];

const MEASURE_BY_KEY = new Map(MEASURES.map((m) => [m.key, m]));
const DIM_BY_KEY = new Map(DIMENSIONS.map((d) => [d.key, d]));

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a metric definition against the governed catalog. Rejects unknowns. */
export function validateDefinition(def: MetricDefinition): ValidationResult {
  const errors: string[] = [];
  if (!MEASURE_BY_KEY.has(def.measure)) errors.push(`unknown measure: ${def.measure}`);
  for (const d of def.dimensions) if (!DIM_BY_KEY.has(d)) errors.push(`unknown dimension: ${d}`);
  if (def.version < 1) errors.push("version must be >= 1");
  return { valid: errors.length === 0, errors };
}

/**
 * A constrained composition DSL: an expression is a tree of measure references
 * and the four arithmetic operators with numeric literals. There is NO function
 * call, NO property access, NO identifier outside the measure catalog — so it
 * cannot reach raw rows or execute arbitrary code.
 */
export type DslExpr =
  | { kind: "measure"; key: string }
  | { kind: "lit"; value: number }
  | { kind: "op"; op: "+" | "-" | "*" | "/"; left: DslExpr; right: DslExpr };

export function validateExpr(expr: DslExpr): ValidationResult {
  const errors: string[] = [];
  const walk = (e: DslExpr): void => {
    if (e.kind === "measure") {
      if (!MEASURE_BY_KEY.has(e.key)) errors.push(`unknown measure in formula: ${e.key}`);
    } else if (e.kind === "lit") {
      if (!Number.isFinite(e.value)) errors.push("non-finite literal");
    } else if (e.kind === "op") {
      walk(e.left);
      walk(e.right);
    } else {
      errors.push("unsupported expression node");
    }
  };
  walk(expr);
  return { valid: errors.length === 0, errors };
}

/** Evaluate a DSL expression against a map of already-aggregated measure values. */
export function evalExpr(expr: DslExpr, values: Record<string, number>): number {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "measure": {
      const v = values[expr.key];
      return Number.isFinite(v) ? (v as number) : 0;
    }
    case "op": {
      const l = evalExpr(expr.left, values);
      const r = evalExpr(expr.right, values);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? 0 : l / r;
      }
    }
  }
}

/**
 * Apply small-cell suppression to a set of cells. Any cell whose underlying
 * population n is below the threshold is suppressed (value nulled). Sensitive
 * dimensions can raise the effective threshold.
 */
export function suppress(
  cells: Array<{ dims: Record<string, string>; value: number | null; n: number }>,
  opts: { threshold?: number; sensitiveDims?: string[] } = {},
): MetricCell[] {
  const base = opts.threshold ?? DEFAULT_SUPPRESSION_THRESHOLD;
  const sensitive = new Set(opts.sensitiveDims ?? DIMENSIONS.filter((d) => d.sensitive).map((d) => d.key));
  return cells.map((c) => {
    const usesSensitive = Object.keys(c.dims).some((k) => sensitive.has(k));
    const threshold = usesSensitive ? Math.max(base, 10) : base;
    const suppressed = c.n < threshold;
    return { dims: c.dims, value: suppressed ? null : c.value, suppressed, n: c.n };
  });
}
