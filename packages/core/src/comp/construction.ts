/**
 * Construction-native compensation model (pure, deterministic) — the wedge that
 * beats Pave/Compa on craft (§4 module 5). Hourly-first: craft is the primary
 * path; office/salaried ride the conventional OEWS path in payband.ts.
 *
 * Implemented here (Stage 1 deterministic math):
 *  - Total package: base + fringe + add-ons + premiums.
 *  - Fully-burdened labor rate: + payroll taxes, trade-rated workers' comp, GL, overhead.
 *  - Three wage regimes compared per classification: open-shop, prevailing wage, CBA scale.
 *  - Apprentice progression: % of journeyman by period.
 *  - Compliance bridge: flag a field worker below applicable prevailing wage on public works.
 *
 * No number is invented. Prevailing-wage / CBA / OEWS source FUSION and confidence
 * scoring is wired to live sources by Stage 2.
 * TODO(fable5): blend BLS OEWS + DIR/Davis-Bacon + CBA scales + ENR + ADP actuals
 *   behind a source-resolver, each confidence-scored, ECI-escalated, county-adjusted.
 */

export interface FringeBreakdown {
  healthWelfare: number;
  pension: number;
  training: number;
  vacation: number;
}

export interface AddOns {
  perDiem?: number;
  travelZone?: number;
  shiftDifferential?: number;
  showUp?: number;
  hazard?: number;
}

export interface Premiums {
  /** Foreman / general-foreman hourly step-up. */
  supervision?: number;
  /** License/cert premiums: journeyman license, NICET, EPA 608, OSHA 30, backflow, welding. */
  certifications?: number;
}

export interface BurdenRates {
  /** Combined employer payroll tax rate (FICA + FUTA/SUTA), e.g. 0.0915. */
  payrollTaxRate: number;
  /** Trade-rated workers' comp rate per $1 of payroll, e.g. 0.18 for high-risk craft. */
  workersCompRate: number;
  /** General liability rate. */
  glRate: number;
  /** Overhead allocation rate. */
  overheadRate: number;
}

const sum = (...xs: Array<number | undefined>) =>
  xs.reduce<number>((a, x) => a + (Number.isFinite(x as number) ? (x as number) : 0), 0);

export function fringeTotal(f: FringeBreakdown): number {
  return sum(f.healthWelfare, f.pension, f.training, f.vacation);
}

export interface PackageInput {
  baseHourly: number;
  fringe: FringeBreakdown;
  addOns?: AddOns;
  premiums?: Premiums;
}

export interface PackageResult {
  base: number;
  fringe: number;
  addOns: number;
  premiums: number;
  /** Cash + fringe + add-ons + premiums — the worker-facing total package rate. */
  totalPackage: number;
}

/** Total package hourly rate. */
export function totalPackage(input: PackageInput): PackageResult {
  const base = input.baseHourly;
  const fringe = fringeTotal(input.fringe);
  const a = input.addOns ?? {};
  const p = input.premiums ?? {};
  const addOns = sum(a.perDiem, a.travelZone, a.shiftDifferential, a.showUp, a.hazard);
  const premiums = sum(p.supervision, p.certifications);
  return { base, fringe, addOns, premiums, totalPackage: base + fringe + addOns + premiums };
}

/**
 * Fully-burdened labor rate: a first-class output. Burden applies to cash wages
 * (base + cash add-ons + premiums); bona-fide fringe contributions are added but
 * are not themselves taxed/comped here (conservative, configurable per tenant).
 */
export function fullyBurdenedRate(input: PackageInput, burden: BurdenRates): number {
  const pkg = totalPackage(input);
  const cashWages = pkg.base + pkg.addOns + pkg.premiums;
  const burdenMultiplier =
    burden.payrollTaxRate + burden.workersCompRate + burden.glRate + burden.overheadRate;
  return cashWages * (1 + burdenMultiplier) + pkg.fringe;
}

export type WageRegime = "open_shop" | "prevailing_wage" | "cba";

export interface RegimeRate {
  regime: WageRegime;
  base: number;
  fringe: number;
  /** base + fringe. */
  total: number;
}

export interface RegimeComparison {
  rates: RegimeRate[];
  /** The regime that must be paid on the assignment (max of applicable floors). */
  governing: WageRegime;
  /** Gap from the worker's actual total package to the governing floor (negative => underpaid). */
  gapToGoverning: number;
}

/**
 * Compare the three wage regimes for a classification and determine the governing
 * floor for a given assignment. On public works, the higher of PW and CBA governs.
 */
export function compareRegimes(
  actualTotalPackage: number,
  regimes: RegimeRate[],
  context: { publicWorks: boolean },
): RegimeComparison {
  const applicable = context.publicWorks
    ? regimes.filter((r) => r.regime !== "open_shop")
    : regimes;
  const pool = applicable.length ? applicable : regimes;
  const governingRate = pool.reduce((hi, r) => (r.total > hi.total ? r : hi), pool[0]!);
  return {
    rates: regimes,
    governing: governingRate.regime,
    gapToGoverning: actualTotalPackage - governingRate.total,
  };
}

/** Flag a field worker below the applicable prevailing wage on a public-works assignment. */
export function prevailingWageFlag(
  actualTotalPackage: number,
  prevailingTotal: number,
  publicWorks: boolean,
): { flagged: boolean; shortfall: number } {
  if (!publicWorks) return { flagged: false, shortfall: 0 };
  const shortfall = prevailingTotal - actualTotalPackage;
  return { flagged: shortfall > 0.005, shortfall: shortfall > 0 ? shortfall : 0 };
}

export interface ApprenticeStep {
  period: number;
  /** Percent of journeyman base for this period, e.g. 0.55 for period 1. */
  pctOfJourneyman: number;
  /** OJT hours threshold to reach the next step. */
  ojtHoursToNext?: number;
}

export interface ApprenticePlacement {
  period: number;
  pct: number;
  base: number;
  nextPeriod: number | null;
  ojtHoursToNext: number | null;
}

/** Place an apprentice on the step table and compute their base off journeyman. */
export function placeApprentice(
  journeymanBase: number,
  steps: ApprenticeStep[],
  currentPeriod: number,
): ApprenticePlacement {
  const sorted = [...steps].sort((a, b) => a.period - b.period);
  const idx = sorted.findIndex((s) => s.period === currentPeriod);
  const step = idx >= 0 ? sorted[idx]! : sorted[sorted.length - 1]!;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1]! : null;
  return {
    period: step.period,
    pct: step.pctOfJourneyman,
    base: Math.round(journeymanBase * step.pctOfJourneyman * 100) / 100,
    nextPeriod: next ? next.period : null,
    ojtHoursToNext: step.ojtHoursToNext ?? null,
  };
}
