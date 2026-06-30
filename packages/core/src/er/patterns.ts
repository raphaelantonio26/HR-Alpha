/**
 * Cross-case pattern detection (pure, deterministic). Surfaces systemic signals
 * across a tenant's ER caseload (§4 module 3). Operates on case ATTRIBUTES only —
 * never on medical narrative or any free text, and never surfaces a masked
 * narrative to a manager. Findings are advisory leads for HR to verify.
 */
import type { ErCase } from "@hr-os/contracts";

export interface PatternFinding {
  kind:
    | "repeat_subject"
    | "retaliation_timing"
    | "repeat_reporter"
    | "department_concentration"
    | "supervisor_subject"
    | "active_leave_overlap";
  label: string;
  severity: "low" | "moderate" | "high";
  refs: string[];
}

export interface PatternCase extends ErCase {
  subjectKey?: string;
  reporterKey?: string;
  department?: string;
  openedDate?: string;
  correctiveActionDate?: string;
}

const within = (a?: string, b?: string, days = 30): boolean => {
  if (!a || !b) return false;
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return Math.abs(y - x) <= days * 86_400_000;
};

const monthsApart = (a?: string, b?: string): number | null => {
  if (!a || !b) return null;
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.abs(y - x) / (86_400_000 * 30.4375);
};

export function detectPatterns(cases: PatternCase[]): PatternFinding[] {
  const findings: PatternFinding[] = [];

  // Repeat subjects within 12 months.
  const bySubject = new Map<string, PatternCase[]>();
  for (const c of cases) {
    if (!c.subjectKey) continue;
    (bySubject.get(c.subjectKey) ?? bySubject.set(c.subjectKey, []).get(c.subjectKey)!).push(c);
  }
  for (const [key, group] of bySubject) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.openedDate ?? "").localeCompare(b.openedDate ?? ""));
    const recent = sorted.filter((c, i) => {
      if (i === 0) return false;
      const m = monthsApart(sorted[0]!.openedDate, c.openedDate);
      return m != null && m <= 12;
    });
    if (recent.length >= 1) {
      findings.push({
        kind: "repeat_subject",
        label: `Subject ${key} named in ${group.length} cases within 12 months`,
        severity: group.length >= 3 ? "high" : "moderate",
        refs: group.map((c) => c.id),
      });
    }
    if (group.some((c) => c.subjectIsSupervisor)) {
      findings.push({
        kind: "supervisor_subject",
        label: `Supervisor ${key} is the subject of an open matter`,
        severity: "high",
        refs: group.filter((c) => c.subjectIsSupervisor).map((c) => c.id),
      });
    }
  }

  // Complaint within 30 days of corrective action -> retaliation flag.
  for (const c of cases) {
    if (within(c.correctiveActionDate, c.openedDate, 30)) {
      findings.push({
        kind: "retaliation_timing",
        label: `Complaint opened within 30 days of a corrective action (${c.id}) — retaliation flag`,
        severity: "high",
        refs: [c.id],
      });
    }
    if (c.activeLoa) {
      findings.push({
        kind: "active_leave_overlap",
        label: `Open matter overlaps an active leave (${c.id}) — interference exposure`,
        severity: "moderate",
        refs: [c.id],
      });
    }
  }

  // Repeat reporters.
  const byReporter = new Map<string, PatternCase[]>();
  for (const c of cases) {
    if (!c.reporterKey) continue;
    (byReporter.get(c.reporterKey) ?? byReporter.set(c.reporterKey, []).get(c.reporterKey)!).push(c);
  }
  for (const [key, group] of byReporter) {
    if (group.length >= 3) {
      findings.push({
        kind: "repeat_reporter",
        label: `Reporter ${key} filed ${group.length} reports — review for context`,
        severity: "low",
        refs: group.map((c) => c.id),
      });
    }
  }

  // Department concentration.
  const byDept = new Map<string, PatternCase[]>();
  for (const c of cases) {
    if (!c.department) continue;
    (byDept.get(c.department) ?? byDept.set(c.department, []).get(c.department)!).push(c);
  }
  for (const [dept, group] of byDept) {
    if (group.length >= 4) {
      findings.push({
        kind: "department_concentration",
        label: `${group.length} cases concentrated in ${dept}`,
        severity: group.length >= 6 ? "high" : "moderate",
        refs: group.map((c) => c.id),
      });
    }
  }

  return findings;
}
