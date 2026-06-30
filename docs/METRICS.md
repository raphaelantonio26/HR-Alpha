# Metrics (governed semantic layer)

People analytics that **cannot** re-identify an individual or leak a raw record by
construction. The safety isn't a review step — it's the shape of the system.

## Catalog, not free SQL

Analysts compose metrics from a **governed catalog** of measures and dimensions
(`packages/core/src/metrics/dsl.ts`), never from arbitrary SQL or raw columns.
`validateDefinition()` rejects any measure or dimension not in the catalog, so a
metric can only ever reference vetted, aggregate-safe building blocks.

## Constrained DSL

Derived metrics use a tiny expression tree with exactly three node kinds:

- `measure` — a catalog measure key
- `lit` — a numeric literal
- `op` — an arithmetic operator over two sub-expressions

There is no function-call node, no field access, no row reference. `validateExpr()`
confirms every leaf is a known measure or a literal; `evalExpr()` evaluates against
**pre-aggregated** values (divide-by-zero yields 0, never an exception). An analyst
literally cannot express "show me the rows behind this."

## Small-cell suppression

`suppress()` blanks any cell whose population is below the threshold, so a thin
slice can't expose an individual:

- Default threshold: **5**.
- Sensitive dimensions (e.g. EEO class): **10**.

Suppressed cells return `value: null` with `suppressed: true` — the UI shows the
cell is withheld rather than dropping it silently.

## AI metric builder

When AI helps compose a metric (`dashboard_assist`), it receives **only the names
of catalog measures and dimensions** — never rows, never raw values, never PII. Its
output is a set of references to catalog items, which then run through the same
validation and suppression as a hand-built metric. The model never sees data.

## Extending

- Add a measure/dimension to the catalog with its aggregation semantics; add it to
  the validators.
- If it's identity-adjacent, mark it sensitive so the raised suppression threshold
  applies.
- Add a suppression test for any new aggregation. (Existing tests cover the default
  and sensitive thresholds and the divide-by-zero path.)

> The guarantee is structural: governed inputs + arithmetic-only derivation +
> mandatory suppression. A new measure inherits all three.
