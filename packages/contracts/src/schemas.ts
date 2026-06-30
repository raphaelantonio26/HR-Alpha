/**
 * Zod schemas — the API contract and the single source of truth for every write
 * route (§3.7: zod validation on EVERY write route). Importers and routes parse
 * with these; nothing untrusted reaches the DB unvalidated.
 */
import { z } from "zod";
import { PAY_UNITS, EMPLOYMENT_TYPES, FLSA, WORKER_STATUS, JURISDICTIONS, ROLES, SYNC_SOURCES } from "./enums.js";

export const zPayUnit = z.enum(PAY_UNITS);
export const zEmploymentType = z.enum(EMPLOYMENT_TYPES);
export const zFlsa = z.enum(FLSA);
export const zWorkerStatus = z.enum(WORKER_STATUS);
export const zJurisdiction = z.enum(JURISDICTIONS);
export const zRole = z.enum(ROLES);
export const zSyncSource = z.enum(SYNC_SOURCES);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd");

export const zWorker = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  fileNumber: z.string().min(1), // TEXT — preserve leading zeros
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  status: zWorkerStatus,
  worksiteId: z.string().min(1),
  positionId: z.string().min(1),
  managerId: z.string().nullable(),
  employmentType: zEmploymentType,
  hireDate: isoDate,
  hoursPerWeek: z.number().positive().max(168).optional(),
});
export type WorkerInput = z.infer<typeof zWorker>;

export const zPayBand = z
  .object({
    unit: zPayUnit,
    p10: z.number().nonnegative().optional(),
    p25: z.number().nonnegative().optional(),
    p50: z.number().nonnegative().optional(),
    p75: z.number().nonnegative().optional(),
    p90: z.number().nonnegative().optional(),
    confidence: z.number().min(0).max(100).optional(),
    locked: z.boolean().optional(),
  })
  .refine((b) => b.p25 == null || b.p75 == null || b.p25 <= b.p75, {
    message: "p25 must be <= p75",
  });

export const zLeaveCaseInput = z.object({
  workerId: z.string().min(1),
  reasonId: z.string().min(1),
  designation: z.array(z.enum(["FMLA", "CFRA", "PDL", "FMLA Military Caregiver"])).nullable(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  intermittent: z.boolean().default(false),
  priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
  jurisdiction: zJurisdiction.default("US-CA"),
});

export const zErIntake = z.object({
  caseType: z.enum(["er", "ethics", "safety", "fraud", "compliance"]).default("er"),
  incidentType: z.string().min(1),
  severity: z.enum(["Minor", "Major", "Severe"]).default("Major"),
  subjectIsSupervisor: z.boolean().default(false),
  /** Anonymous intake omits identifiers entirely; a tracking token is issued instead. */
  anonymous: z.boolean().default(false),
  narrative: z.string().max(20000).optional(),
});

/** AI gateway request body is whitelisted (§3.6) — only these keys are accepted. */
export const zAiRequest = z.object({
  purpose: z.enum(["comp_analyst", "policy_assistant", "jd_research", "dashboard_assist", "er_enrich"]),
  /** Minimum structured facts only — never raw identifiers, names, medical narrative, SSN. */
  facts: z.record(z.union([z.string(), z.number(), z.boolean()])),
  enableWebSearch: z.boolean().default(false),
});
export type AiRequest = z.infer<typeof zAiRequest>;
