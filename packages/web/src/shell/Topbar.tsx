import { Moon, Search, Sun } from "lucide-react";
import { useApp } from "../store.js";
import { WORKSITES } from "../seed.js";
import type { Role } from "@hr-os/contracts";

const ROLES: Role[] = ["administrator", "hrbp", "comp_analyst", "people_manager", "legal_compliance", "employee"];

export function Topbar() {
  const { worksite, setWorksite, role, setRole, theme, toggleTheme, togglePalette } = useApp();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/85 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <button
        onClick={() => togglePalette(true)}
        className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors duration-fast ease-out hover:bg-ink/5"
      >
        <Search size={15} strokeWidth={2.25} aria-hidden />
        <span>Search</span>
        <kbd className="ml-1">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <select
          value={worksite}
          onChange={(e) => setWorksite(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink transition-colors duration-fast hover:bg-ink/5"
          aria-label="Worksite filter"
        >
          <option value="all">All worksites</option>
          {WORKSITES.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink transition-colors duration-fast hover:bg-ink/5"
          aria-label="Acting role"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace("_", " ")}
            </option>
          ))}
        </select>
        <button
          onClick={toggleTheme}
          className="grid h-8 w-8 place-items-center rounded-md border border-line text-ink transition-colors duration-fast ease-out hover:bg-ink/5"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Moon size={15} strokeWidth={2.25} aria-hidden /> : <Sun size={15} strokeWidth={2.25} aria-hidden />}
        </button>
      </div>
    </header>
  );
}
