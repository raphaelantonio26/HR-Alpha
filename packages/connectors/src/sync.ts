/**
 * Sync pipeline (§3.3). Every sync is validate -> diff -> commit and is
 * idempotent: re-running the same source produces NO changes. Safety rules:
 *  - A blank/absent incoming value NEVER erases existing data (clears require an
 *    explicit tombstone, not an empty cell).
 *  - Field-level provenance: every applied change records its source
 *    (adp_wfn | csv | scim | manual | seed) for the audit trail.
 *  - Drivers fail safe: a validation failure aborts the commit; the prior state
 *    (last-known-good) is preserved.
 */
import type { SyncSource, Worker } from "@hr-os/contracts";
import { zWorker } from "@hr-os/contracts";

export interface FieldChange {
  workerId: string;
  field: string;
  from: string | number | null;
  to: string | number | null;
  source: SyncSource;
}

export interface DiffResult {
  creates: Worker[];
  changes: FieldChange[];
  /** Incoming rows that failed validation; the commit is aborted if non-empty. */
  invalid: Array<{ index: number; errors: string[] }>;
}

const TRACKED: Array<keyof Worker> = [
  "firstName",
  "lastName",
  "status",
  "worksiteId",
  "positionId",
  "managerId",
  "employmentType",
  "hireDate",
  "hoursPerWeek",
];

const isBlank = (v: unknown): boolean => v == null || v === "";

/**
 * Compute the diff between current workers and an incoming snapshot. Pure: makes
 * no writes. Blanks in the incoming row are skipped (never erase).
 */
export function diffWorkers(
  current: Worker[],
  incoming: unknown[],
  source: SyncSource,
): DiffResult {
  const byFile = new Map(current.map((w) => [`${w.tenantId}:${w.fileNumber}`, w]));
  const creates: Worker[] = [];
  const changes: FieldChange[] = [];
  const invalid: DiffResult["invalid"] = [];

  incoming.forEach((raw, index) => {
    const parsed = zWorker.safeParse(raw);
    if (!parsed.success) {
      invalid.push({ index, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    const w = parsed.data;
    const key = `${w.tenantId}:${w.fileNumber}`;
    const existing = byFile.get(key);
    if (!existing) {
      creates.push(w as Worker);
      return;
    }
    for (const field of TRACKED) {
      const next = w[field];
      if (isBlank(next)) continue; // blank never erases
      const prev = existing[field];
      if (String(prev ?? "") !== String(next ?? "")) {
        changes.push({
          workerId: existing.id,
          field: String(field),
          from: (prev ?? null) as string | number | null,
          to: (next ?? null) as string | number | null,
          source,
        });
      }
    }
  });

  return { creates, changes, invalid };
}

export interface CommitOutcome {
  committed: boolean;
  created: number;
  changed: number;
  reason?: string;
}

/**
 * Commit a diff via an injected, actor-scoped writer (so RLS + the audit trigger
 * apply). Aborts atomically if any row failed validation — last-known-good stands.
 */
export async function commitDiff(
  diff: DiffResult,
  writer: {
    createWorker: (w: Worker) => Promise<void>;
    applyChange: (c: FieldChange) => Promise<void>;
  },
): Promise<CommitOutcome> {
  if (diff.invalid.length > 0) {
    return { committed: false, created: 0, changed: 0, reason: `validation_failed:${diff.invalid.length}` };
  }
  for (const w of diff.creates) await writer.createWorker(w);
  for (const c of diff.changes) await writer.applyChange(c);
  return { committed: true, created: diff.creates.length, changed: diff.changes.length };
}
