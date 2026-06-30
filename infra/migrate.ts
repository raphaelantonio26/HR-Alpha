/**
 * Azure migration runner (Container Apps Job). The proven local path is
 * infra/migrate.sh (psql), but the slim runtime image ships tsx + node-postgres,
 * NOT psql, so on Azure we apply the SAME migration.sql through `pg`. node-postgres
 * runs a multi-statement string in one simple-query call (there are no bind
 * params in the schema), so the file is applied verbatim - no rewrite, no drift.
 *
 * Order (matches the driver/role ADRs):
 *   1. Connect as the server ADMIN (member of azure_pg_admin on Flexible Server).
 *   2. Idempotently create the NON-superuser, NOBYPASSRLS app role `hros_app`
 *      (the principal the API connects as) and grant it schema usage. The
 *      migration's GRANTs are guarded "...TO hros_app" and only bind once the role
 *      exists, so the role must come first.
 *   3. Allowlist + create pgcrypto is handled in migration.sql (CREATE EXTENSION
 *      IF NOT EXISTS "pgcrypto"); the extension is allowlisted at the server level
 *      by Bicep (azure.extensions). pgcrypto is a TRUSTED extension, so the admin
 *      (CREATE privilege) can create it. NOTE: only gen_random_uuid() is used,
 *      which is core in PostgreSQL 13+, so pgcrypto is effectively optional.
 *   4. Execute migration.sql (idempotent; safe to re-run).
 *
 * Runs as ADMIN by design (DDL, role creation, FORCE RLS apply). The app NEVER
 * uses these credentials - it connects as hros_app. This script does not import
 * packages/server/src/db.ts precisely because that pool is the app principal.
 *
 * Env:
 *   ADMIN_DATABASE_URL  postgres URL for the server admin (sslmode=require)
 *   APP_DB_USER         app role name (default "hros_app")
 *   APP_DB_PASSWORD     app role password (also embedded in the app's DATABASE_URL)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";

const ADMIN_URL = process.env.ADMIN_DATABASE_URL;
const APP_USER = process.env.APP_DB_USER ?? "hros_app";
const APP_PASSWORD = process.env.APP_DB_PASSWORD;

if (!ADMIN_URL) throw new Error("ADMIN_DATABASE_URL is required");
if (!APP_PASSWORD) throw new Error("APP_DB_PASSWORD is required");
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(APP_USER)) throw new Error(`unsafe APP_DB_USER: ${APP_USER}`);

const sqlEscape = (s: string) => s.replace(/'/g, "''"); // single-quote escape for the role literal

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationPath = join(here, "..", "packages", "server", "prisma", "migrations", "0001_init", "migration.sql");
  const migrationSql = readFileSync(migrationPath, "utf8");

  const pool = new Pool({ connectionString: ADMIN_URL, max: 1, ssl: { rejectUnauthorized: false } });
  try {
    // (1+2) Create the NON-superuser app role if absent; never weaken an existing one.
    await pool.query(`
      DO $bootstrap$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${sqlEscape(APP_USER)}') THEN
          CREATE ROLE ${APP_USER} LOGIN PASSWORD '${sqlEscape(APP_PASSWORD!)}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END
      $bootstrap$;
    `);
    // Ensure posture is correct even if the role pre-existed, and grant schema usage.
    await pool.query(`ALTER ROLE ${APP_USER} NOSUPERUSER NOBYPASSRLS;`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${APP_USER};`);
    console.log(`[migrate] app role ${APP_USER} ensured (NOSUPERUSER NOBYPASSRLS).`);

    // (4) Apply the proven schema verbatim. Multi-statement, no bind params.
    await pool.query(migrationSql);
    console.log("[migrate] migration.sql applied (idempotent).");

    // Quick visibility: confirm RLS is forced on the business tables.
    const rls = await pool.query(
      `SELECT count(*)::int AS forced FROM pg_class
        WHERE relrowsecurity AND relforcerowsecurity AND relkind = 'r'`,
    );
    console.log(`[migrate] tables with FORCE RLS = ${rls.rows[0].forced}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[migrate] failed:", e);
  process.exit(1);
});
