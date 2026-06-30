/**
 * California leave rule pack — versioned, dated, pure (§4 module 2 reference pack).
 *
 * Encodes the California-relevant frameworks AMPAM administers: FMLA (federal),
 * CFRA, and PDL, and the concurrency rules among them. Packs are ADDITIVE: NY PFL,
 * WA PFML, CO FAMLI, etc. are new packs selected by worksite jurisdiction — never
 * a core rewrite. Reference DATA, not legal advice; verify currency before relying.
 *
 * Concurrency rules encoded as the default clock suggestion per reason. HR's
 * designation on the case is authoritative (await-designation), so these are the
 * starting point the engine offers, with the documented exceptions below:
 *  - serious_health / family_care: FMLA + CFRA run concurrently.
 *  - pregnancy_disability: FMLA + PDL run concurrently; PDL is NEVER concurrent with CFRA.
 *  - bonding: FMLA + CFRA concurrently when FMLA remains; if FMLA was exhausted by a
 *    prior PDL, bonding charges CFRA ALONE (HR designates ["CFRA"]).
 */
import type { ClockType, Jurisdiction, LeaveReason } from "@hr-os/contracts";

export interface RulePack {
  jurisdiction: Jurisdiction;
  version: string;
  /** Effective date of this pack version (ISO). */
  effective: string;
  reasons: LeaveReason[];
  /** Documented citation leads — verify, not authority. */
  citations: Record<string, string>;
}

export const CA_LEAVE_REASONS: LeaveReason[] = [
  { id: "serious_health", label: "Employee serious health condition", clocks: ["FMLA", "CFRA"] },
  { id: "family_care", label: "Family member serious health condition", clocks: ["FMLA", "CFRA"] },
  { id: "bonding", label: "Baby bonding (new child)", clocks: ["FMLA", "CFRA"] },
  { id: "pregnancy_disability", label: "Pregnancy disability", clocks: ["FMLA", "PDL"] },
  { id: "military_exigency", label: "Qualifying military exigency", clocks: ["FMLA"] },
  { id: "military_caregiver", label: "Military caregiver", clocks: ["FMLA Military Caregiver"] },
  { id: "personal", label: "Personal / non-statutory", clocks: [] },
];

export const CALIFORNIA_PACK: RulePack = {
  jurisdiction: "US-CA",
  version: "2026.1",
  effective: "2026-01-01",
  reasons: CA_LEAVE_REASONS,
  citations: {
    FMLA: "29 U.S.C. 2601; 29 C.F.R. Part 825; rolling 12-month window 29 C.F.R. 825.200(b)(4)",
    CFRA: "Cal. Gov. Code 12945.2; 2 C.C.R. 11087 et seq.",
    PDL: "Cal. Gov. Code 12945; up to 4 months / 17 1/3 workweeks",
  },
};

/** Minimal federal-only pack — the architecture proof that packs are additive. */
export const FEDERAL_PACK: RulePack = {
  jurisdiction: "US-FED",
  version: "2026.1",
  effective: "2026-01-01",
  reasons: CA_LEAVE_REASONS.map((r) => ({
    ...r,
    clocks: r.clocks.filter((c) => c === "FMLA" || c === "FMLA Military Caregiver") as ClockType[],
  })),
  citations: { FMLA: "29 U.S.C. 2601; 29 C.F.R. Part 825" },
};

const REGISTRY: Partial<Record<Jurisdiction, RulePack>> = {
  "US-CA": CALIFORNIA_PACK,
  "US-FED": FEDERAL_PACK,
  // TODO(fable5): "US-NY": NY_PFL_PACK, "US-WA": WA_PFML_PACK, "US-CO": CO_FAMLI_PACK
};

/** Select the rule pack for a worksite jurisdiction; falls back to federal. */
export function rulePackFor(jurisdiction: Jurisdiction): RulePack {
  return REGISTRY[jurisdiction] ?? FEDERAL_PACK;
}

/** Suggested concurrent clocks for a reason under a jurisdiction (default; HR designates). */
export function suggestedClocks(reasonId: string, jurisdiction: Jurisdiction): ClockType[] {
  const pack = rulePackFor(jurisdiction);
  return pack.reasons.find((r) => r.id === reasonId)?.clocks ?? [];
}
