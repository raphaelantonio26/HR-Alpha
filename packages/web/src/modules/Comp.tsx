import { useState } from "react";
import { Card, Pill, Stat, Async, EmptyState, SkeletonTable } from "../components/ui.js";
import { useApp } from "../store.js";
import { useApiData } from "../hooks.js";
import { api, type CompRow, type BandRow } from "../api.js";
import { comp } from "@hr-os/core";
import type { PayBand } from "@hr-os/contracts";

/**
 * Compensation — LIVE persisted comp records + governed bands (comp.read gates the
 * whole surface; non-comp roles get a clear "not available" state). Placement is
 * computed by the pure engine against the SELECTED persisted band. No market data
 * is invented; bands are operator inputs with a lock-before-payroll workflow.
 */
function bandFromRow(b: BandRow): PayBand {
  return {
    unit: b.unit === "annual" ? "annual" : "hourly",
    p10: b.p10 ?? undefined, p25: b.p25 ?? undefined, p50: b.p50 ?? undefined,
    p75: b.p75 ?? undefined, p90: b.p90 ?? undefined,
    confidence: b.confidence ?? undefined, locked: b.locked,
  };
}

export function Comp() {
  const role = useApp((s) => s.role);
  const records = useApiData(() => api.getCompRecords(role), [role]);
  const bands = useApiData(() => api.getBands(role), [role]);
  const [pay, setPay] = useState(41);
  const [bandIdx, setBandIdx] = useState(0);

  return (
    <div className="space-y-4">
      <Card title="Pay-band placement (live engine · persisted band)">
        <Async
          state={bands}
          isEmpty={(d) => d.rows.length === 0}
          empty={<EmptyState title="No pay bands yet" body="Persist a governed band (P25 anchor) to place rates against it." next="POST a band, then lock it before payroll" />}
        >
          {(d) => {
            const row = d.rows[Math.min(bandIdx, d.rows.length - 1)];
            if (!row) return null;
            const band = bandFromRow(row);
            const placement = comp.placeAgainstBand(pay, "hourly", band);
            const toneFor = (p: string) => (p === "Below Band" ? "bad" : p === "Above Band" ? "warn" : "good");
            return (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm">Band
                    <select value={bandIdx} onChange={(e) => setBandIdx(Number(e.target.value))} className="ml-2 rounded border border-line bg-surface px-2 py-1.5">
                      {d.rows.map((b, i) => <option key={b.id} value={i}>{b.title_key}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Hourly rate
                    <input type="number" value={pay} onChange={(e) => setPay(Number(e.target.value))} className="ml-2 w-28 rounded border border-line bg-surface px-2 py-1.5" />
                  </label>
                  <span className="text-xs text-muted">P25–P75 ${row.p25}–${row.p75}/hr · conf {comp.confidenceLabel(row.confidence)}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Compa-ratio" value={placement.compaRatio ? placement.compaRatio.toFixed(2) : "—"} />
                  <Stat label="Percentile" value={placement.percentileRank != null ? `P${placement.percentileRank}` : "—"} />
                  <Stat label="Penetration" value={placement.penetration != null ? `${Math.round(placement.penetration * 100)}%` : "—"} />
                  <Stat label="To minimum" value={placement.toMinimum ? `$${placement.toMinimum.toFixed(2)}` : "$0.00"} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Pill tone={toneFor(placement.placement)}>{placement.placement}</Pill>
                  <Pill tone="muted">{placement.zone}</Pill>
                  {row.locked ? <Pill tone="good">band locked</Pill> : <Pill tone="warn">band unlocked</Pill>}
                </div>
              </>
            );
          }}
        </Async>
      </Card>

      <Card title="Compensation records (live)">
        <Async
          state={records}
          loadingFallback={<SkeletonTable rows={6} cols={5} />}
          isEmpty={(d) => d.rows.length === 0}
          empty={<EmptyState title="No compensation records" body="Persist pay records to populate this view." next="POST /comp/records" />}
        >
          {(d) => (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr><th scope="col" className="py-2">Employee</th><th scope="col">Title</th><th scope="col" className="text-right">Rate</th><th scope="col">Unit</th><th scope="col" className="text-right">Hrs (12mo)</th></tr>
              </thead>
              <tbody>
                {d.rows.map((r: CompRow) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-2">{r.last_name}</td>
                    <td>{r.title ?? "—"}</td>
                    <td className="text-right font-mono">${Number(r.amount).toFixed(2)}</td>
                    <td>{r.unit}</td>
                    <td className="text-right font-mono">{r.hours_worked_12mo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Async>
      </Card>
    </div>
  );
}
