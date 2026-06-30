/**
 * Org analysis (pure, deterministic) — span-of-control, depth, and HRBP coverage
 * planning, plus a custom tidy-tree layout from manager_id with NO graph
 * dependency (§4 module 7). Supports the two-pillar HR operating model and phased
 * HRBP scaling as first-class scenario inputs.
 */

export interface OrgNode {
  id: string;
  managerId: string | null;
  /** Optional label for layout output. */
  name?: string;
}

export interface SpanResult {
  /** Direct reports per manager. */
  directReports: Record<string, number>;
  /** Total descendants per manager (whole sub-tree). */
  totalDescendants: Record<string, number>;
  maxDepth: number;
  /** Managers with span outside a healthy range. */
  flags: Array<{ id: string; span: number; flag: "low_span" | "high_span" }>;
}

function buildChildren(nodes: OrgNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.managerId) {
      const arr = children.get(n.managerId) ?? [];
      arr.push(n.id);
      children.set(n.managerId, arr);
    }
  }
  return children;
}

export function analyzeSpan(
  nodes: OrgNode[],
  opts: { lowSpan?: number; highSpan?: number } = {},
): SpanResult {
  const low = opts.lowSpan ?? 1;
  const high = opts.highSpan ?? 8;
  const children = buildChildren(nodes);
  const directReports: Record<string, number> = {};
  const totalDescendants: Record<string, number> = {};

  for (const n of nodes) directReports[n.id] = children.get(n.id)?.length ?? 0;

  const descendants = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    let count = 0;
    for (const c of children.get(id) ?? []) count += 1 + descendants(c, seen);
    return count;
  };
  for (const n of nodes) totalDescendants[n.id] = descendants(n.id);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthOf = (id: string, seen = new Set<string>()): number => {
    let d = 0;
    let cur = byId.get(id);
    while (cur && cur.managerId && !seen.has(cur.id)) {
      seen.add(cur.id);
      d += 1;
      cur = byId.get(cur.managerId);
    }
    return d;
  };
  const maxDepth = nodes.reduce((m, n) => Math.max(m, depthOf(n.id)), 0);

  const flags: SpanResult["flags"] = [];
  for (const n of nodes) {
    const span = directReports[n.id]!;
    if (span === 0) continue; // ICs are not managers
    if (span < low) flags.push({ id: n.id, span, flag: "low_span" });
    else if (span > high) flags.push({ id: n.id, span, flag: "high_span" });
  }

  return { directReports, totalDescendants, maxDepth, flags };
}

/** HRBP coverage: headcount per HRBP against a target ratio (two-pillar planning). */
export function hrbpCoverage(
  headcount: number,
  hrbpCount: number,
  targetRatio: number,
): { ratio: number | null; gapHrbps: number; healthy: boolean } {
  const ratio = hrbpCount > 0 ? headcount / hrbpCount : null;
  const needed = Math.ceil(headcount / targetRatio);
  const gapHrbps = Math.max(0, needed - hrbpCount);
  return { ratio, gapHrbps, healthy: ratio != null && ratio <= targetRatio };
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  depth: number;
}

/**
 * Tidy-tree layout (Reingold-Tilford-style, first-pass): assigns each node an
 * (x, y) by post-order leaf packing + parent centering. Deterministic; no deps.
 */
export function tidyTreeLayout(nodes: OrgNode[], gapX = 1, gapY = 1): LayoutNode[] {
  const children = buildChildren(nodes);
  const roots = nodes.filter((n) => !n.managerId).map((n) => n.id);
  const out = new Map<string, LayoutNode>();
  let cursor = 0;

  const place = (id: string, depth: number): number => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      const x = cursor * gapX;
      cursor += 1;
      out.set(id, { id, x, y: depth * gapY, depth });
      return x;
    }
    const xs = kids.map((c) => place(c, depth + 1));
    const x = (xs[0]! + xs[xs.length - 1]!) / 2;
    out.set(id, { id, x, y: depth * gapY, depth });
    return x;
  };

  for (const r of roots) place(r, 0);
  // Place any orphaned nodes (manager not present) deterministically at the end.
  for (const n of nodes) if (!out.has(n.id)) place(n.id, 0);
  return nodes.map((n) => out.get(n.id)!);
}
