import { useState } from "react";
import {
  ArrowRight,
  DollarSign,
  Scale,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@hr-os/contracts";
import { useApp } from "../store.js";
import { Button } from "../components/ui.js";

/** The five roles the demo minter will issue a session for (employee is excluded). */
const DEMO_ROLES: Array<{ id: Role; label: string; blurb: string; icon: LucideIcon }> = [
  { id: "administrator", label: "Administrator", blurb: "Full access across every module.", icon: UserCog },
  { id: "hrbp", label: "HR Business Partner", blurb: "People, leave, ER, and the service desk.", icon: Users },
  { id: "comp_analyst", label: "Compensation Analyst", blurb: "Compensation, bands, and metrics.", icon: DollarSign },
  { id: "people_manager", label: "People Manager", blurb: "Your team: people, leave, approvals.", icon: Scale },
  { id: "legal_compliance", label: "Legal & Compliance", blurb: "ER, the audit trail, and documents.", icon: ShieldCheck },
];

export function DemoGate() {
  const setRole = useApp((s) => s.setRole);
  const enter = useApp((s) => s.enter);
  const [picked, setPicked] = useState<Role>("administrator");

  const go = () => {
    setRole(picked);
    enter();
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10">
      <div className="u-enter w-full max-w-xl">
        {/* Brand mark + thesis */}
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-card bg-brand-navy text-base font-bold text-white shadow-card">HR</div>
          <div className="leading-tight">
            <div className="text-xl font-bold tracking-tightish text-ink">HR OS</div>
            <div className="text-2xs uppercase tracking-wider text-muted">Building on a Foundation of Trust</div>
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-6 shadow-card">
          <h1 className="text-lg font-bold tracking-tightish text-ink">Explore the demo</h1>
          <p className="mt-1 text-sm text-muted">
            A unified HR operating system for construction. Pick a role to see exactly what that
            person can — and cannot — reach. Access is enforced at the data layer, not just hidden in the UI.
          </p>

          {/* Synthetic-data notice — every record in the demo is fabricated. */}
          <div className="mt-4 flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-pill bg-warn" aria-hidden />
            <p className="text-xs text-ink">
              <span className="font-semibold">Demo data is entirely synthetic.</span> Every name, number, and case is
              fabricated (Sample / .example). No real employee or customer information appears anywhere.
            </p>
          </div>

          {/* Role picker */}
          <div className="mt-5">
            <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">Enter as</div>
            <div role="radiogroup" aria-label="Choose a role" className="grid gap-2 sm:grid-cols-2">
              {DEMO_ROLES.map(({ id, label, blurb, icon: Icon }) => {
                const on = picked === id;
                return (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPicked(id)}
                    className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors duration-fast ease-out ${
                      on ? "border-brand-navy bg-brand-navy/10 ring-1 ring-brand-navy" : "border-line hover:bg-ink/5"
                    }`}
                  >
                    <Icon size={18} strokeWidth={2.25} className={on ? "mt-0.5 text-brand-navy" : "mt-0.5 text-muted"} aria-hidden />
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${on ? "text-brand-navy" : "text-ink"}`}>{label}</span>
                      <span className="block text-xs text-muted">{blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-2xs text-muted">You can switch roles anytime from the top bar.</span>
            <Button variant="primary" onClick={go}>
              Enter the demo
              <ArrowRight size={15} strokeWidth={2.5} aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
