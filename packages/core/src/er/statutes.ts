/**
 * California statutory framework for the Employee Relations decision engine.
 *
 * Reference DATA, not legal advice. Each entry encodes the elements an
 * investigator weighs and a base exposure weight the deterministic scorer uses.
 * Citations point to the statute, not a holding — the engine never asserts a
 * legal conclusion, and surfaced statutes/case law are leads to VERIFY, not
 * authority (§2 invariant 1). Verify currency before relying.
 */

export interface Statute {
  name: string;
  cite: string;
  covers: string[];
  summary: string;
  elements: string[];
  weight: number;
  supervisorStrictLiability?: boolean;
}

export const STATUTES: Record<string, Statute> = {
  FEHA: {
    name: "Fair Employment and Housing Act",
    cite: "Cal. Gov. Code 12900-12996",
    covers: ["Harassment", "Discrimination", "Retaliation"],
    summary:
      "Prohibits harassment/discrimination on protected characteristics and retaliation for protected activity; employers must take immediate, appropriate corrective action and may be strictly liable for supervisor harassment.",
    elements: [
      "Complainant in a protected class or engaged in protected activity",
      "Conduct unwelcome and based on the protected characteristic/activity",
      "Severe or pervasive (hostile environment) OR a tangible employment action",
      "Employer knew or should have known and failed to act",
    ],
    weight: 30,
    supervisorStrictLiability: true,
  },
  LC1102_5: {
    name: "Labor Code 1102.5 — Whistleblower Retaliation",
    cite: "Cal. Lab. Code 1102.5",
    covers: ["Retaliation"],
    summary:
      "Prohibits retaliation for disclosing a suspected violation of law. Contribution-factor causation; employer bears a clear-and-convincing burden to show it would have acted absent the protected activity.",
    elements: ["Protected disclosure of suspected illegal conduct", "Adverse action", "Protected activity was a contributing factor"],
    weight: 28,
  },
  CFRA: {
    name: "California Family Rights Act",
    cite: "Cal. Gov. Code 12945.2",
    covers: ["Retaliation", "Policy Violation"],
    summary:
      "Job-protected family/medical leave; interference or retaliation is unlawful. An open ER matter against someone on active CFRA/FMLA leave is a heightened-exposure pattern.",
    elements: ["Eligible for and took/requested CFRA leave", "Adverse action followed", "Causal link"],
    weight: 18,
  },
  FMLA: {
    name: "Family and Medical Leave Act",
    cite: "29 U.S.C. 2601; 29 C.F.R. Part 825",
    covers: ["Retaliation", "Policy Violation"],
    summary:
      "Federal job-protected leave; interference and retaliation prohibited. Runs concurrently with CFRA where the qualifying reason overlaps.",
    elements: ["FMLA-eligible and took/requested qualifying leave", "Adverse action followed", "Causal connection"],
    weight: 14,
  },
  ADA_FEHA_IP: {
    name: "ADA / FEHA Reasonable Accommodation & Interactive Process",
    cite: "42 U.S.C. 12101; Cal. Gov. Code 12940(m)-(n)",
    covers: ["Discrimination", "Policy Violation"],
    summary:
      "Requires a timely, good-faith interactive process and reasonable accommodation absent undue hardship. Failure to engage is independently actionable under FEHA.",
    elements: ["Known disability or record of one", "Request for accommodation (or obvious need)", "Employer failed to engage / accommodate"],
    weight: 16,
  },
  LC232_5: {
    name: "Labor Code 232 / 232.5 — Wage & Working-Conditions Disclosure",
    cite: "Cal. Lab. Code 232, 232.5",
    covers: ["Retaliation", "Policy Violation"],
    summary: "Protects employees who disclose wages or working conditions; disciplining for such disclosure is unlawful.",
    elements: ["Disclosure of wages/working conditions", "Adverse action tied to the disclosure"],
    weight: 12,
  },
  WPV: {
    name: "Workplace Violence Prevention (SB 553)",
    cite: "Cal. Lab. Code 6401.9",
    covers: ["Workplace Violence", "Threats"],
    summary:
      "Requires a workplace violence prevention plan, incident logging, and response. Threats/violence demand immediate safety action regardless of investigation status.",
    elements: ["Credible threat or act of violence", "Plan/response obligations triggered", "Incident logged"],
    weight: 22,
  },
};

export const INCIDENT_TYPES = [
  "Harassment",
  "Discrimination",
  "Retaliation",
  "Workplace Violence",
  "Threats",
  "Policy Violation",
  "Attendance",
  "Insubordination",
  "Theft / Dishonesty",
  "Safety",
] as const;

export const DISPOSITIONS = [
  { id: "substantiated", label: "Substantiated" },
  { id: "partially", label: "Partially substantiated" },
  { id: "unsubstantiated", label: "Unsubstantiated" },
  { id: "inconclusive", label: "Inconclusive" },
  { id: "unfounded", label: "Unfounded" },
] as const;

/** Statutes plausibly implicated by an incident type. */
export function statuteList(incidentType: string): Statute[] {
  return Object.values(STATUTES).filter((s) => s.covers.includes(incidentType));
}
