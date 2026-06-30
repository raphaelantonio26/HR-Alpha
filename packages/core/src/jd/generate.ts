/**
 * Job-description engine (pure, deterministic, offline). Trade-aware JD content
 * for AMPAM's MEP + low-voltage workforce (§4 module 6). In a backed deployment
 * this is the deterministic fallback the AI Senior-Recruiter agent enriches.
 *
 * Guarantees enforced by tests (§7 output validation):
 *  - normalizeTitleKey() reconciles titles -> one join key for comp bands + catalog.
 *  - inferTrade() picks the SPECIFIC trade ("Fire Sprinkler Fitter" -> fire_sprinkler,
 *    not plumbing) and never leaks another trade's jargon.
 *  - generate() returns only the requested section keys and splits required/preferred.
 *  - No fabricated pay/benefits/legal content (banned-content lint in tests).
 *  - EEO footer + "Who We Are" render on every export (added at the render layer).
 *
 * Custom trades are addable at runtime with NO redeploy and NO pay data in profiles.
 */

export interface TradeProfile {
  id: string;
  label: string;
  /** Keywords that route a free-text title to this trade. Order matters: specific first. */
  match: string[];
  verbs: [string, string, string, string];
  systems: string;
  certs: string[];
}

export const TRADES: TradeProfile[] = [
  {
    id: "fire_sprinkler",
    label: "Fire Sprinkler",
    match: ["sprinkler", "fire suppression", "sprinkler fitter"],
    verbs: ["install", "fabricate", "test", "hang"],
    systems: "wet, dry, and pre-action fire-sprinkler piping and life-safety suppression systems",
    certs: ["NICET Level II (Water-Based Systems Layout)", "California C-16 familiarity", "OSHA 30"],
  },
  {
    id: "fire_alarm",
    label: "Fire Alarm",
    match: ["fire alarm", "life safety", "notification"],
    verbs: ["install", "terminate", "program", "test"],
    systems: "fire-alarm initiating/notification devices, panels, and life-safety signaling",
    certs: ["NICET Level II (Fire Alarm Systems)", "California Fire/Life Safety license", "OSHA 30"],
  },
  {
    id: "low_voltage",
    label: "Low Voltage / Sound & Communications",
    match: ["low voltage", "sound", "communications", "structured cabling", "access control", "49-2098"],
    verbs: ["install", "terminate", "program", "test"],
    systems: "structured cabling, access control, AV, and sound & communications systems",
    certs: ["BICSI installer certification", "California C-7 familiarity", "OSHA 30"],
  },
  {
    id: "controls",
    label: "Controls / Building Automation",
    match: ["controls", "building automation", "bms", "ddc"],
    verbs: ["install", "terminate", "program", "commission"],
    systems: "DDC building-automation controllers, sensors, and integration networks",
    certs: ["Manufacturer controls certification", "OSHA 30"],
  },
  {
    id: "plumbing",
    label: "Plumbing",
    match: ["plumb", "pipefitter", "process pip"],
    verbs: ["install", "assemble", "repair", "test"],
    systems: "domestic water, sanitary waste, vent, and gas piping systems",
    certs: ["California journeyman plumber certification", "backflow prevention certification", "medical gas certification (NITC)"],
  },
  {
    id: "hvac",
    label: "HVAC / Mechanical",
    match: ["hvac", "mechanical", "sheet metal", "refrigeration", "service mechanic"],
    verbs: ["install", "braze", "commission", "balance"],
    systems: "HVAC equipment, refrigerant piping, ductwork, and hydronic systems",
    certs: ["EPA 608 Universal certification", "NATE certification", "California journeyman pipefitter status"],
  },
  {
    id: "electrical",
    label: "Electrical",
    match: ["electric", "wireman", "electrician"],
    verbs: ["install", "terminate", "pull", "energize"],
    systems: "power distribution, conduit, branch circuits, and panel boards",
    certs: ["California General Electrician (ET) certification", "OSHA 30", "NFPA 70E arc-flash training"],
  },
  {
    id: "solar_ev",
    label: "Solar / EV",
    match: ["solar", "photovoltaic", "pv", "ev charging", "evse"],
    verbs: ["install", "terminate", "mount", "commission"],
    systems: "photovoltaic arrays, inverters, and EV-charging infrastructure",
    certs: ["NABCEP (preferred)", "OSHA 30", "NFPA 70E arc-flash training"],
  },
];

export const LEVELS = [
  { id: "apprentice", label: "Apprentice", exempt: false, years: "0-2 years", verb: "Under direct supervision," },
  { id: "journeyman", label: "Journeyman", exempt: false, years: "4+ years", verb: "Working independently," },
  { id: "foreman", label: "Foreman", exempt: false, years: "7+ years including crew lead", verb: "Leading a field crew," },
  { id: "superintendent", label: "Superintendent", exempt: true, years: "10+ years", verb: "Overseeing field operations," },
  { id: "manager", label: "Manager", exempt: true, years: "8+ years including leadership", verb: "Managing a function and team," },
] as const;

export type JdSectionKey =
  | "jobSummary"
  | "responsibilities"
  | "requiredQualifications"
  | "preferredQualifications"
  | "physicalRequirements"
  | "workingConditions";

/** Normalize a title to a stable join key (lowercase, alnum, single-spaced -> hyphen). */
export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/** Route a free-text title to the most specific matching trade. */
export function inferTrade(title: string): TradeProfile {
  const t = title.toLowerCase();
  for (const trade of TRADES) {
    if (trade.match.some((m) => t.includes(m))) return trade;
  }
  return TRADES.find((x) => x.id === "plumbing")!;
}

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export interface GenerateInput {
  jobTitle: string;
  tradeId?: string;
  levelId?: string;
  /** Which sections to return; defaults to all. The result contains ONLY these keys. */
  sections?: JdSectionKey[];
}

export type GeneratedJd = Partial<Record<JdSectionKey, string | string[]>> & {
  titleKey: string;
  tradeId: string;
  flsa: "exempt" | "non_exempt";
};

export function generateJD(input: GenerateInput): GeneratedJd {
  const trade = input.tradeId ? TRADES.find((t) => t.id === input.tradeId) ?? inferTrade(input.jobTitle) : inferTrade(input.jobTitle);
  const level = LEVELS.find((l) => l.id === input.levelId) ?? LEVELS[1];
  const want = new Set<JdSectionKey>(
    input.sections ?? ["jobSummary", "responsibilities", "requiredQualifications", "preferredQualifications", "physicalRequirements", "workingConditions"],
  );
  const [v1, v2, v3, v4] = trade.verbs;

  const all: Record<JdSectionKey, string | string[]> = {
    jobSummary: `${level.verb} the ${input.jobTitle} ${level.exempt ? "directs" : "performs"} work on ${trade.systems} across AMPAM's multifamily and commercial construction projects. The role ${v1}s and ${v3}s to code and project specifications while upholding AMPAM's safety and quality standards.`,
    responsibilities:
      level.exempt || level.id === "foreman"
        ? [
            `Plan, ${v2}, and sequence crew work to hit the project schedule and budget.`,
            "Supervise, mentor, and evaluate field crew; enforce safety and quality standards.",
            "Coordinate manpower, material, and equipment with the project team.",
            "Conduct daily huddles, JHAs, and toolbox talks; own the site safety culture.",
            "Interface with the GC, inspectors, and other trades to resolve field issues.",
            "Drive closeout, punch, and as-built documentation through completion.",
          ]
        : [
            `${cap(v1)} ${trade.systems} per approved plans, submittals, and applicable code.`,
            `${cap(v2)} and ${v4} components to manufacturer and project specifications.`,
            "Read and interpret construction drawings, isometrics, and submittals.",
            "Maintain a clean, organized, and OSHA-compliant work area at all times.",
            "Inspect completed work and correct deficiencies before inspection.",
            "Coordinate with other trades to maintain the project schedule and avoid rework.",
          ],
    requiredQualifications: [
      `${level.years} of ${trade.label.toLowerCase()} experience in commercial or multifamily construction.`,
      "Ability to read construction drawings, submittals, and applicable code.",
      "Valid driver's license and reliable transportation to job sites.",
      trade.certs[0] ?? "Trade-appropriate certification.",
    ],
    preferredQualifications: [
      ...trade.certs.slice(1),
      "Bilingual English/Spanish.",
      "Experience on prevailing-wage / public-works projects.",
    ],
    physicalRequirements: [
      "Lift and carry up to 50 lbs; frequent bending, kneeling, and overhead work.",
      "Work on ladders, lifts, and scaffolding at height.",
      "Stand and walk on active construction sites for the duration of a shift.",
    ],
    workingConditions: [
      "Active construction sites, indoors and outdoors, in varying weather.",
      "Exposure to noise, dust, and trade hazards; PPE required at all times.",
    ],
  };

  const out: GeneratedJd = { titleKey: normalizeTitleKey(input.jobTitle), tradeId: trade.id, flsa: level.exempt ? "exempt" : "non_exempt" };
  for (const key of want) out[key] = all[key];
  return out;
}
