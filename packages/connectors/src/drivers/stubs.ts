/**
 * Native-API driver stubs (§3.3). Each implements the Connector contract so the
 * platform stays HRIS-agnostic. They verify as "not configured" until built.
 * TODO(fable5): implement Workday (RaaS/SOAP), UKG Pro, BambooHR, Paylocity,
 *   SAP SuccessFactors native fetch + incremental sync.
 */
import type { CompensationRecord } from "@hr-os/contracts";
import type { Connector, FieldMapEntry, RosterSnapshot, VerifyResult, WriteBackResult } from "../interface.js";

class NotConfiguredConnector implements Connector {
  readonly readOnly = true;
  constructor(readonly id: string, readonly label: string) {}
  async verify(): Promise<VerifyResult> {
    return { ok: false, capabilities: [], errors: [`${this.label} driver not configured`] };
  }
  async fetchRoster(): Promise<RosterSnapshot> {
    return { workers: [], positions: [], worksites: [], managerEdges: [] };
  }
  async fetchCompensation(): Promise<CompensationRecord[]> {
    return [];
  }
  async writeBack(): Promise<WriteBackResult> {
    return { applied: 0, skipped: 0, errors: ["not configured"] };
  }
  describeFieldMap(): FieldMapEntry[] {
    return [];
  }
}

export const WorkdayConnector = () => new NotConfiguredConnector("workday", "Workday");
export const UkgProConnector = () => new NotConfiguredConnector("ukg_pro", "UKG Pro");
export const BambooHrConnector = () => new NotConfiguredConnector("bamboohr", "BambooHR");
export const PaylocityConnector = () => new NotConfiguredConnector("paylocity", "Paylocity");
export const SuccessFactorsConnector = () => new NotConfiguredConnector("successfactors", "SAP SuccessFactors");
