/**
 * HRIS connector framework (§3.3). A driver maps a vendor's schema into the
 * canonical model so modules never see vendor shapes. AMPAM runs ADP Workforce
 * Now today; the platform stays HRIS-agnostic so Workday/UKG/etc. are added
 * without touching modules. Connectors fail safe: a partial/failed sync degrades
 * to last-known-good and is fully logged with its source.
 */
import type {
  CompensationRecord,
  ManagerEdge,
  Position,
  Worker,
  Worksite,
} from "@hr-os/contracts";

export interface FieldMapEntry {
  /** Canonical field name. */
  canonical: string;
  /** Vendor field path. */
  source: string;
  required: boolean;
  note?: string;
}

export interface RosterSnapshot {
  workers: Worker[];
  positions: Position[];
  worksites: Worksite[];
  managerEdges: ManagerEdge[];
}

export interface VerifyResult {
  ok: boolean;
  /** Driver capabilities discovered (read scopes, writeback availability). */
  capabilities: string[];
  errors: string[];
}

/** Result of a writeback attempt. Drivers may be read-only (writeback unsupported). */
export interface WriteBackResult {
  applied: number;
  skipped: number;
  errors: string[];
}

export interface Connector {
  readonly id: string;
  readonly label: string;
  readonly readOnly: boolean;
  /** Confirm credentials/scopes without mutating anything. */
  verify(): Promise<VerifyResult>;
  fetchRoster(tenantId: string): Promise<RosterSnapshot>;
  fetchCompensation(tenantId: string): Promise<CompensationRecord[]>;
  /** Optional writeback (e.g. status, position). Read-only drivers reject. */
  writeBack(tenantId: string, changes: Array<{ workerId: string; field: string; value: string }>): Promise<WriteBackResult>;
  describeFieldMap(): FieldMapEntry[];
}
