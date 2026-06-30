/**
 * Canonical people & org model — the normalized shape every connector maps INTO,
 * so modules never see a vendor's schema (§3.3). AMPAM is modeled with offices,
 * business units, and trade lines — never as separate legal entities. Every
 * AMPAM-specific fact is tenant configuration, never hard-code.
 *
 * Conventions:
 *  - File / employee numbers are TEXT (preserve ADP leading zeros).
 *  - Pay units hourly | annual, converted at 2,080 hrs/yr.
 *  - Band convention: min = P25, mid = P50, max = P75; P10/P90 extend the ladder.
 *  - Sensitive fields (medical narrative, government id) are field-level encrypted
 *    and masked in the secure read path; prefer NOT storing SSNs at all.
 */
import type {
  EmploymentType,
  FlsaClass,
  Jurisdiction,
  PayUnit,
  WorkerStatus,
} from "./enums.js";

/** Tenant id is on every row; isolation is enforced at the DB via RLS (§3.2). */
export type TenantId = string;

export interface Worksite {
  id: string;
  tenantId: TenantId;
  /** "Carson HQ", "Jurupa Valley", "El Cajon", "Poway", "Fremont" — offices, not entities. */
  name: string;
  city: string;
  state: string;
  /** Drives which dated, versioned rule packs apply to workers at this site. */
  jurisdictions: Jurisdiction[];
}

export interface OrgUnit {
  id: string;
  tenantId: TenantId;
  name: string;
  /** "business_unit" | "trade_line" | "department" — a single consolidated company's shape. */
  kind: "business_unit" | "trade_line" | "department";
  parentId: string | null;
}

export interface Position {
  id: string;
  tenantId: TenantId;
  title: string;
  /** Normalized join key; always normalize a title before joining to comp bands / JD catalog. */
  titleKey: string;
  flsa: FlsaClass;
  /** SOC code (e.g. 49-2098 low-voltage), where mapped. */
  socCode?: string;
  /** ADP job code, where mapped. */
  adpJobCode?: string;
  orgUnitId: string | null;
}

/** Government id / SSN stored field-level encrypted, masked on read — prefer omitting entirely. */
export interface Worker {
  id: string;
  tenantId: TenantId;
  /** TEXT — preserves ADP leading zeros. */
  fileNumber: string;
  firstName: string;
  lastName: string;
  status: WorkerStatus;
  worksiteId: string;
  positionId: string;
  /** manager_id edge; org chart is built from this (no graph dependency). */
  managerId: string | null;
  employmentType: EmploymentType;
  hireDate: string; // ISO yyyy-mm-dd
  /** Scheduled hours/week; blank => full-time 40 for proration math. */
  hoursPerWeek?: number;
}

/**
 * TODO(fable5): Employee-file AI retrieval seam (DESIGN ONLY this phase; do not
 * implement here). A unified platform implies a future "ask across the whole
 * employee file" capability, which collides with invariant #3 (no PII to models).
 * Reconcile it in the model now: the canonical Worker must support a SERVER-SIDE
 * governed retrieval + redaction layer that assembles a minimized, non-PII fact set
 * for the gateway and AUDITS every access. A full employee file is NEVER sent to a
 * model -- not now, not ever. The shape below is the contract that layer will emit;
 * the gateway's findPii() screen remains the backstop.
 *
 * Implementation lives server-side (packages/server) behind withActor so every
 * assembly is tenant-scoped and audited; the engine receives only WorkerFactView.
 */
export interface WorkerFactView {
  /** Opaque, per-request token — NOT the worker id, NOT the file number. */
  ref: string;
  tenureMonths: number;
  /** Coarse band, never the amount: "below_min" | "in_band" | "above_max" | "unknown". */
  payBandPosition: "below_min" | "in_band" | "above_max" | "unknown";
  hoursLast12mo?: number;
  /** Reason ids / clock types only — never medical narrative or identifiers. */
  activeLeaveClocks?: string[];
  worksiteJurisdictions: string[];
}

export interface EmploymentRecord {
  id: string;
  tenantId: TenantId;
  workerId: string;
  effectiveDate: string;
  /** "hire" | "rehire" | "transfer" | "promotion" | "termination". */
  event: string;
  positionId: string;
  worksiteId: string;
  note?: string;
}

/** Masked in the people_manager read path. */
export interface CompensationRecord {
  id: string;
  tenantId: TenantId;
  workerId: string;
  amount: number;
  unit: PayUnit;
  effectiveDate: string;
  /** Hours worked in trailing 12mo — feeds FMLA/CFRA eligibility (never invented). */
  hoursWorked12mo?: number;
}

/** A normalized title key joins titles, SOC codes, ADP job codes, and prevailing-wage classes. */
export interface TitleKey {
  key: string;
  displayTitle: string;
  socCode?: string;
  dirClass?: string;
  davisBaconClass?: string;
}

export interface ManagerEdge {
  managerId: string;
  reportId: string;
}
