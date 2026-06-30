import { Sidebar } from "./Sidebar.js";
import { Topbar } from "./Topbar.js";
import { CommandPalette } from "./CommandPalette.js";
import { ModuleHost } from "../modules/index.js";
import { useApp, isDemo } from "../store.js";
import { visibleModules } from "../rbac.js";

export function Shell() {
  const active = useApp((s) => s.activeModule);
  const role = useApp((s) => s.role);
  const label = visibleModules(role).find((m) => m.id === active)?.label ?? "HR OS";
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {isDemo && (
          <div className="flex items-center justify-center gap-2 bg-brand-navy/10 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wider text-brand-navy">
            <span className="h-1.5 w-1.5 rounded-pill bg-brand-navy" aria-hidden />
            Demo — every record is synthetic
          </div>
        )}
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-bg">
          <div className="mx-auto max-w-screen-2xl p-5 sm:p-6">
            <h1 className="mb-4 text-xl font-bold tracking-tightish text-ink">{label}</h1>
            {/* key on the active module so each surface re-runs its entrance. */}
            <div key={active} className="u-enter">
              <ModuleHost id={active} />
            </div>
          </div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
