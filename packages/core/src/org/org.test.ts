import { describe, it, expect } from "vitest";
import { analyzeSpan, hrbpCoverage, tidyTreeLayout, type OrgNode } from "./analysis.js";

// CEO -> (VP1 -> M1 -> [E1,E2,E3]) , (VP2)
const tree: OrgNode[] = [
  { id: "CEO", managerId: null },
  { id: "VP1", managerId: "CEO" },
  { id: "VP2", managerId: "CEO" },
  { id: "M1", managerId: "VP1" },
  { id: "E1", managerId: "M1" },
  { id: "E2", managerId: "M1" },
  { id: "E3", managerId: "M1" },
];

describe("analyzeSpan", () => {
  it("counts direct reports and total descendants", () => {
    const r = analyzeSpan(tree);
    expect(r.directReports.CEO).toBe(2);
    expect(r.directReports.M1).toBe(3);
    expect(r.totalDescendants.CEO).toBe(6);
    expect(r.totalDescendants.M1).toBe(3);
  });
  it("computes max depth (CEO->VP1->M1->E1 = depth 3)", () => {
    expect(analyzeSpan(tree).maxDepth).toBe(3);
  });
  it("flags low and high spans", () => {
    const big: OrgNode[] = [{ id: "B", managerId: null }, ...Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, managerId: "B" }))];
    const r = analyzeSpan(big, { lowSpan: 2, highSpan: 8 });
    expect(r.flags.some((f) => f.id === "B" && f.flag === "high_span")).toBe(true);
  });
  it("does not infinite-loop on a cycle", () => {
    const cyclic: OrgNode[] = [
      { id: "A", managerId: "B" },
      { id: "B", managerId: "A" },
    ];
    expect(() => analyzeSpan(cyclic)).not.toThrow();
  });
});

describe("hrbpCoverage (two-pillar planning)", () => {
  it("computes ratio and gap against a target", () => {
    const r = hrbpCoverage(1500, 2, 250);
    expect(r.ratio).toBe(750);
    expect(r.healthy).toBe(false);
    expect(r.gapHrbps).toBe(Math.ceil(1500 / 250) - 2); // 6 - 2 = 4
  });
  it("healthy when ratio within target", () => {
    expect(hrbpCoverage(400, 2, 250).healthy).toBe(true);
  });
});

describe("tidyTreeLayout (no graph dependency)", () => {
  it("assigns a coordinate to every node, parents centered over children", () => {
    const layout = tidyTreeLayout(tree);
    expect(layout).toHaveLength(tree.length);
    const M1 = layout.find((n) => n.id === "M1")!;
    const E1 = layout.find((n) => n.id === "E1")!;
    const E3 = layout.find((n) => n.id === "E3")!;
    expect(M1.x).toBeCloseTo((E1.x + E3.x) / 2, 10);
    const CEO = layout.find((n) => n.id === "CEO")!;
    expect(CEO.depth).toBe(0);
    expect(E1.depth).toBe(3);
  });
});
