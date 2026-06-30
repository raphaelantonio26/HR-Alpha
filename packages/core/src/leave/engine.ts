/**
 * Leave compliance engine — jurisdiction-AGNOSTIC core (pure, deterministic, no I/O).
 *
 * The statutory specifics live in versioned, dated rule packs (see california.ts);
 * the core knows only how to: test eligibility, convert entitlement weeks to hours
 * with part-time proration, compute the FMLA rolling-12-month-backward window
 * (29 CFR 825.200(b)(4)), and resolve the concurrent clocks a case charges.
 *
 * Invariants honored here:
 *  - await-designation: a blank designation runs NO clocks and charges ZERO hours
 *    until HR assigns one (§4 module 2).
 *  - concurrent clocks are stored/resolved per case — the audit answer to "which
 *    entitlements did this leave charge."
 *  - part-time proration is inherent: entitlement = weeks x scheduled hours; a blank
 *    schedule defaults to full-time 40.
 *  - PDL is computed in hours from the employee schedule and is per-event (cumulative),
 *    not a rolling window.
 *
 * Nothing here is legal advice. An incomplete record never recommends denial.
 */
import type { ClockType, LeaveCase, LeaveClock } from "@hr-os/contracts";

export const FULL_TIME_HOURS = 40;
export const ROLLING_MONTHS = 12;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30.4375;

/** Entitlement in workweeks by clock. PDL = 4 months / 17 1/3 workweeks. */
export const ENTITLEMENT_WEEKS: Record<ClockType, number> = {
  FMLA: 12,
  CFRA: 12,
  PDL: 17.333333,
  "FMLA Military Caregiver": 26,
};

/** PDL and military-caregiver are per-event/cumulative; FMLA/CFRA use the rolling window. */
const CUMULATIVE_CLOCKS: ReadonlySet<ClockType> = new Set<ClockType>([
  "PDL",
  "FMLA Military Caregiver",
]);

function toDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

export function tenureMonths(hireDate: string, asOf: Date = new Date()): number {
  const h = toDate(hireDate);
  if (!h) return 0;
  return Math.max(0, Math.round((asOf.getTime() - h.getTime()) / (MS_PER_DAY * DAYS_PER_MONTH)));
}

export function scheduledHoursPerWeek(hoursPerWeek?: number): number {
  return typeof hoursPerWeek === "number" && hoursPerWeek > 0 ? hoursPerWeek : FULL_TIME_HOURS;
}

export interface EligibilityInput {
  hireDate: string;
  hoursWorked12mo: number;
}

/**
 * FMLA/CFRA eligibility: 12 months tenure + 1,250 hours in the prior 12 months.
 * Worksite-size (50-in-75 for FMLA, 5+ for CFRA) is assumed met for AMPAM's
 * consolidated sites and is a rule-pack/tenant concern, not core math.
 */
export function eligibility(input: EligibilityInput, asOf: Date = new Date()) {
  const months = tenureMonths(input.hireDate, asOf);
  const hours = Number(input.hoursWorked12mo ?? 0);
  const tenureOk = months >= 12;
  const hoursOk = hours >= 1250;
  return {
    eligible: tenureOk && hoursOk,
    tenureMonths: months,
    hoursLast12mo: hours,
    reasons: { tenure: tenureOk, hours: hoursOk },
  };
}

/** Entitlement hours for a clock, prorated by the employee's scheduled week. */
export function entitlementHours(clock: ClockType, hoursPerWeek?: number): number {
  const weeks = ENTITLEMENT_WEEKS[clock];
  return Math.round(weeks * scheduledHoursPerWeek(hoursPerWeek));
}

/**
 * Hours used within the rolling 12-month window measured backward from `asOf`
 * (29 CFR 825.200(b)(4)). Usage older than 12 months has aged out and no longer
 * counts against the entitlement.
 */
export function usedInRollingWindow(
  usage: ReadonlyArray<{ date: string; hours: number }>,
  asOf: Date = new Date(),
  months: number = ROLLING_MONTHS,
): number {
  const windowStart = asOf.getTime() - months * DAYS_PER_MONTH * MS_PER_DAY;
  let total = 0;
  for (const u of usage) {
    const d = toDate(u.date);
    if (!d) continue;
    const t = d.getTime();
    if (t > windowStart && t <= asOf.getTime()) {
      const h = Number(u.hours);
      if (Number.isFinite(h) && h > 0) total += h;
    }
  }
  return total;
}

/** Cumulative hours (PDL / military caregiver — not a rolling window). */
export function usedCumulative(
  usage: ReadonlyArray<{ date: string; hours: number }>,
): number {
  let total = 0;
  for (const u of usage) {
    const h = Number(u.hours);
    if (Number.isFinite(h) && h > 0) total += h;
  }
  return total;
}

export interface ResolvedClock extends LeaveClock {
  remainingHours: number;
  exhausted: boolean;
}

export interface CaseResolution {
  /** True when designation is blank — no clocks run, zero hours charged. */
  awaitingDesignation: boolean;
  clocks: ResolvedClock[];
  /** "await_designation" | "active" | "exhausted" | "complete". */
  state: "await_designation" | "active" | "exhausted" | "complete";
}

/**
 * Resolve a case into its concurrent clocks. Designation is authoritative (HR
 * assigns it; the rule pack only suggests defaults per reason). Designated clocks
 * are charged concurrently from the SAME usage events; FMLA/CFRA use the rolling
 * window, PDL/military-caregiver are cumulative.
 */
export function resolveCase(c: LeaveCase, hoursPerWeek?: number, asOf: Date = new Date()): CaseResolution {
  const designation = c.designation;
  if (!designation || designation.length === 0) {
    return { awaitingDesignation: true, clocks: [], state: "await_designation" };
  }
  const clocks: ResolvedClock[] = designation.map((type) => {
    const entitlement = entitlementHours(type, hoursPerWeek);
    const used = CUMULATIVE_CLOCKS.has(type)
      ? usedCumulative(c.usage)
      : usedInRollingWindow(c.usage, asOf);
    const remaining = Math.max(0, entitlement - used);
    return {
      type,
      entitlementHours: entitlement,
      usedHours: used,
      remainingHours: remaining,
      exhausted: used >= entitlement,
    };
  });
  const anyRemaining = clocks.some((k) => !k.exhausted);
  const ended = toDate(c.endDate) != null && (toDate(c.endDate)!.getTime() <= asOf.getTime());
  const state: CaseResolution["state"] = ended
    ? "complete"
    : anyRemaining
      ? "active"
      : "exhausted";
  return { awaitingDesignation: false, clocks, state };
}

/** Case risk band (priority + usage ratio + duration + intermittent). Advisory only. */
export function computeRisk(c: Pick<LeaveCase, "priority" | "intermittent" | "startDate" | "endDate" | "clocks">): "Low" | "Moderate" | "High" {
  let score = c.priority === "High" ? 3 : c.priority === "Medium" ? 2 : 1;
  const totals = c.clocks.reduce(
    (acc, k) => ({ used: acc.used + k.usedHours, total: acc.total + k.entitlementHours }),
    { used: 0, total: 0 },
  );
  const u = totals.total > 0 ? totals.used / totals.total : 0;
  score += u > 0.8 ? 3 : u > 0.5 ? 2 : 1;
  const a = toDate(c.startDate);
  const b = toDate(c.endDate);
  const weeks = a && b ? Math.abs(b.getTime() - a.getTime()) / (MS_PER_DAY * 7) : 0;
  score += weeks > 10 ? 2 : weeks > 6 ? 1 : 0;
  if (c.intermittent) score += 1;
  return score >= 7 ? "High" : score >= 4 ? "Moderate" : "Low";
}

/** Projected exhaustion date for an active clock at the observed burn rate. */
export function exhaustionProjection(
  clock: ResolvedClock,
  startDate: string | null,
  asOf: Date = new Date(),
): { remaining: number; projectedDate: string; weeksLeft: number } | null {
  if (clock.exhausted || clock.remainingHours <= 0) return null;
  const start = toDate(startDate) ?? asOf;
  const elapsedWeeks = Math.max(1, (asOf.getTime() - start.getTime()) / (MS_PER_DAY * 7));
  const burnPerWeek = clock.usedHours > 0 ? clock.usedHours / elapsedWeeks : clock.entitlementHours / 12;
  if (burnPerWeek <= 0) return null;
  const weeksLeft = clock.remainingHours / burnPerWeek;
  const date = new Date(asOf.getTime() + weeksLeft * MS_PER_DAY * 7);
  return {
    remaining: clock.remainingHours,
    projectedDate: date.toISOString().slice(0, 10),
    weeksLeft: Math.round(weeksLeft),
  };
}
