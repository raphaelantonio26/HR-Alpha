/**
 * Employee Relations decision engine (pure, deterministic, no network).
 *
 * Maps an investigation case + the CA statutory framework to engine outputs:
 *   policyAlignment, statutoryRisk (0-100), litigationExposure, recommendation,
 *   ordered nextSteps with deadlines.
 *
 * It SCORES and RECOMMENDS — it never decides (§2 invariant 1). HR owns the
 * outcome. Deterministic so it is reproducible for the audit trail. Conservative
 * by design: an incomplete record recommends FURTHER INVESTIGATION, never
 * discipline or denial (§2 invariant 8). Nothing here is legal advice.
 *
 * The deterministic baseline is the floor; when the AI gateway is reachable it
 * may ENRICH precedent leads, but the score and recommendation logic below stand
 * alone and are what the audit record reproduces.
 */
import type { EngineOutput, ErCase } from "@hr-os/contracts";
import { statuteList } from "./statutes.js";

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, Math.round(n)));

function daysBetween(a: string, b: string): number | null {
  const x = new Date(a);
  const y = new Date(b);
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return null;
  return Math.round((y.getTime() - x.getTime()) / 86_400_000);
}

const SEV_WEIGHT: Record<string, number> = { Severe: 30, Major: 18, Minor: 6 };

const PROHIBITED = ["Harassment", "Discrimination", "Retaliation", "Workplace Violence", "Threats", "Theft / Dishonesty"];
const AMBIGUOUS = ["Insubordination", "Attendance", "Policy Violation", "Safety"];

/** Protected-activity -> adverse-action proximity. The dominant retaliation signal. */
export function retaliationWindow(c: ErCase): { flagged: boolean; days: number | null } {
  const p = c.protectedActivityDate ?? null;
  const a = c.adverseActionDate ?? null;
  if (!p || !a) return { flagged: !!c.retaliationRisk, days: null };
  const d = daysBetween(p, a);
  if (d === null || d < 0) return { flagged: false, days: null };
  return { flagged: d <= 90, days: d };
}

export function policyAlignment(c: ErCase): { verdict: string; label: string } {
  if (PROHIBITED.includes(c.incidentType)) {
    return { verdict: "prohibited", label: "Clearly prohibited by statute and/or handbook" };
  }
  if (AMBIGUOUS.includes(c.incidentType)) {
    return { verdict: "ambiguous", label: "Addressed in handbook — context-dependent" };
  }
  return { verdict: "not_addressed", label: "Not directly addressed — assess against general conduct standards" };
}

export function statutoryRisk(c: ErCase): EngineOutput["statutoryRisk"] {
  const rationale: string[] = [];
  let score = 0;
  for (const s of statuteList(c.incidentType)) {
    score += s.weight;
    rationale.push(`${s.name} (${s.cite}) implicated — base weight ${s.weight}.`);
  }
  const sev = SEV_WEIGHT[c.severity] ?? 10;
  score += sev;
  rationale.push(`Severity "${c.severity}" contributes ${sev}.`);

  const rw = retaliationWindow(c);
  if (rw.flagged) {
    const bump = rw.days === null ? 14 : rw.days <= 30 ? 26 : 16;
    score += bump;
    rationale.push(
      rw.days === null
        ? `Retaliation risk flagged (+${bump}).`
        : `Adverse action ${rw.days} day(s) after protected activity — temporal proximity is the dominant retaliation signal (+${bump}).`,
    );
  }
  const interviews = (c.events ?? []).filter((e) => e.kind === "interview").length;
  if (interviews >= 2 && sev >= 18) {
    score += 8;
    rationale.push("Multiple corroborating interviews on a serious matter (+8).");
  }
  if (c.subjectIsSupervisor) {
    score += 10;
    rationale.push("Subject is a supervisor — FEHA can impose strict employer liability (+10).");
  }
  const prior = c.priorSubjectCases12mo ?? 0;
  if (prior > 0) {
    const b = 8 * Math.min(2, prior);
    score += b;
    rationale.push(`${prior} prior case(s) against the same subject in 12 months — pattern (+${b}).`);
  }
  if (c.activeLoa) {
    score += 10;
    rationale.push("Subject/complainant has an active leave (Leave module) — interference/retaliation exposure (+10).");
  }

  score = clamp(score);
  const band = score >= 75 ? "HIGH" : score >= 45 ? "MODERATE" : "LOW";
  return { score, band, rationale };
}

export function litigationExposure(c: ErCase, risk: EngineOutput["statutoryRisk"]): EngineOutput["litigationExposure"] {
  const vectors: string[] = [];
  for (const s of statuteList(c.incidentType)) vectors.push(s.cite);
  const rw = retaliationWindow(c);
  if (rw.flagged) vectors.push("Retaliation claim (temporal proximity)");
  if (c.subjectIsSupervisor && ["Harassment", "Discrimination"].includes(c.incidentType)) {
    vectors.push("FEHA strict liability (supervisor)");
  }
  if (c.activeLoa) vectors.push("CFRA/FMLA interference overlap");
  let level: string = risk.band;
  if (risk.score >= 88 || (c.subjectIsSupervisor && c.incidentType === "Harassment" && c.severity === "Severe")) {
    level = "CRITICAL";
  }
  return { level, vectors: [...new Set(vectors)] };
}

const REC = {
  immediate_safety: { id: "immediate_safety", label: "Immediate safety action + investigation" },
  full_investigation: { id: "full_investigation", label: "Open full investigation" },
  prompt_corrective: { id: "prompt_corrective", label: "Prompt corrective action" },
  documented_counseling: { id: "documented_counseling", label: "Documented counseling" },
  monitor_close: { id: "monitor_close", label: "Monitor / close with note" },
} as const;

export function recommendation(c: ErCase, risk: EngineOutput["statutoryRisk"]): EngineOutput["recommendation"] {
  if (["Workplace Violence", "Threats"].includes(c.incidentType)) {
    return { ...REC.immediate_safety, basis: "SB 553 requires immediate response to credible threats/violence." };
  }
  if (risk.band === "HIGH") {
    return { ...REC.full_investigation, basis: "High statutory risk warrants a thorough, documented investigation before any decision." };
  }
  if (risk.band === "MODERATE") {
    return c.severity === "Severe"
      ? { ...REC.full_investigation, basis: "Severe conduct at moderate risk — investigate to establish the record." }
      : { ...REC.prompt_corrective, basis: "Moderate risk — address promptly and document." };
  }
  return c.severity === "Minor"
    ? { ...REC.documented_counseling, basis: "Low risk, minor conduct — counsel and document." }
    : { ...REC.monitor_close, basis: "Low risk — monitor; close with a note if no escalation." };
}

export function nextSteps(c: ErCase, risk: EngineOutput["statutoryRisk"]): EngineOutput["nextSteps"] {
  const steps: EngineOutput["nextSteps"] = [];
  if (c.status === "intake") {
    steps.push({ label: "Make first contact with the reporter", due: c.slaFirstContactDue ?? null, priority: 3 });
  }
  if (["Harassment", "Discrimination", "Retaliation", "Workplace Violence", "Threats"].includes(c.incidentType)) {
    steps.push({ label: "Place a litigation hold on relevant records", due: null, priority: risk.band === "HIGH" ? 3 : 2 });
  }
  const rw = retaliationWindow(c);
  if (rw.flagged) steps.push({ label: "Monitor for further adverse action against the reporter", due: null, priority: 3 });
  if (c.subjectIsSupervisor) steps.push({ label: "Escalate — supervisor-as-subject (FEHA strict liability)", due: null, priority: 2 });
  steps.push({ label: "Interview complainant, subject, and witnesses", due: null, priority: 2 });
  steps.push({ label: "Reach a disposition and document the basis", due: null, priority: 1 });
  return steps.sort((a, b) => b.priority - a.priority);
}

/** Run the full engine — the single entry point. modelPath records which path produced it. */
export function runEngine(c: ErCase, modelPath: "deterministic" | "ai-enriched" = "deterministic"): EngineOutput {
  const risk = statutoryRisk(c);
  return {
    ranAt: new Date().toISOString(),
    modelPath,
    policyAlignment: policyAlignment(c),
    statutoryRisk: risk,
    litigationExposure: litigationExposure(c, risk),
    recommendation: recommendation(c, risk),
    nextSteps: nextSteps(c, risk),
  };
}
