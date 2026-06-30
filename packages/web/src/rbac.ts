/** Which modules a role may see in the shell (mirrors server rbac matrix). */
import type { Role } from "@hr-os/contracts";

export interface ModuleDef {
  id: string;
  label: string;
  group: "Work" | "People" | "Insight" | "Admin";
}

export const MODULES: ModuleDef[] = [
  { id: "command_center", label: "Command Center", group: "Work" },
  { id: "service_desk", label: "HR Service Desk", group: "Work" },
  { id: "tasks", label: "Tasks & Approvals", group: "Work" },
  { id: "people", label: "People", group: "People" },
  { id: "org", label: "Org & Headcount", group: "People" },
  { id: "leave", label: "Leave", group: "People" },
  { id: "er", label: "Employee Relations", group: "People" },
  { id: "comp", label: "Compensation", group: "Insight" },
  { id: "jd", label: "Job Descriptions", group: "Insight" },
  { id: "metrics", label: "Metrics Studio", group: "Insight" },
  { id: "documents", label: "Documents", group: "Insight" },
  { id: "audit", label: "Audit Trail", group: "Admin" },
  { id: "admin", label: "Settings & Connectors", group: "Admin" },
];

const VISIBILITY: Record<Role, string[] | "all"> = {
  administrator: "all",
  hrbp: ["command_center", "service_desk", "tasks", "people", "org", "leave", "er", "documents", "metrics"],
  comp_analyst: ["command_center", "people", "comp", "jd", "metrics"],
  people_manager: ["command_center", "people", "org", "leave", "tasks"],
  legal_compliance: ["command_center", "people", "er", "leave", "documents", "audit"],
  employee: ["service_desk", "leave"],
  anonymous: [],
};

export function visibleModules(role: Role): ModuleDef[] {
  const v = VISIBILITY[role];
  if (v === "all") return MODULES;
  return MODULES.filter((m) => v.includes(m.id));
}
