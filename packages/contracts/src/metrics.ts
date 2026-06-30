/**
 * Governed semantic metrics layer (§3.9). Metrics are safe by construction:
 * a formula is a constrained DSL, never arbitrary code; queries are tenant- and
 * role-scoped and pre-aggregated; small-cell suppression prevents re-identification.
 */
export type Grain = "tenant" | "worksite" | "org_unit" | "position" | "manager";

export interface Dimension {
  key: string;
  label: string;
  /** Sensitive dimensions (EEO class) require extra suppression scrutiny. */
  sensitive?: boolean;
}

export interface Measure {
  key: string;
  label: string;
  /** A constrained aggregation, not free code. */
  agg: "count" | "sum" | "avg" | "ratio" | "distinct";
  /** Field(s) the agg reads from the pre-aggregated cube. */
  field: string;
  numeratorFilter?: string;
}

export interface MetricDefinition {
  id: string;
  version: number;
  label: string;
  measure: string;
  dimensions: string[];
  grain: Grain;
  filters?: Record<string, string | number | boolean>;
}

export interface MetricCell {
  dims: Record<string, string>;
  value: number | null;
  /** True when the underlying population is below the suppression threshold. */
  suppressed: boolean;
  n: number;
}
