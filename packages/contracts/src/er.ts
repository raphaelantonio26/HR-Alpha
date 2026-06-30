/** Employee Relations / Investigations domain types. */
export type ErStatus =
  | "intake"
  | "triage"
  | "under_investigation"
  | "pending_decision"
  | "decision_issued"
  | "closed"
  | "appealed";

export type Severity = "Minor" | "Major" | "Severe";

export interface ErEvent {
  kind: "interview" | "evidence" | "note" | "contact";
  date: string;
  /** Free text is NEVER sent to a model; only structured attributes leave the boundary. */
  summary?: string;
}

export interface ErCase {
  id: string;
  tenantId: string;
  caseType: "er" | "ethics" | "safety" | "fraud" | "compliance";
  incidentType: string;
  severity: Severity;
  status: ErStatus;
  subjectIsSupervisor: boolean;
  protectedActivityDate?: string | null;
  adverseActionDate?: string | null;
  retaliationRisk?: boolean;
  priorSubjectCases12mo?: number;
  /** Subject/complainant has an active leave — interference/retaliation exposure. */
  activeLoa?: boolean;
  slaFirstContactDue?: string | null;
  events?: ErEvent[];
  legalHold?: boolean;
}

export interface EngineOutput {
  ranAt: string;
  modelPath: "deterministic" | "ai-enriched";
  policyAlignment: { verdict: string; label: string };
  statutoryRisk: { score: number; band: "LOW" | "MODERATE" | "HIGH"; rationale: string[] };
  litigationExposure: { level: string; vectors: string[] };
  recommendation: { id: string; label: string; basis: string };
  nextSteps: Array<{ label: string; due: string | null; priority: number }>;
}
