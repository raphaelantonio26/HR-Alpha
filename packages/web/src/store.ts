/** Global UI state (zustand): tenant/worksite filter, acting role, theme, nav. */
import { create } from "zustand";
import type { Role } from "@hr-os/contracts";

type Theme = "light" | "dark";

/** Build-time profile flag. Profile D sets VITE_DEMO_MODE=true (see DEPLOY-AZURE.md). */
export const isDemo: boolean =
  (import.meta as unknown as { env?: { VITE_DEMO_MODE?: string } }).env?.VITE_DEMO_MODE === "true";

interface AppState {
  tenant: string;
  worksite: string; // "all" or a worksite id
  role: Role;
  theme: Theme;
  activeModule: string;
  paletteOpen: boolean;
  entered: boolean; // demo front door: false until a role is chosen (always true outside demo)
  setWorksite: (w: string) => void;
  setRole: (r: Role) => void;
  setModule: (m: string) => void;
  togglePalette: (open?: boolean) => void;
  toggleTheme: () => void;
  enter: () => void;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("hros-theme", theme);
  } catch {
    /* storage may be unavailable; in-memory state still drives the UI */
  }
}

const initialTheme: Theme = document.documentElement.classList.contains("dark") ? "dark" : "light";

export const useApp = create<AppState>((set, get) => ({
  tenant: "AMPAM",
  worksite: "all",
  role: "administrator",
  theme: initialTheme,
  activeModule: "command_center",
  paletteOpen: false,
  entered: !isDemo,
  setWorksite: (worksite) => set({ worksite }),
  setRole: (role) => set({ role }),
  setModule: (activeModule) => set({ activeModule, paletteOpen: false }),
  togglePalette: (open) => set({ paletteOpen: open ?? !get().paletteOpen }),
  toggleTheme: () => {
    const theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    set({ theme });
  },
  enter: () => set({ entered: true }),
}));
