/**
 * Compensation pay-band engine (pure, deterministic, no I/O).
 *
 * Given a pay value and a composite band (P10–P90), computes compa-ratio,
 * percentile rank (interpolated), band penetration, placement, and zone.
 * Working band is P25–P75 with P50 the midpoint — AMPAM's open-shop convention
 * anchors the floor at P25. Hourly<->annual at 2,080 hrs/yr.
 *
 * Ported from the AMPAM HR Studio / HR OS SPA payband engine and hardened
 * against adversarial numeric input (NaN/Infinity/negative) per §7 (fuzz).
 * No number is ever invented (§2 invariant 2).
 */
import type { BandPlacement, PayBand, PayUnit } from "@hr-os/contracts";

export const HRS_PER_YEAR = 2080;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Convert a value between pay units. Returns null for non-finite input. */
export function convert(v: number | null | undefined, from: PayUnit, to: PayUnit): number | null {
  if (!finite(v)) return null;
  if (from === to) return v;
  return from === "hourly" ? v * HRS_PER_YEAR : v / HRS_PER_YEAR;
}

interface LadderPoint {
  p: number;
  v: number;
}

function ladder(b: PayBand): LadderPoint[] {
  const pts: LadderPoint[] = [];
  if (finite(b.p10)) pts.push({ p: 10, v: b.p10 });
  if (finite(b.p25)) pts.push({ p: 25, v: b.p25 });
  if (finite(b.p50)) pts.push({ p: 50, v: b.p50 });
  if (finite(b.p75)) pts.push({ p: 75, v: b.p75 });
  if (finite(b.p90)) pts.push({ p: 90, v: b.p90 });
  return pts;
}

/** Interpolated percentile rank of a value within the ladder; clamps at the ends. */
export function interpolateRank(value: number, b: PayBand): number | null {
  if (!finite(value)) return null;
  const pts = ladder(b);
  if (pts.length < 2) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (value <= first.v) return first.p;
  if (value >= last.v) return last.p;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const c = pts[i + 1]!;
    if (value >= a.v && value <= c.v) {
      const t = c.v === a.v ? 0 : (value - a.v) / (c.v - a.v);
      return Math.round(a.p + t * (c.p - a.p));
    }
  }
  return 50;
}

const NO_BAND: BandPlacement = {
  hasBand: false,
  unit: "annual",
  min: null,
  mid: null,
  max: null,
  compaRatio: null,
  percentileRank: null,
  penetration: null,
  placement: "No Band",
  zone: "—",
  deltaToMid: null,
  toMinimum: null,
};

/** Place a pay value against a band; pay is converted into the band's unit. */
export function placeAgainstBand(
  pay: number,
  payUnit: PayUnit,
  band: PayBand,
): BandPlacement {
  const mid = band.p50;
  if (!finite(mid)) return { ...NO_BAND, unit: band.unit };
  const min = finite(band.p25) ? band.p25 : null;
  const max = finite(band.p75) ? band.p75 : null;
  const p = convert(pay, payUnit, band.unit);
  if (!finite(p)) return { ...NO_BAND, unit: band.unit };

  const compaRatio = mid > 0 ? p / mid : null;
  const percentileRank = interpolateRank(p, band);
  const penetration =
    min != null && max != null && max - min !== 0 ? (p - min) / (max - min) : null;

  let placement: BandPlacement["placement"] = "In Band";
  if (min != null && p < min) placement = "Below Band";
  else if (max != null && p > max) placement = "Above Band";

  let zone: BandPlacement["zone"] = "—";
  if (min != null && p < min) zone = "Below Min";
  else if (max != null && p > max) zone = "Above Max";
  else if (p < mid) zone = "Lower Half";
  else zone = "Upper Half";

  return {
    hasBand: true,
    unit: band.unit,
    min,
    mid,
    max,
    compaRatio,
    percentileRank,
    penetration,
    placement,
    zone,
    deltaToMid: p - mid,
    toMinimum: min != null && p < min ? min - p : 0,
    payInBandUnit: p,
  };
}

export interface PlacedRow {
  pay: number;
  placement: BandPlacement;
}

export interface RosterSummary {
  count: number;
  withBand: number;
  belowBand: number;
  inBand: number;
  aboveBand: number;
  avgCompa: number | null;
  medianPay: number | null;
  minPay: number | null;
  maxPay: number | null;
  belowPct: number | null;
  abovePct: number | null;
}

/** Roll a set of placements into a role/location summary. Counts reconcile with detail. */
export function summarize(rows: PlacedRow[]): RosterSummary {
  const count = rows.length;
  const wb = rows.filter((r) => r.placement.hasBand);
  const withBand = wb.length;
  const belowBand = wb.filter((r) => r.placement.placement === "Below Band").length;
  const aboveBand = wb.filter((r) => r.placement.placement === "Above Band").length;
  const inBand = withBand - belowBand - aboveBand;
  const compas = wb.map((r) => r.placement.compaRatio).filter(finite);
  const avgCompa = compas.length ? compas.reduce((a, b) => a + b, 0) / compas.length : null;
  const pays = rows.map((r) => r.pay).filter(finite).sort((a, b) => a - b);
  return {
    count,
    withBand,
    belowBand,
    inBand,
    aboveBand,
    avgCompa,
    medianPay: pays.length ? pays[Math.floor(pays.length / 2)]! : null,
    minPay: pays.length ? pays[0]! : null,
    maxPay: pays.length ? pays[pays.length - 1]! : null,
    belowPct: withBand ? Math.round((belowBand / withBand) * 100) : null,
    abovePct: withBand ? Math.round((aboveBand / withBand) * 100) : null,
  };
}

/** Cost to bring everyone below their band up to the band minimum (annualized). */
export function remediationCost(rows: PlacedRow[]): { total: number; employees: number } {
  let total = 0;
  let n = 0;
  for (const r of rows) {
    const pl = r.placement;
    if (pl.hasBand && pl.placement === "Below Band" && pl.toMinimum && pl.toMinimum > 0) {
      const annual = convert(pl.toMinimum, pl.unit, "annual");
      if (finite(annual)) {
        total += annual;
        n += 1;
      }
    }
  }
  return { total: Math.round(total), employees: n };
}

export const confidenceLabel = (c: number | null | undefined): string =>
  c == null ? "—" : c >= 80 ? "High" : c >= 60 ? "Moderate" : "Low";
