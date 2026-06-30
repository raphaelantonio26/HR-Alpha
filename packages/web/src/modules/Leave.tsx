import { useState } from "react";
import { Card, Pill, Stat, Async, EmptyState, SkeletonTable } from "../components/ui.js";
import { useApp } from "../store.js";
import { useApiData } from "../hooks.js";
import { api, type LeaveCaseRow } from "../api.js";

/**
 * Leave — LIVE persisted cases (RLS-scoped) plus the pure-engine eligibility
 * calculator. await-designation is honored as a first-class state: a case with no
 * designation runs no clocks and is labeled, never silently defaulted.
 */
export function Leave() {
  const role = useApp((s) => s.role);
  const cases = useApiData(() => api.getLeaveCases(role), [role]);

  const [hireDate, setHireDate] = useState("2024-01-01");
  const [hours, setHours] = useState(1400);
  const [reason, setReason] = useState("serious_health");
  const [elig, setElig] = useState<{ eligible: boolean; tenureMonths: number; hoursLast12mo: number; reasons: { tenure: boolean; hours: boolean } } | null>(null);
  const [clocks, setClocks] = useState<string[] | null>(null);
  const [calcErr, setCalcErr] = useState<string | null>(null);

  async function runCalc() {
    setCalcErr(null);
    try {
      const r = await api.eligibility(role, {
        workerId: "00000000-0000-4000-8000-000000000000",
        reasonId: reason, designation: null, startDate: null, endDate: null,
        jurisdiction: "US-CA", hireDate, hoursWorked12mo: hours,
      });
      setElig(r.eligibility);
      setClocks(r.suggestedClocks);
    } catch (e) {
      setCalcErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Leave cases (live)">
        <Async
          state={cases}
          loadingFallback={<SkeletonTable rows={6} cols={6} />}
          isEmpty={(d) => d.rows.length === 0}
          empty={<EmptyState title="No leave cases" body="Intake a leave case to begin tracking entitlements." next="POST /leave/cases" />}
        >
          {(d) => (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr><th scope="col" className="py-2">Employee</th><th scope="col">Reason</th><th scope="col">Designation</th><th scope="col">Status</th><th scope="col">Priority</th></tr>
              </thead>
              <tbody>
                {d.rows.map((c: LeaveCaseRow) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-2">{c.last_name}</td>
                    <td>{c.reason_id}</td>
                    <td>
                      {c.designation && c.designation.length
                        ? c.designation.map((x) => <Pill key={x} tone="brand">{x}</Pill>)
                        : <Pill tone="warn">await designation</Pill>}
                    </td>
                    <td>{c.status === "open" ? <Pill tone="good">open</Pill> : <Pill tone="muted">{c.status}</Pill>}</td>
                    <td>{c.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Async>
      </Card>

      <Card title="Eligibility check (live engine)">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Hire date
            <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface px-2 py-1.5" />
          </label>
          <label className="text-sm">Hours (trailing 12mo)
            <input type="number" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="mt-1 w-full rounded border border-line bg-surface px-2 py-1.5" />
          </label>
          <label className="text-sm">Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded border border-line bg-surface px-2 py-1.5">
              <option value="serious_health">Employee serious health</option>
              <option value="family_care">Family care</option>
              <option value="bonding">Baby bonding</option>
              <option value="pregnancy_disability">Pregnancy disability</option>
            </select>
          </label>
        </div>
        <button onClick={runCalc} className="mt-3 rounded bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
          Check eligibility
        </button>
        {calcErr && <p role="alert" className="mt-2 text-sm text-bad">{calcErr}</p>}
        {elig && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Tenure" value={`${elig.tenureMonths} mo`} hint={elig.reasons.tenure ? "meets 12mo" : "under 12mo"} />
              <Stat label="Hours" value={String(elig.hoursLast12mo)} hint={elig.reasons.hours ? "meets 1,250" : "under 1,250"} />
              <Stat label="Eligible" value={elig.eligible ? "Yes" : "No"} />
              <Stat label="Suggested clocks" value={clocks && clocks.length ? clocks.join(" + ") : "await"} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-muted">Suggested clocks:</span>
              {clocks && clocks.length ? clocks.map((c) => <Pill key={c} tone="brand">{c}</Pill>) : <Pill tone="warn">await designation</Pill>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
