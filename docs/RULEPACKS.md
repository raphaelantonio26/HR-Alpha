# Rule packs (leave compliance)

Leave rules are **versioned, jurisdiction-scoped data**, not hardcoded branches.
The engine (`packages/core/src/leave/engine.ts`) is jurisdiction-neutral; a rule
pack (`california.ts`) supplies the specifics. This keeps a statutory change a
data edit with a version bump, not an engine rewrite.

## Shape

A `RulePack` declares, per jurisdiction: the leave reasons it covers, the clocks
those reasons start (FMLA, CFRA, PDL, …), entitlement durations, eligibility
thresholds, and the employer-contact / designation rules. `rulePackFor(jurisdiction)`
returns the pack, **falling back to the federal pack** when a state pack is absent
— conservative by default.

## What ships

- **`US-CA` (`CALIFORNIA_PACK`, v2026.1)** — CFRA's stricter employer-contact
  posture, PDL as a separate cumulative entitlement (17.33 weeks), and the
  CA-specific reason set. CFRA and FMLA run concurrently where both apply; PDL is
  tracked cumulatively, not on the FMLA rolling window.
- **`US-FED` (`FEDERAL_PACK`)** — FMLA baseline: 12 months + 1,250 hours
  eligibility, 12 weeks, rolling-12-month-backward usage.

## Engine behavior the packs drive

- **Eligibility**: 12 months of tenure **and** 1,250 hours in the trailing 12
  months (federal floor; a pack may add state rules).
- **Entitlement**: prorated where applicable; PDL = 17.33 weeks.
- **Usage windows**: FMLA is measured on a rolling 12 months looking backward;
  PDL is cumulative.
- **Await-designation**: until a case is designated, the engine returns a
  zero-state rather than guessing — designation is a human decision.
- **Concurrent clocks**: a single absence can run FMLA + CFRA together; the engine
  resolves overlapping clocks without double-charging.

## Adding a jurisdiction (NY / WA / CO)

These are typed placeholders today. To add one:

1. Define the pack: reasons, clocks, durations, thresholds, contact/designation rules.
2. Register it in `rulePackFor`.
3. Add unit tests covering eligibility boundaries, entitlement proration, the
   usage window, and any concurrency with federal leave.

**TODO(fable5):** populate `US-NY`, `US-WA`, `US-CO`.

> Rule packs encode statute as conservatively as the source allows. When a rule
> is ambiguous, the engine escalates to a human rather than asserting a number.
