/** Pay band — min=P25, mid=P50, max=P75; P10/P90 extend the ladder (§3.3). */
import type { PayUnit } from "./enums.js";

export interface PayBand {
  unit: PayUnit;
  p10?: number;
  p25?: number; // min
  p50?: number; // mid
  p75?: number; // max
  p90?: number;
  /** 0-100; sources are confidence-scored, never invented (§2 invariant 2). */
  confidence?: number;
  /** A band must be locked before it can reach payroll or a posting (governance). */
  locked?: boolean;
}

export interface BandPlacement {
  hasBand: boolean;
  unit: PayUnit;
  min: number | null;
  mid: number | null;
  max: number | null;
  compaRatio: number | null;
  percentileRank: number | null;
  penetration: number | null;
  placement: "In Band" | "Below Band" | "Above Band" | "No Band";
  zone: "Below Min" | "Above Max" | "Lower Half" | "Upper Half" | "—";
  deltaToMid: number | null;
  toMinimum: number | null;
  payInBandUnit?: number;
}
