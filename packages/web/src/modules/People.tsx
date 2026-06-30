import { Card, Pill, Async, EmptyState, SkeletonTable } from "../components/ui.js";
import { useApp } from "../store.js";
import { useApiData } from "../hooks.js";
import { api, type PersonRow } from "../api.js";

/**
 * People directory — LIVE roster from /people (RLS-scoped to the tenant). Pay is
 * masked at the read path: for masked roles the server omits it entirely, so the
 * column simply isn't available here (not merely hidden). Role switch refetches.
 */
export function People() {
  const role = useApp((s) => s.role);
  const state = useApiData(() => api.getPeople(role), [role]);

  return (
    <Card title="People directory">
      <Async
        state={state}
        loadingFallback={<SkeletonTable rows={6} cols={5} />}
        isEmpty={(d) => d.rows.length === 0}
        empty={<EmptyState title="No people yet" body="This tenant has no worker records. Seed the demo tenant or import a roster." next="run npm run seed, or set up the ADP connector" />}
      >
        {(d) => (
          <>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="py-2">File #</th>
                  <th scope="col">Name</th>
                  <th scope="col">Title</th>
                  <th scope="col">Worksite</th>
                  <th scope="col">Status</th>
                  {d.payVisible && <th scope="col" className="text-right">Rate</th>}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((w: PersonRow) => (
                  <tr key={w.id} className="border-t border-line">
                    <td className="py-2 font-mono text-xs">{w.file_number}</td>
                    <td>{w.first_name} {w.last_name}</td>
                    <td>{w.title ?? "—"}</td>
                    <td>{w.worksite ?? "—"}</td>
                    <td>{w.status === "leave" ? <Pill tone="warn">leave</Pill> : w.status === "terminated" ? <Pill tone="bad">terminated</Pill> : <Pill tone="good">active</Pill>}</td>
                    {d.payVisible && (
                      <td className="text-right font-mono">
                        {w.pay != null ? `$${Number(w.pay).toFixed(2)}${w.pay_unit === "annual" ? "/yr" : "/hr"}` : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.payVisible && (
              <p className="mt-3 text-xs text-muted">
                Pay is masked for your role — it is omitted at the data layer, not just hidden here.
              </p>
            )}
          </>
        )}
      </Async>
    </Card>
  );
}
