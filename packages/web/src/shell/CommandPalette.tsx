import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useApp } from "../store.js";
import { visibleModules } from "../rbac.js";

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const toggle = useApp((s) => s.togglePalette);
  const role = useApp((s) => s.role);
  const setModule = useApp((s) => s.setModule);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") toggle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  if (!open) return null;
  const results = visibleModules(role).filter((m) => m.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => toggle(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a module"
        className="u-enter w-full max-w-lg overflow-hidden rounded-card border border-line bg-elevated shadow-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} strokeWidth={2.25} className="text-muted" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a module…"
            aria-label="Search modules"
            className="w-full bg-transparent py-3 text-sm text-ink outline-none"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-2">
          {results.map((m) => (
            <li key={m.id}>
              <button onClick={() => setModule(m.id)} className="block w-full rounded-md px-3 py-2 text-left text-sm text-ink transition-colors duration-fast hover:bg-brand-navy/10">
                <span className="text-muted">{m.group}</span> · {m.label}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}
