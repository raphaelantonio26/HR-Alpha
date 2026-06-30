/**
 * Demo reseed (Profile D self-heal). The demo allows scoped writes so it feels
 * real; this job restores the canonical synthetic state on a schedule (Azure
 * Container Apps Job - see infra/azure and docs/DEPLOY-AZURE.md) so visitor edits
 * never accumulate.
 *
 * Strategy (all scoped to the demo tenant by RLS via withActor):
 *   - compensation_record / leave_case / org_unit: cleared entirely, then the
 *     idempotent seed re-inserts the canonical rows.
 *   - worker / position / worksite / pay_band: visitor-added rows (any id NOT in
 *     the canonical UUID prefix) are removed; canonical rows are left in place and
 *     the seed restores any that were edited/removed.
 * Every DELETE is itself audited by the append-only trigger, and the app role can
 * delete business rows (only audit_log forbids UPDATE/DELETE/TRUNCATE).
 *
 * This NEVER touches any tenant but the demo tenant: withActor pins app.tenant_id
 * to DEMO_TENANT_ID and RLS confines every statement to it.
 *
 * Run:  DATABASE_URL=postgresql://hros_app:hros_app@localhost:5432/hros \
 *         tsx infra/reseed.ts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { withActor, close, type Tx } from "../packages/server/src/db.js";
import { DEMO_TENANT_ID } from "../packages/server/src/demo.js";

const execFileP = promisify(execFile);
const RESEED_ACTOR = { actorId: "system.reseed@hros.example", tenantId: DEMO_TENANT_ID, role: "administrator" };

// Canonical synthetic id prefixes (kept in lockstep with infra/seed.ts).
const PREFIX = {
  worker: "a0000000-0000-4000-8000-",
  position: "b0000000-0000-4000-8000-",
  worksite: "c0000000-0000-4000-8000-",
  payBand: "aa000000-0000-4000-8000-",
};

const exec = (tx: Tx, sql: string, params: unknown[] = []) => tx.$executeRawUnsafe(sql, ...params);

async function main(): Promise<void> {
  const removed = await withActor(RESEED_ACTOR, async (tx) => {
    // Children / id-less rows: clear fully; the seed restores the canonical set.
    const comp = await exec(tx, `DELETE FROM compensation_record`);
    const leave = await exec(tx, `DELETE FROM leave_case`);
    const org = await exec(tx, `DELETE FROM org_unit`);
    // Parents: drop only visitor-added rows (non-canonical ids); keep canonical.
    const workers = await exec(tx, `DELETE FROM worker   WHERE id::text NOT LIKE $1`, [`${PREFIX.worker}%`]);
    const positions = await exec(tx, `DELETE FROM position WHERE id::text NOT LIKE $1`, [`${PREFIX.position}%`]);
    const worksites = await exec(tx, `DELETE FROM worksite WHERE id::text NOT LIKE $1`, [`${PREFIX.worksite}%`]);
    const bands = await exec(tx, `DELETE FROM pay_band  WHERE id::text NOT LIKE $1`, [`${PREFIX.payBand}%`]);
    return { comp, leave, org, workers, positions, worksites, bands };
  });
  await close();

  console.log(`[reseed] cleared demo tenant ${DEMO_TENANT_ID}: ` + JSON.stringify(removed));

  // Restore the canonical synthetic rows via the single source of truth (seed.ts).
  const here = dirname(fileURLToPath(import.meta.url));
  const seedPath = join(here, "seed.ts");
  const { stdout, stderr } = await execFileP("tsx", [seedPath], { env: process.env });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  console.log("[reseed] canonical synthetic state restored.");
}

main().catch(async (e) => {
  console.error("[reseed] failed:", e);
  await close();
  process.exit(1);
});
