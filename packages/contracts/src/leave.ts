/** Leave domain types — jurisdiction-agnostic core; each jurisdiction is a versioned pack. */
import type { Jurisdiction } from "./enums.js";

export type ClockType = "FMLA" | "CFRA" | "PDL" | "FMLA Military Caregiver";

export interface LeaveReason {
  id: string;
  label: string;
  clocks: ClockType[];
}

/** Concurrent clocks stored on every case — the audit answer to "which entitlements did this charge." */
export interface LeaveClock {
  type: ClockType;
  entitlementHours: number;
  usedHours: number;
}

export interface LeaveCase {
  id: string;
  tenantId: string;
  workerId: string;
  reasonId: string;
  /** Blank designation => await-designation: no clocks run, zero hours charged until HR assigns. */
  designation: ClockType[] | null;
  startDate: string | null;
  endDate: string | null;
  intermittent: boolean;
  priority: "Low" | "Medium" | "High";
  /** Usage events for rolling-window math (date + hours). */
  usage: Array<{ date: string; hours: number }>;
  clocks: LeaveClock[];
  jurisdiction: Jurisdiction;
}

export interface EligibilityResult {
  eligible: boolean;
  tenureMonths: number;
  hoursLast12mo: number;
  applicable: ClockType[];
  reasons: { tenure: boolean; hours: boolean };
}
