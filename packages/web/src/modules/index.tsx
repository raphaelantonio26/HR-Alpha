import { lazy, Suspense, type ComponentType } from "react";
import { EmptyState, Spinner } from "../components/ui.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";

/**
 * Module host. Wired surfaces are LAZY-LOADED (code-split) so the initial bundle
 * stays small and each surface is its own chunk; the rest are designed empty-states
 * for later phases. Every surface renders inside an ErrorBoundary + Suspense so a
 * slow import shows a spinner and a thrown render is contained (Toyota baseline).
 */
const CommandCenter = lazy(() => import("./CommandCenter.js").then((m) => ({ default: m.CommandCenter })));
const People = lazy(() => import("./People.js").then((m) => ({ default: m.People })));
const Leave = lazy(() => import("./Leave.js").then((m) => ({ default: m.Leave })));
const Comp = lazy(() => import("./Comp.js").then((m) => ({ default: m.Comp })));

const Stub = (title: string, body: string, next: string): ComponentType => () => <EmptyState title={title} body={body} next={next} />;

export const MODULE_COMPONENTS: Record<string, ComponentType> = {
  command_center: CommandCenter,
  people: People,
  leave: Leave,
  comp: Comp,
  er: Stub("Employee Relations", "Investigation cases, the deterministic risk engine, statute leads, and cross-case patterns — privileged and access-scoped.", "wire ER engine UI (engine is built & tested)"),
  service_desk: Stub("HR Service Desk", "Employee tickets, knowledge base, and SLA tracking with AI-assisted draft replies a human approves.", "build ticketing surface"),
  tasks: Stub("Tasks & Approvals", "A unified queue of approvals, designations, and follow-ups across every module.", "build approvals queue"),
  org: Stub("Org & Headcount", "Tidy-tree org chart from manager_id, span-of-control flags, and two-pillar HRBP coverage planning.", "wire org engine UI (engine is built & tested)"),
  jd: Stub("Job Descriptions", "Trade-aware JD generation with the Senior-Recruiter agent; EEO footer on every export.", "wire JD engine UI (engine is built & tested)"),
  metrics: Stub("Metrics Studio", "Governed semantic metrics with small-cell suppression and an AI builder that never touches raw PII.", "build metrics studio surface"),
  documents: Stub("Documents", "Branded letter and packet generation in EN / Mexican Spanish from canonical data.", "build document generator"),
  audit: Stub("Audit Trail", "The append-only, tamper-evident record of every mutation and AI dispatch, filterable by actor and entity.", "build audit viewer over audit_log"),
  admin: Stub("Settings & Connectors", "Tenant configuration, RBAC, rule-pack versions, and HRIS connector setup (ADP WFN today).", "build connector admin"),
};

export function ModuleHost({ id }: { id: string }) {
  const Active = MODULE_COMPONENTS[id] ?? CommandCenter;
  return (
    <ErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <Active />
      </Suspense>
    </ErrorBoundary>
  );
}
