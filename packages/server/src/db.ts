/**
 * Database access. Tenant isolation is enforced at the DATABASE via row-level
 * security (§3.2) -- not in application code. Every unit of work runs inside
 * withActor(), which opens a transaction and sets the request's actor and tenant
 * as Postgres GUCs (`app.actor_id`, `app.tenant_id`). RLS policies read those
 * GUCs; the append-only audit trigger reads `app.actor_id` to stamp every
 * mutation (§3.2 audit). Code that bypasses withActor cannot see tenant rows.
 *
 * Driver note (environment-forced, see docs/DATA-TOPOLOGY.md):
 *   The authoritative schema is `prisma/schema.prisma` and migrations are applied
 *   by `infra/migrate.sh`. At RUNTIME this file uses node-postgres (`pg`) rather
 *   than the generated Prisma client, because the Prisma query-engine binary host
 *   is unreachable in the build sandbox (`binaries.prisma.sh` is blocked), so
 *   `prisma generate` cannot run here. The public contract below -- Actor, Tx,
 *   withActor -- is identical to the Prisma version, and every DB-enforced
 *   invariant (RLS, append-only audit, the GUC-per-transaction pattern) is
 *   unchanged and proven by packages/server/test/pgtap/rls_audit.sql.
 *   TODO(fable5): when binaries.prisma.sh is reachable, run `prisma generate`
 *   and either keep this pg layer or restore the PrismaClient implementation;
 *   the SQL and the contract do not change either way.
 */
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

// numeric/decimal -> JS number (audit + comp math expect numbers, not strings).
// 1700 = NUMERIC oid. Safe here because all values are bounded HR figures.
pg.types.setTypeParser(1700, (v: string | null) => (v === null ? null : Number(v)));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

/** Liveness probe used by the readiness route. */
export async function ping(): Promise<void> {
  await pool.query("SELECT 1");
}

/** Close the pool (tests / graceful shutdown). */
export async function close(): Promise<void> {
  await pool.end();
}

export interface Actor {
  actorId: string;
  tenantId: string;
  role: string;
}

/**
 * Minimal transaction surface the routes rely on. Method names mirror the Prisma
 * client so route/audit code is identical whether the driver is Prisma or pg:
 *  - $queryRawUnsafe<T>(sql, ...params): rows
 *  - $executeRawUnsafe(sql, ...params): affected row count
 * Parameters use Postgres positional placeholders ($1, $2, ...).
 */
export interface Tx {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
}

/**
 * Run `fn` in a transaction with the actor/tenant GUCs set LOCAL to that tx, so
 * RLS scopes every statement and the audit trigger attributes every write. The
 * GUCs are transaction-scoped (set_config(..., true)); a forgotten WHERE clause
 * still cannot cross tenants because the policy is enforced by the database.
 */
export async function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config(..., true) == SET LOCAL: scoped to this transaction only.
    await client.query("SELECT set_config('app.actor_id', $1, true)", [actor.actorId]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [actor.tenantId]);
    await client.query("SELECT set_config('app.role', $1, true)", [actor.role]);

    const tx: Tx = {
      async $queryRawUnsafe<R = unknown>(sql: string, ...params: unknown[]): Promise<R> {
        const res = await client.query(sql, params as unknown[]);
        return res.rows as unknown as R;
      },
      async $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number> {
        const res = await client.query(sql, params as unknown[]);
        return res.rowCount ?? 0;
      },
    };

    const out = await fn(tx);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
