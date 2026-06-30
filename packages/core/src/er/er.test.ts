import { describe, it, expect } from "vitest";
import { runEngine, statutoryRisk, retaliationWindow, recommendation } from "./engine.js";
import { detectPatterns, type PatternCase } from "./patterns.js";
import type { ErCase } from "@hr-os/contracts";

const mk = (over: Partial<ErCase>): ErCase => ({
  id: "Sample-ER-1",
  tenantId: "ampam",
  caseType: "er",
  incidentType: "Policy Violation",
  severity: "Major",
  status: "intake",
  subjectIsSupervisor: false,
  ...over,
});

describe("retaliation window (temporal proximity)", () => {
  it("flags adverse action within 90 days of protected activity", () => {
    const r = retaliationWindow(mk({ protectedActivityDate: "2026-01-01", adverseActionDate: "2026-02-15" }));
    expect(r.flagged).toBe(true);
    expect(r.days).toBe(45);
  });
  it("does not flag beyond 90 days", () => {
    const r = retaliationWindow(mk({ protectedActivityDate: "2026-01-01", adverseActionDate: "2026-06-01" }));
    expect(r.flagged).toBe(false);
  });
  it("ignores negative (adverse before protected)", () => {
    const r = retaliationWindow(mk({ protectedActivityDate: "2026-03-01", adverseActionDate: "2026-01-01" }));
    expect(r.flagged).toBe(false);
    expect(r.days).toBeNull();
  });
});

describe("statutory risk scoring is deterministic and bounded", () => {
  it("same input -> identical score across runs", () => {
    const c = mk({ incidentType: "Harassment", severity: "Severe", subjectIsSupervisor: true });
    const a = statutoryRisk(c);
    const b = statutoryRisk(c);
    expect(a.score).toBe(b.score);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });
  it("supervisor harassment scores higher than peer attendance", () => {
    const hi = statutoryRisk(mk({ incidentType: "Harassment", severity: "Severe", subjectIsSupervisor: true })).score;
    const lo = statutoryRisk(mk({ incidentType: "Attendance", severity: "Minor" })).score;
    expect(hi).toBeGreaterThan(lo);
  });
  it("active leave overlap adds exposure", () => {
    const base = statutoryRisk(mk({ incidentType: "Attendance", severity: "Minor" })).score;
    const loa = statutoryRisk(mk({ incidentType: "Attendance", severity: "Minor", activeLoa: true })).score;
    expect(loa).toBeGreaterThan(base);
  });
});

describe("recommendation is conservative", () => {
  it("threats/violence -> immediate safety regardless of score", () => {
    expect(recommendation(mk({ incidentType: "Threats", severity: "Minor" }), statutoryRisk(mk({ incidentType: "Threats" }))).id).toBe("immediate_safety");
  });
  it("incomplete low-signal record -> monitor or counsel, never discipline", () => {
    const c = mk({ incidentType: "Insubordination", severity: "Major" });
    const rec = recommendation(c, statutoryRisk(c));
    expect(["monitor_close", "documented_counseling", "prompt_corrective"]).toContain(rec.id);
    expect(rec.id).not.toBe("full_investigation");
  });
  it("high risk -> full investigation before any decision", () => {
    const c = mk({ incidentType: "Harassment", severity: "Severe", subjectIsSupervisor: true, activeLoa: true });
    const rec = recommendation(c, statutoryRisk(c));
    expect(rec.id).toBe("full_investigation");
  });
});

describe("runEngine output shape", () => {
  it("records modelPath and produces ordered next steps", () => {
    const out = runEngine(mk({ incidentType: "Harassment", severity: "Severe", subjectIsSupervisor: true, activeLoa: true, status: "intake" }));
    expect(out.modelPath).toBe("deterministic");
    expect(out.nextSteps.length).toBeGreaterThan(0);
    // sorted by priority desc
    const ps = out.nextSteps.map((s) => s.priority);
    expect([...ps].sort((a, b) => b - a)).toEqual(ps);
    expect(out.statutoryRisk.band).toBe("HIGH");
  });
});

describe("cross-case pattern detection (attributes only)", () => {
  const cases: PatternCase[] = [
    { ...mk({ id: "C1", subjectIsSupervisor: true }), subjectKey: "S-100", openedDate: "2026-01-10", department: "HVAC" },
    { ...mk({ id: "C2" }), subjectKey: "S-100", openedDate: "2026-03-10", department: "HVAC" },
    { ...mk({ id: "C3" }), subjectKey: "S-200", openedDate: "2026-02-01", correctiveActionDate: "2026-01-20", department: "HVAC" },
    { ...mk({ id: "C4" }), subjectKey: "S-300", openedDate: "2026-02-15", department: "HVAC" },
  ];
  it("flags repeat subject within 12 months", () => {
    const f = detectPatterns(cases);
    expect(f.some((x) => x.kind === "repeat_subject")).toBe(true);
  });
  it("flags supervisor-as-subject", () => {
    expect(detectPatterns(cases).some((x) => x.kind === "supervisor_subject")).toBe(true);
  });
  it("flags complaint within 30 days of corrective action", () => {
    expect(detectPatterns(cases).some((x) => x.kind === "retaliation_timing")).toBe(true);
  });
  it("flags department concentration at >=4", () => {
    expect(detectPatterns(cases).some((x) => x.kind === "department_concentration")).toBe(true);
  });
});
