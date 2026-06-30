import {
  BarChart3,
  CalendarClock,
  CheckSquare,
  DollarSign,
  FileText,
  Files,
  LayoutDashboard,
  LifeBuoy,
  Network,
  Scale,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "../store.js";
import { visibleModules } from "../rbac.js";

/** Icon per module id — kept here (presentation) so rbac.ts stays icon-free. */
const ICONS: Record<string, LucideIcon> = {
  command_center: LayoutDashboard,
  service_desk: LifeBuoy,
  tasks: CheckSquare,
  people: Users,
  org: Network,
  leave: CalendarClock,
  er: Scale,
  comp: DollarSign,
  jd: FileText,
  metrics: BarChart3,
  documents: Files,
  audit: ScrollText,
  admin: Settings,
};

export function Sidebar() {
  const role = useApp((s) => s.role);
  const active = useApp((s) => s.activeModule);
  const setModule = useApp((s) => s.setModule);
  const mods = visibleModules(role);
  const groups = ["Work", "People", "Insight", "Admin"] as const;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-brand-navy text-sm font-bold text-white shadow-card">HR</div>
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tightish text-ink">HR OS</div>
          <div className="text-2xs uppercase tracking-wider text-muted">Building on Trust</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((g) => {
          const items = mods.filter((m) => m.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g} className="mb-3">
              <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-muted">{g}</div>
              {items.map((m) => {
                const Icon = ICONS[m.id] ?? LayoutDashboard;
                const on = active === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setModule(m.id)}
                    aria-current={on ? "page" : undefined}
                    className={`relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-fast ease-out ${
                      on ? "bg-brand-navy/10 font-semibold text-brand-navy" : "text-ink hover:bg-ink/5"
                    }`}
                  >
                    {on && <span className="absolute inset-y-1 left-0 w-0.5 rounded-pill bg-brand-navy" aria-hidden />}
                    <Icon size={16} strokeWidth={on ? 2.5 : 2} aria-hidden />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
