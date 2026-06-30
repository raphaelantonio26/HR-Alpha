import { describe, it, expect } from "vitest";
import {
  eligibility,
  entitlementHours,
  usedInRollingWindow,
  resolveCase,
  ENTITLEMENT_WEEKS,
  FULL_TIME_HOURS,
} from "./engine.js";
import { rulePackFor, suggestedClocks } from "./california.js";
import type { LeaveCase } from "@hr-os/contracts";

const asOf = new Date("2026-06-29T00:00:00Z");

// hire ~13 months before asOf
const hire13mo = "2025-05-20";
const hire11mo = "2025-08-01";

describe("eligibility (12 months + 1,250 hours)", () => {
  it("eligible at/above both thresholds", () => {
    const e = eligibility({ hireDate: hire13mo, hoursWorked12mo: 1300 }, asOf);
    expect(e.eligible).toBe(true);
    expect(e.reasons).toEqual({ tenure: true, hours: true });
  });
  it("ineligible on tenure tipping just under 12 months", () => {
    const e = eligibility({ hireDate: hire11mo, hoursWorked12mo: 2000 }, asOf);
    expect(e.reasons.tenure).toBe(false);
    expect(e.eligible).toBe(false);
  });
  it("ineligible at exactly 1,249 hours, eligible at 1,250", () => {
    expect(eligibility({ hireDate: hire13mo, hoursWorked12mo: 1249 }, asOf).reasons.hours).toBe(false);
    expect(eligibility({ hireDate: hire13mo, hoursWorked12mo: 1250 }, asOf).reasons.hours).toBe(true);
  });
});

describe("entitlement hours with part-time proration", () => {
  it("full-time FMLA = 12 * 40 = 480", () => {
    expect(entitlementHours("FMLA", 40)).toBe(480);
    expect(entitlementHours("FMLA", undefined)).toBe(12 * FULL_TIME_HOURS);
  });
  it("part-time proration: 20 hrs/week -> 240", () => {
    expect(entitlementHours("FMLA", 20)).toBe(240);
  });
  it("PDL is computed in hours from schedule (17 1/3 weeks)", () => {
    expect(entitlementHours("PDL", 40)).toBe(Math.round(ENTITLEMENT_WEEKS.PDL * 40)); // 693
    expect(entitlementHours("PDL", 30)).toBe(Math.round(ENTITLEMENT_WEEKS.PDL * 30)); // 520
  });
  it("military caregiver = 26 weeks", () => {
    expect(entitlementHours("FMLA Military Caregiver", 40)).toBe(26 * 40);
  });
});

describe("FMLA rolling 12-month window measured backward", () => {
  const usage = [
    { date: "2025-03-01", hours: 200 }, // > 12 months before asOf -> aged out
    { date: "2025-08-01", hours: 120 }, // within window
    { date: "2026-02-01", hours: 80 }, // within window
  ];
  it("ages out usage older than 12 months", () => {
    expect(usedInRollingWindow(usage, asOf)).toBe(200); // 120 + 80
  });
  it("an older as-of date includes the earlier usage", () => {
    const earlier = new Date("2025-09-01T00:00:00Z");
    expect(usedInRollingWindow(usage, earlier)).toBe(320); // 200 + 120
  });
});

const baseCase = (over: Partial<LeaveCase>): LeaveCase => ({
  id: "Sample-LC-1",
  tenantId: "ampam",
  workerId: "Sample-W-1",
  reasonId: "serious_health",
  designation: null,
  startDate: "2026-05-01",
  endDate: null,
  intermittent: false,
  priority: "Medium",
  usage: [],
  clocks: [],
  jurisdiction: "US-CA",
  ...over,
});

describe("await-designation zero-state", () => {
  it("blank designation runs no clocks and charges zero hours", () => {
    const r = resolveCase(baseCase({ designation: null, usage: [{ date: "2026-05-02", hours: 40 }] }), 40, asOf);
    expect(r.awaitingDesignation).toBe(true);
    expect(r.state).toBe("await_designation");
    expect(r.clocks).toHaveLength(0);
  });
});

describe("concurrent clocks", () => {
  it("FMLA + CFRA charge the SAME usage concurrently", () => {
    const r = resolveCase(
      baseCase({ designation: ["FMLA", "CFRA"], usage: [{ date: "2026-06-01", hours: 160 }] }),
      40,
      asOf,
    );
    expect(r.awaitingDesignation).toBe(false);
    const fmla = r.clocks.find((k) => k.type === "FMLA")!;
    const cfra = r.clocks.find((k) => k.type === "CFRA")!;
    expect(fmla.usedHours).toBe(160);
    expect(cfra.usedHours).toBe(160);
    expect(fmla.entitlementHours).toBe(480);
    expect(fmla.remainingHours).toBe(320);
  });
  it("PDL is cumulative (not rolling) and never auto-includes CFRA", () => {
    const r = resolveCase(
      baseCase({
        reasonId: "pregnancy_disability",
        designation: ["FMLA", "PDL"],
        usage: [
          { date: "2024-01-01", hours: 100 }, // old, but PDL is cumulative
          { date: "2026-06-01", hours: 200 },
        ],
      }),
      40,
      asOf,
    );
    const pdl = r.clocks.find((k) => k.type === "PDL")!;
    const fmla = r.clocks.find((k) => k.type === "FMLA")!;
    expect(pdl.usedHours).toBe(300); // cumulative
    expect(fmla.usedHours).toBe(200); // rolling -> old 100 aged out
    expect(r.clocks.some((k) => k.type === "CFRA")).toBe(false);
  });
  it("exhaustion: used >= entitlement marks exhausted", () => {
    const r = resolveCase(baseCase({ designation: ["FMLA"], usage: [{ date: "2026-06-01", hours: 480 }] }), 40, asOf);
    expect(r.clocks[0]!.exhausted).toBe(true);
    expect(r.state).toBe("exhausted");
  });
});

describe("rule-pack selection by jurisdiction", () => {
  it("CA pack includes CFRA and PDL clocks for serious health", () => {
    expect(suggestedClocks("serious_health", "US-CA")).toEqual(["FMLA", "CFRA"]);
    expect(suggestedClocks("pregnancy_disability", "US-CA")).toEqual(["FMLA", "PDL"]);
  });
  it("federal pack strips state clocks (additive architecture)", () => {
    expect(suggestedClocks("serious_health", "US-FED")).toEqual(["FMLA"]);
    expect(rulePackFor("US-FED").jurisdiction).toBe("US-FED");
  });
  it("unknown jurisdiction falls back to federal", () => {
    expect(rulePackFor("US-NY").jurisdiction).toBe("US-FED");
  });
});
