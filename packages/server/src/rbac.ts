/**
 * RBAC + field-masking policy. Roles are a tenant-editable baseline (§3.7).
 * Field masking is a DB read-path concern enforced by RLS/secure views; this map
 * is the single source of truth the views and the API both consult, so the UI is
 * never the only thing standing between a role and a sensitive field.
 */
import type { Role } from "@hr-os/contracts";

export type Permission =
  | "people.read"
  | "people.write"
  | "comp.read"
  | "comp.write"
  | "leave.read"
  | "leave.write"
  | "er.read"
  | "er.write"
  | "metrics.read"
  | "admin";

const MATRIX: Record<Role, Permission[]> = {
  administrator: ["people.read", "people.write", "comp.read", "comp.write", "leave.read", "leave.write", "er.read", "er.write", "metrics.read", "admin"],
  hrbp: ["people.read", "people.write", "leave.read", "leave.write", "er.read", "er.write", "metrics.read"],
  comp_analyst: ["people.read", "comp.read", "comp.write", "metrics.read"],
  people_manager: ["people.read", "leave.read", "metrics.read"],
  legal_compliance: ["people.read", "er.read", "leave.read", "metrics.read"],
  employee: ["leave.read"],
  anonymous: [],
};

/** Fields a role must NEVER receive (masked at the DB read path). */
const MASKED_FIELDS: Record<Role, string[]> = {
  administrator: [],
  hrbp: [],
  comp_analyst: [],
  people_manager: ["amount", "unit", "compaRatio", "governmentId"],
  legal_compliance: ["amount", "unit", "governmentId"],
  employee: ["amount", "unit", "compaRatio", "governmentId", "managerId"],
  anonymous: ["*"],
};

export function can(role: Role, perm: Permission): boolean {
  return MATRIX[role]?.includes(perm) ?? false;
}

export function maskedFields(role: Role): string[] {
  return MASKED_FIELDS[role] ?? ["*"];
}
