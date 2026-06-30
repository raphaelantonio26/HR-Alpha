/**
 * Accessibility gate (axe-core) for the wired surfaces. Runs against the real
 * component DOM rendered in jsdom, with fetch mocked to return synthetic
 * Sample/.example data so the POPULATED surfaces are what gets audited (and the
 * empty / error states too). Asserts zero serious/critical violations.
 *
 * Scope note: jsdom cannot evaluate layout-dependent rules (notably color-contrast),
 * so axe skips them here; full browser-based axe (incl. contrast) is the scheduled
 * Phase E Playwright+axe run. Brand tokens were chosen for WCAG 2.2 AA contrast.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { People } from "../modules/People.js";
import { Comp } from "../modules/Comp.js";
import { Leave } from "../modules/Leave.js";
import { CommandCenter } from "../modules/CommandCenter.js";
import { EmptyState, ErrorState } from "../components/ui.js";
import { ApiError } from "../api.js";

const PEOPLE = {
  payVisible: true,
  masked: [],
  rows: [
    { id: "1", file_number: "000101", first_name: "Sample", last_name: "Alvarez", status: "active", worksite: "Carson HQ", title: "Project Manager", employment_type: "open_shop", pay: 135000, pay_unit: "annual" },
    { id: "2", file_number: "000105", first_name: "Sample", last_name: "Rivera", status: "leave", worksite: "El Cajon", title: "Low Voltage Technician", employment_type: "open_shop", pay: 36, pay_unit: "hourly" },
  ],
};
const COMP = { rows: [{ id: "c1", last_name: "Alvarez", title: "Project Manager", amount: 135000, unit: "annual", effective_date: "2025-01-01", hours_worked_12mo: 2080 }] };
const BANDS = { rows: [{ id: "b1", title_key: "journeyman_electrician", unit: "hourly", p10: 30, p25: 36, p50: 42, p75: 50, p90: 58, confidence: 72, locked: true }] };
const LEAVE = { rows: [{ id: "l1", worker_id: "2", first_name: "Sample", last_name: "Rivera", reason_id: "serious_health", designation: null, status: "intake", start_date: "2026-05-27", end_date: null, intermittent: false, priority: "High", jurisdiction: "US-CA" }] };

function mockFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
    if (u.includes("/auth/dev-token")) return ok({ token: "dev.jwt.token", role: "administrator", tenantId: "t" });
    if (u.includes("/people")) return ok(PEOPLE);
    if (u.includes("/comp/records")) return ok(COMP);
    if (u.includes("/comp/bands")) return ok(BANDS);
    if (u.includes("/leave/cases")) return ok(LEAVE);
    return ok({});
  }));
}

async function settle() {
  // allow the useApiData effect + mocked fetch microtasks to resolve
  await new Promise((r) => setTimeout(r, 30));
}

async function noSeriousCritical(container: HTMLElement) {
  const results = await axe.run(container, {
    resultTypes: ["violations"],
    // color-contrast needs a real layout engine (canvas); it is unevaluable in
    // jsdom and is covered by the Phase E browser-based Playwright+axe run.
    rules: { "color-contrast": { enabled: false } },
  });
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (bad.length) {
    console.error("axe serious/critical:", bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`));
  }
  return bad;
}

describe("accessibility (axe-core, zero serious/critical)", () => {
  beforeEach(() => mockFetch());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("People (populated)", async () => {
    const { container } = render(<People />);
    await settle();
    expect(await noSeriousCritical(container)).toEqual([]);
  });

  it("Comp (populated: bands + records)", async () => {
    const { container } = render(<Comp />);
    await settle();
    expect(await noSeriousCritical(container)).toEqual([]);
  });

  it("Leave (populated: cases + eligibility form)", async () => {
    const { container } = render(<Leave />);
    await settle();
    expect(await noSeriousCritical(container)).toEqual([]);
  });

  it("Command Center (live counts + AI assist)", async () => {
    const { container } = render(<CommandCenter />);
    await settle();
    expect(await noSeriousCritical(container)).toEqual([]);
  });

  it("empty state", async () => {
    const { container } = render(<EmptyState title="No people yet" body="Seed the demo tenant." next="run npm run seed" />);
    expect(await noSeriousCritical(container)).toEqual([]);
  });

  it("error state (forbidden) and (generic)", async () => {
    const r1 = render(<ErrorState error={new ApiError("forbidden", 403)} />);
    expect(await noSeriousCritical(r1.container)).toEqual([]);
    cleanup();
    const r2 = render(<ErrorState error={new Error("network down")} onRetry={() => {}} />);
    expect(await noSeriousCritical(r2.container)).toEqual([]);
  });
});
