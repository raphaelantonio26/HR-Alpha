/**
 * ADP Workforce Now driver (§3.3). AMPAM's current HRIS. Production uses ADP's
 * OAuth + mutual-TLS API; this Stage-1 driver runs in DRY-RUN: it documents the
 * field map and verifies shape WITHOUT calling ADP or moving data. The field map
 * is the contract a live fetch fills. Read-first; writeback is opt-in per tenant.
 * TODO(fable5): implement OAuth client-credentials + mTLS cert handshake, the
 *   Workers/Work Assignments endpoints, and cursor-based incremental sync.
 */
import type { CompensationRecord } from "@hr-os/contracts";
import type { Connector, FieldMapEntry, RosterSnapshot, VerifyResult, WriteBackResult } from "../interface.js";

const FIELD_MAP: FieldMapEntry[] = [
  { canonical: "fileNumber", source: "worker.associateOID|workerID.idValue", required: true, note: "TEXT — preserve leading zeros" },
  { canonical: "firstName", source: "person.legalName.givenName", required: true },
  { canonical: "lastName", source: "person.legalName.familyName1", required: true },
  { canonical: "status", source: "workerStatus.statusCode.codeValue", required: true },
  { canonical: "hireDate", source: "workerDates.originalHireDate", required: true },
  { canonical: "positionId", source: "workAssignments[].jobCode.codeValue", required: true },
  { canonical: "worksiteId", source: "workAssignments[].homeWorkLocation.nameCode.codeValue", required: true },
  { canonical: "managerId", source: "workAssignments[].reportsTo[].associateOID", required: false },
  { canonical: "employmentType", source: "workAssignments[].wageLawCoverage.wageLawNameCode", required: false, note: "maps to union | open_shop" },
  { canonical: "hoursPerWeek", source: "workAssignments[].standardHours.hoursQuantity", required: false },
];

export class AdpWorkforceNowConnector implements Connector {
  readonly id = "adp_wfn";
  readonly label = "ADP Workforce Now";
  readonly readOnly = true;

  async verify(): Promise<VerifyResult> {
    return { ok: true, capabilities: ["read:workers", "read:assignments", "dry-run"], errors: [] };
  }

  async fetchRoster(_tenantId: string): Promise<RosterSnapshot> {
    // DRY-RUN: a live implementation maps the ADP Workers payload via FIELD_MAP.
    return { workers: [], positions: [], worksites: [], managerEdges: [] };
  }

  async fetchCompensation(_tenantId: string): Promise<CompensationRecord[]> {
    return [];
  }

  async writeBack(): Promise<WriteBackResult> {
    return { applied: 0, skipped: 0, errors: ["writeback disabled (read-only driver)"] };
  }

  describeFieldMap(): FieldMapEntry[] {
    return FIELD_MAP;
  }
}
