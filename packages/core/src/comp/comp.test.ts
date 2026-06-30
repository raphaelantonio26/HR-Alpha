import { describe, it, expect } from "vitest";
import {
  convert,
  interpolateRank,
  placeAgainstBand,
  summarize,
  remediationCost,
  HRS_PER_YEAR,
} from "./payband.js";
import {
  totalPackage,
  fullyBurdenedRate,
  compareRegimes,
  prevailingWageFlag,
  placeApprentice,
  type FringeBreakdown,
} from "./construction.js";
import type { PayBand } from "@hr-os/contracts";

const band: PayBand = { unit: "annual", p10: 80000, p25: 90000, p50: 100000, p75: 110000, p90: 120000 };

describe("convert (hourly<->annual @2080)", () => {
  it("round-trips", () => {
    expect(convert(50, "hourly", "annual")).toBe(50 * HRS_PER_YEAR);
    expect(convert(104000, "annual", "hourly")).toBe(50);
    expect(convert(50, "hourly", "hourly")).toBe(50);
  });
  it("rejects non-finite", () => {
    expect(convert(Number.NaN, "hourly", "annual")).toBeNull();
    expect(convert(Number.POSITIVE_INFINITY, "annual", "hourly")).toBeNull();
    expect(convert(null, "hourly", "annual")).toBeNull();
  });
});

describe("interpolateRank (P10-P90 interpolation + clamping)", () => {
  it.each([
    [80000, 10],
    [90000, 25],
    [100000, 50],
    [110000, 75],
    [120000, 90],
    [95000, 38],
    [70000, 10], // clamps low
    [130000, 90], // clamps high
  ])("value %i -> ~p%i", (value, expected) => {
    expect(interpolateRank(value, band)).toBe(expected);
  });
  it("needs >=2 points", () => {
    expect(interpolateRank(100, { unit: "annual", p50: 100 })).toBeNull();
  });
});

describe("placeAgainstBand", () => {
  it("property: paid exactly at mid -> compa 1.00", () => {
    const p = placeAgainstBand(100000, "annual", band);
    expect(p.compaRatio).toBeCloseTo(1.0, 10);
    expect(p.zone).toBe("Upper Half"); // p >= mid
  });
  it("computes penetration, delta-to-mid, placement", () => {
    const p = placeAgainstBand(95000, "annual", band);
    expect(p.placement).toBe("In Band");
    expect(p.penetration).toBeCloseTo((95000 - 90000) / (110000 - 90000), 10);
    expect(p.deltaToMid).toBe(-5000);
    expect(p.zone).toBe("Lower Half");
  });
  it("Below Band sets toMinimum", () => {
    const p = placeAgainstBand(85000, "annual", band);
    expect(p.placement).toBe("Below Band");
    expect(p.zone).toBe("Below Min");
    expect(p.toMinimum).toBe(5000);
  });
  it("Above Band", () => {
    const p = placeAgainstBand(115000, "annual", band);
    expect(p.placement).toBe("Above Band");
    expect(p.zone).toBe("Above Max");
    expect(p.toMinimum).toBe(0);
  });
  it("converts hourly pay into an annual band", () => {
    const p = placeAgainstBand(50, "hourly", band); // 104000 annual
    expect(p.payInBandUnit).toBe(104000);
    expect(p.placement).toBe("In Band");
  });
  it("degenerate band (min==max) does not divide by zero", () => {
    const flat: PayBand = { unit: "annual", p25: 100000, p50: 100000, p75: 100000 };
    const p = placeAgainstBand(100000, "annual", flat);
    expect(p.hasBand).toBe(true);
    expect(p.penetration).toBeNull(); // max-min === 0
    expect(p.compaRatio).toBeCloseTo(1.0, 10);
  });
  it("missing band -> No Band, excluded", () => {
    const p = placeAgainstBand(100000, "annual", { unit: "annual" });
    expect(p.hasBand).toBe(false);
    expect(p.placement).toBe("No Band");
  });
  it("fuzz: absurd / NaN pay yields No Band, never throws", () => {
    expect(placeAgainstBand(Number.NaN, "annual", band).placement).toBe("No Band");
    expect(() => placeAgainstBand(-999999, "annual", band)).not.toThrow();
  });
});

describe("summarize reconciles with detail", () => {
  it("counts add up and below/above pct match", () => {
    const rows = [85000, 95000, 105000, 115000].map((pay) => ({ pay, placement: placeAgainstBand(pay, "annual", band) }));
    const s = summarize(rows);
    expect(s.count).toBe(4);
    expect(s.withBand).toBe(4);
    expect(s.belowBand + s.inBand + s.aboveBand).toBe(s.withBand);
    expect(s.belowBand).toBe(1);
    expect(s.aboveBand).toBe(1);
    expect(s.belowPct).toBe(25);
  });
});

describe("remediationCost", () => {
  it("sums shortfall-to-minimum, annualized", () => {
    const rows = [85000, 88000, 105000].map((pay) => ({ pay, placement: placeAgainstBand(pay, "annual", band) }));
    const r = remediationCost(rows);
    expect(r.employees).toBe(2);
    expect(r.total).toBe(5000 + 2000);
  });
});

describe("construction model", () => {
  const fringe: FringeBreakdown = { healthWelfare: 8, pension: 6, training: 1, vacation: 2 };

  it("total package = base + fringe + add-ons + premiums", () => {
    const r = totalPackage({ baseHourly: 45, fringe, addOns: { perDiem: 5 }, premiums: { supervision: 3 } });
    expect(r.fringe).toBe(17);
    expect(r.addOns).toBe(5);
    expect(r.premiums).toBe(3);
    expect(r.totalPackage).toBe(45 + 17 + 5 + 3);
  });

  it("fully-burdened rate applies burden to cash wages, adds fringe", () => {
    const burden = { payrollTaxRate: 0.0915, workersCompRate: 0.18, glRate: 0.02, overheadRate: 0.1 };
    const r = fullyBurdenedRate({ baseHourly: 45, fringe }, burden);
    // cash = 45, mult = 0.3915 -> 45*1.3915 + 17
    expect(r).toBeCloseTo(45 * 1.3915 + 17, 6);
  });

  it("prevailing-wage flag fires only on public works below floor", () => {
    expect(prevailingWageFlag(60, 65, true)).toEqual({ flagged: true, shortfall: 5 });
    expect(prevailingWageFlag(70, 65, true)).toEqual({ flagged: false, shortfall: 0 });
    expect(prevailingWageFlag(50, 65, false)).toEqual({ flagged: false, shortfall: 0 });
  });

  it("three-regime selection: public works -> higher of PW and CBA governs", () => {
    const rates = [
      { regime: "open_shop" as const, base: 45, fringe: 10, total: 55 },
      { regime: "prevailing_wage" as const, base: 50, fringe: 18, total: 68 },
      { regime: "cba" as const, base: 52, fringe: 20, total: 72 },
    ];
    const cmp = compareRegimes(60, rates, { publicWorks: true });
    expect(cmp.governing).toBe("cba");
    expect(cmp.gapToGoverning).toBe(60 - 72); // underpaid by 12
  });

  it("apprentice placement: % of journeyman by period, next step surfaced", () => {
    const steps = [
      { period: 1, pctOfJourneyman: 0.5, ojtHoursToNext: 1000 },
      { period: 2, pctOfJourneyman: 0.6, ojtHoursToNext: 1000 },
      { period: 3, pctOfJourneyman: 0.7 },
    ];
    const p = placeApprentice(50, steps, 2);
    expect(p.base).toBe(30);
    expect(p.nextPeriod).toBe(3);
    expect(p.ojtHoursToNext).toBe(1000);
  });
});
