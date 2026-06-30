/** Shared enumerations — the controlled vocabulary every module and connector maps into. */

export const PAY_UNITS = ["hourly", "annual"] as const;
export type PayUnit = (typeof PAY_UNITS)[number];

export const EMPLOYMENT_TYPES = ["union", "open_shop"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const FLSA = ["exempt", "non_exempt"] as const;
export type FlsaClass = (typeof FLSA)[number];

export const WORKER_STATUS = ["active", "leave", "terminated", "pre_hire"] as const;
export type WorkerStatus = (typeof WORKER_STATUS)[number];

/** Jurisdiction tags drive rule-pack selection (by worksite). Additive: add packs, not core rewrites. */
export const JURISDICTIONS = ["US-FED", "US-CA", "US-NY", "US-WA", "US-CO"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

/** RBAC roles (tenant-editable baseline). Masking is enforced in the DB read path, not just the UI. */
export const ROLES = [
  "administrator",
  "hrbp",
  "comp_analyst",
  "people_manager",
  "legal_compliance",
  "employee",
  "anonymous",
] as const;
export type Role = (typeof ROLES)[number];

/** Source of a roster change — written to every audit row by the sync engine. */
export const SYNC_SOURCES = ["adp_wfn", "csv", "scim", "manual", "seed"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];
