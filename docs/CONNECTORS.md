# Connectors

HR OS stays HRIS-agnostic. A **connector** maps a vendor's schema into the
canonical model so no module ever sees a vendor shape. AMPAM runs ADP Workforce
Now today; other systems are added by writing a driver, not by touching modules.

## The contract

Every driver implements `Connector` (`packages/connectors/src/interface.ts`):

| Method | Purpose |
|---|---|
| `verify()` | Confirm credentials/scopes and report capabilities — **no mutation**. |
| `fetchRoster(tenantId)` | Return canonical workers/positions/worksites/manager edges. |
| `fetchCompensation(tenantId)` | Return canonical compensation records. |
| `writeBack(tenantId, changes)` | Optional. Read-only drivers reject. |
| `describeFieldMap()` | The vendor→canonical column contract (also the docs). |

Drivers **fail safe**: a partial or failed sync degrades to last-known-good and is
fully logged with its source. `readOnly` drivers never write.

## Sync pipeline — validate → diff → commit

`packages/connectors/src/sync.ts`. Three guarantees:

1. **Idempotent.** Re-running the same source produces zero changes.
2. **Blank-safe.** A blank/absent incoming value **never** erases existing data.
   Clearing a field requires an explicit tombstone, not an empty cell.
3. **Provenance.** Every applied change records its `source`
   (`adp_wfn | csv | scim | manual | seed`) for the audit trail.

`diffWorkers()` validates each incoming row with `zWorker`; any invalid row is
collected and `commitDiff()` **aborts atomically** if the invalid set is
non-empty — last-known-good stands. Commits run through an injected, actor-scoped
writer so RLS and the audit trigger apply.

## ADP Workforce Now driver

`packages/connectors/src/drivers/adpWorkforceNow.ts`. Stage 1 is **dry-run**: the
complete field map is present and correct; fetches return empty rather than
calling ADP. The field map (abridged):

| Canonical | ADP source path | Notes |
|---|---|---|
| `fileNumber` | `worker.associateOID \| workerID.idValue` | TEXT — preserve leading zeros |
| `firstName` / `lastName` | `person.legalName.givenName` / `.familyName1` | |
| `status` | `workerStatus.statusCode.codeValue` | |
| `hireDate` | `workerDates.originalHireDate` | |
| `positionId` | `workAssignments[].jobCode.codeValue` | |
| `worksiteId` | `workAssignments[].homeWorkLocation.nameCode.codeValue` | |
| `managerId` | `workAssignments[].reportsTo[].associateOID` | optional |
| `employmentType` | `workAssignments[].wageLawCoverage.wageLawNameCode` | → union \| open_shop |
| `hoursPerWeek` | `workAssignments[].standardHours.hoursQuantity` | optional |

**TODO(fable5):** OAuth client-credentials + mutual-TLS handshake, the
Workers/Work-Assignments endpoints, cursor-based incremental sync, opt-in
writeback per tenant.

## Generic CSV driver

`packages/connectors/src/drivers/genericCsv.ts`. The universal fallback: a
header→canonical column map, every cell neutralized against formula injection
(`csvGuard.ts` prefixes a leading apostrophe to any cell starting with `= + - @`
or tab/CR, so it renders as literal text and never executes in Excel/Sheets).
Read-only; feeds the sync pipeline.

## Adding a driver

1. Implement `Connector` for the vendor; map its schema to canonical in
   `fetchRoster`/`fetchCompensation`; fill `describeFieldMap()`.
2. Neutralize any spreadsheet/CSV path with `neutralizeRow`.
3. Feed `diffWorkers` → `commitDiff` with an actor-scoped writer.
4. Add a round-trip test (including a formula-injection case).

Stubs exist for Workday, UKG Pro, BambooHR, Paylocity, and SAP SuccessFactors —
each verifies as "not configured" until built.
