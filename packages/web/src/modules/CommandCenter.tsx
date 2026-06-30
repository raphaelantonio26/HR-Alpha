import { useState } from "react";
import { Card, Stat, Sparkline, Pill } from "../components/ui.js";
import { useApp } from "../store.js";
import { useApiData } from "../hooks.js";
import { api } from "../api.js";

/**
 * Command Center — live headcount from /people where the role permits, plus an AI
 * assist that streams from the server gateway. When no model key is configured the
 * gateway emits a labeled fallback and this panel SHOWS that the result is local
 * (graceful degradation, invariant #7). Only PII-free counts are ever sent.
 */
export function CommandCenter() {
  const role = useApp((s) => s.role);
  const people = useApiData(() => api.getPeople(role), [role]);

  const rows = people.data?.rows ?? [];
  const active = rows.filter((w) => w.status === "active").length;
  const onLeave = rows.filter((w) => w.status === "leave").length;
  const liveOk = !people.loading && !people.error && people.data != null;
  const hint = people.error ? "live counts not available for role" : people.loading ? "loading…" : "live";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Roster (this tenant)" value={liveOk ? String(rows.length) : "—"} hint={hint} />
        <Stat label="Active" value={liveOk ? String(active) : "—"} hint={hint} />
        <Stat label="On leave" value={liveOk ? String(onLeave) : "—"} hint={hint} />
        <Stat label="Open ER cases" value="0" hint="ER surface: next phase" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Workforce trend (illustrative)">
          <div className="flex items-end justify-between">
            <Sparkline values={[230, 232, 231, 235, 236, 238]} width={220} height={48} />
            <Pill tone="good">trend</Pill>
          </div>
          <p className="mt-2 text-xs text-muted">Trend series is illustrative until the metrics layer is wired (next phase).</p>
        </Card>
        <AiAssist role={role} facts={{ rosterCount: rows.length, activeCount: active, onLeaveCount: onLeave }} liveOk={liveOk} />
      </div>
    </div>
  );
}

function AiAssist({ role, facts, liveOk }: { role: string; facts: Record<string, number>; liveOk: boolean }) {
  const [text, setText] = useState("");
  const [degraded, setDegraded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    setBusy(true); setText(""); setDegraded(false); setErr(null);
    try {
      await api.aiDispatch(role as never, { purpose: "dashboard_assist", facts, enableWebSearch: false }, (ev, data) => {
        if (ev === "fallback") setDegraded(true);
        else if (ev === "text") setText((t) => t + (data as { text: string }).text);
        else if (ev === "error") setErr(`AI request rejected (HTTP ${(data as { status: number }).status}).`);
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Deterministic local summary shown when the model is unavailable (the gateway's
  // labeled fallback). This is computed locally from non-PII counts, never invented.
  const localSummary = liveOk
    ? `${facts.rosterCount} workers in scope; ${facts.activeCount} active, ${facts.onLeaveCount} on leave. Review pending leave designations first.`
    : "Sign in with a role that can read people to summarize the roster.";

  return (
    <Card title="Attention queue + AI assist">
      <ul className="space-y-2 text-sm">
        <li className="flex items-center justify-between"><span>Leave designation pending</span><Pill tone="warn">await designation</Pill></li>
        <li className="flex items-center justify-between"><span>Bands awaiting lock</span><Pill tone="muted">governance</Pill></li>
      </ul>
      <div className="mt-3 border-t border-line pt-3">
        <button onClick={ask} disabled={busy} className="rounded bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "Working…" : "Summarize with AI"}
        </button>
        {degraded && (
          <div className="mt-3 rounded border border-warn/40 bg-warn/5 p-3">
            <Pill tone="warn">Running locally — AI unavailable</Pill>
            <p className="mt-2 text-sm text-ink">{localSummary}</p>
            <p className="mt-1 text-xs text-muted">No model key is configured, so this summary was generated locally and deterministically.</p>
          </div>
        )}
        {text && !degraded && <p className="mt-3 text-sm text-ink">{text}</p>}
        {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}
      </div>
    </Card>
  );
}
