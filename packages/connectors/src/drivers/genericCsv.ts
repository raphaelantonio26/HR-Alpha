/**
 * Generic CSV driver (§3.3). The universal fallback when no native API exists.
 * Maps a header->canonical column mapping and neutralizes every cell against
 * formula injection on the way in. Read-only; feeds the sync pipeline.
 */
import type { CompensationRecord, Worker } from "@hr-os/contracts";
import type { Connector, FieldMapEntry, RosterSnapshot, VerifyResult, WriteBackResult } from "../interface.js";
import { neutralizeRow } from "../csvGuard.js";

export class GenericCsvConnector implements Connector {
  readonly id = "csv";
  readonly label = "Generic CSV";
  readonly readOnly = true;

  constructor(
    private readonly rows: Array<Record<string, string>>,
    private readonly map: Record<string, keyof Worker>,
    private readonly tenantId: string,
  ) {}

  async verify(): Promise<VerifyResult> {
    const headerOk = this.rows.length === 0 || Object.keys(this.map).every((h) => h in (this.rows[0] ?? {}));
    return { ok: headerOk, capabilities: ["read:csv"], errors: headerOk ? [] : ["header/map mismatch"] };
  }

  async fetchRoster(_tenantId: string): Promise<RosterSnapshot> {
    const workers: Worker[] = this.rows.map((raw, i) => {
      const safe = neutralizeRow(raw);
      const w: Record<string, unknown> = { id: `csv-${i}`, tenantId: this.tenantId };
      for (const [header, canonical] of Object.entries(this.map)) w[canonical as string] = safe[header];
      return w as unknown as Worker;
    });
    return { workers, positions: [], worksites: [], managerEdges: [] };
  }

  async fetchCompensation(): Promise<CompensationRecord[]> {
    return [];
  }

  async writeBack(): Promise<WriteBackResult> {
    return { applied: 0, skipped: 0, errors: ["writeback unsupported for CSV"] };
  }

  describeFieldMap(): FieldMapEntry[] {
    return Object.entries(this.map).map(([source, canonical]) => ({ canonical: String(canonical), source, required: false }));
  }
}
