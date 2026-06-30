/**
 * Synthetic demo seed. Inserts ONLY clearly-fake data (Sample / .example) for ONE
 * demo tenant, through withActor() so row-level security and the append-only audit
 * trigger apply to every row (the prompt's requirement). No real person is ever
 * depicted (§2 invariant 3). Idempotent: re-running inserts nothing new.
 *
 * Run:  DATABASE_URL=postgresql://hros_app:hros_app@localhost:5432/hros \
 *         npm run seed
 */
import { withActor, close, type Tx } from "../packages/server/src/db.js";
import { DEMO_TENANT_ID, DEMO_TENANT_NAME } from "../packages/server/src/demo.js";

const SEED_ACTOR = { actorId: "system.seed@hros.example", tenantId: DEMO_TENANT_ID, role: "administrator" };

const WS = {
  carson: "c0000000-0000-4000-8000-000000000001",
  jurupa: "c0000000-0000-4000-8000-000000000002",
  elcajon: "c0000000-0000-4000-8000-000000000003",
  poway: "c0000000-0000-4000-8000-000000000004",
  fremont: "c0000000-0000-4000-8000-000000000005",
};
const POS = {
  je: "b0000000-0000-4000-8000-000000000001",
  fsf: "b0000000-0000-4000-8000-000000000002",
  lvt: "b0000000-0000-4000-8000-000000000003",
  hvac: "b0000000-0000-4000-8000-000000000004",
  fore: "b0000000-0000-4000-8000-000000000005",
  pm: "b0000000-0000-4000-8000-000000000006",
};
const W = (n: number) => `a0000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;

const worksites: Array<[string, string, string, string, string[]]> = [
  [WS.carson, "Carson HQ", "Carson", "CA", ["US-FED", "US-CA"]],
  [WS.jurupa, "Jurupa Valley", "Jurupa Valley", "CA", ["US-FED", "US-CA"]],
  [WS.elcajon, "El Cajon", "El Cajon", "CA", ["US-FED", "US-CA"]],
  [WS.poway, "Poway", "Poway", "CA", ["US-FED", "US-CA"]],
  [WS.fremont, "Fremont", "Fremont", "CA", ["US-FED", "US-CA"]],
];
const positions: Array<[string, string, string, string, string]> = [
  [POS.je, "Journeyman Electrician", "journeyman_electrician", "non_exempt", "47-2111"],
  [POS.fsf, "Fire Sprinkler Fitter", "fire_sprinkler_fitter", "non_exempt", "47-2152"],
  [POS.lvt, "Low Voltage Technician", "low_voltage_technician", "non_exempt", "47-2098"],
  [POS.hvac, "HVAC Service Mechanic", "hvac_service_mechanic", "non_exempt", "49-9021"],
  [POS.fore, "Foreman", "foreman", "non_exempt", "47-1011"],
  [POS.pm, "Project Manager", "project_manager", "exempt", "11-9021"],
];
// id, file#, first, last, status, worksite, position, manager, empType, hireDate, hpw
const workers: Array<[string, string, string, string, string, string, string, string | null, string, string, number]> = [
  [W(1), "000101", "Sample", "Alvarez", "active", WS.carson, POS.pm, null, "open_shop", "2018-02-12", 40],
  [W(2), "000102", "Sample", "Brooks", "active", WS.carson, POS.fore, W(1), "open_shop", "2019-06-03", 40],
  [W(3), "000103", "Sample", "Okafor", "active", WS.jurupa, POS.je, W(2), "open_shop", "2020-01-20", 40],
  [W(4), "000104", "Sample", "Nguyen", "active", WS.jurupa, POS.fsf, W(2), "open_shop", "2021-07-15", 40],
  [W(5), "000105", "Sample", "Rivera", "leave", WS.elcajon, POS.lvt, W(2), "open_shop", "2021-03-01", 40],
  [W(6), "000106", "Sample", "Castillo", "active", WS.poway, POS.hvac, W(2), "open_shop", "2019-11-05", 40],
  [W(7), "000107", "Sample", "Delgado", "active", WS.poway, POS.je, W(2), "open_shop", "2022-09-19", 40],
  [W(8), "000108", "Sample", "Esparza", "active", WS.fremont, POS.lvt, W(2), "open_shop", "2023-02-27", 40],
  [W(9), "000109", "Sample", "Flores", "leave", WS.carson, POS.je, W(2), "open_shop", "2020-08-10", 40],
  [W(10), "000110", "Sample", "Gupta", "active", WS.elcajon, POS.hvac, W(2), "open_shop", "2024-01-08", 40],
  [W(11), "000111", "Sample", "Haddad", "active", WS.jurupa, POS.fsf, W(2), "open_shop", "2022-05-16", 40],
  [W(12), "000112", "Sample", "Ibarra", "active", WS.fremont, POS.je, W(2), "open_shop", "2023-10-02", 40],
];
// worker, amount, unit, effectiveDate, hours12mo
const comp: Array<[string, number, string, string, number]> = [
  [W(1), 135000, "annual", "2025-01-01", 2080],
  [W(2), 58.0, "hourly", "2025-01-01", 2080],
  [W(3), 47.0, "hourly", "2025-01-01", 2080],
  [W(4), 41.0, "hourly", "2025-01-01", 2080],
  [W(5), 36.0, "hourly", "2025-01-01", 1180],
  [W(6), 44.0, "hourly", "2025-01-01", 2080],
  [W(7), 45.5, "hourly", "2025-01-01", 2010],
  [W(8), 33.0, "hourly", "2025-01-01", 1320],
  [W(9), 46.0, "hourly", "2025-01-01", 1980],
  [W(10), 34.5, "hourly", "2025-01-01", 720],
  [W(11), 42.5, "hourly", "2025-01-01", 2080],
  [W(12), 47.5, "hourly", "2025-01-01", 1860],
];
// id, worker, reason, designation|null, status, start, end|null, intermittent, priority, jur
const leaveCases: Array<[string, string, string, string[] | null, string, string, string | null, boolean, string, string]> = [
  ["f0000000-0000-4000-8000-000000000001", W(5), "serious_health", null, "intake", "2026-05-27", null, false, "High", "US-CA"],
  ["f0000000-0000-4000-8000-000000000002", W(9), "bonding", ["FMLA", "CFRA"], "open", "2026-04-01", null, false, "Medium", "US-CA"],
  ["f0000000-0000-4000-8000-000000000003", W(3), "family_care", ["FMLA", "CFRA"], "open", "2026-06-01", "2026-06-20", true, "Medium", "US-CA"],
];
// id, titleKey, unit, p10,p25,p50,p75,p90, confidence, locked
const bands: Array<[string, string, string, number, number, number, number, number, number, boolean]> = [
  ["aa000000-0000-4000-8000-000000000001", "journeyman_electrician", "hourly", 30, 36, 42, 50, 58, 72, true],
  ["aa000000-0000-4000-8000-000000000002", "low_voltage_technician", "hourly", 26, 30, 36, 43, 49, 68, false],
  ["aa000000-0000-4000-8000-000000000003", "hvac_service_mechanic", "hourly", 29, 34, 41, 49, 56, 70, true],
];

const ins = (tx: Tx, sql: string, params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);

async function main() {
  const counts = await withActor(SEED_ACTOR, async (tx) => {
    // tenant has no RLS; the rest is WITH CHECK against the tenant GUC set above.
    await ins(tx, `INSERT INTO tenant (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [DEMO_TENANT_ID, DEMO_TENANT_NAME]);

    for (const [id, name, city, state, jur] of worksites)
      await ins(tx, `INSERT INTO worksite (id, tenant_id, name, city, state, jurisdictions) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, [id, DEMO_TENANT_ID, name, city, state, jur]);

    for (const [id, title, key, flsa, soc] of positions)
      await ins(tx, `INSERT INTO position (id, tenant_id, title, title_key, flsa, soc_code) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, [id, DEMO_TENANT_ID, title, key, flsa, soc]);

    for (const [id, fn, first, last, status, ws, pos, mgr, et, hire, hpw] of workers)
      await ins(tx, `INSERT INTO worker (id, tenant_id, file_number, first_name, last_name, status, worksite_id, position_id, manager_id, employment_type, hire_date, hours_per_week) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`, [id, DEMO_TENANT_ID, fn, first, last, status, ws, pos, mgr, et, hire, hpw]);

    for (const [wid, amt, unit, eff, h12] of comp)
      await ins(tx, `INSERT INTO compensation_record (tenant_id, worker_id, amount, unit, effective_date, hours_worked_12mo) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM compensation_record WHERE worker_id=$2 AND effective_date=$5)`, [DEMO_TENANT_ID, wid, amt, unit, eff, h12]);

    for (const [id, wid, reason, des, status, start, end, inter, prio, jur] of leaveCases)
      await ins(tx, `INSERT INTO leave_case (id, tenant_id, worker_id, reason_id, designation, status, start_date, end_date, intermittent, priority, jurisdiction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`, [id, DEMO_TENANT_ID, wid, reason, des, status, start, end, inter, prio, jur]);

    for (const [id, key, unit, p10, p25, p50, p75, p90, conf, locked] of bands)
      await ins(tx, `INSERT INTO pay_band (id, tenant_id, title_key, unit, p10, p25, p50, p75, p90, confidence, locked) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id, title_key) DO NOTHING`, [id, DEMO_TENANT_ID, key, unit, p10, p25, p50, p75, p90, conf, locked]);

    const c = (await tx.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM worker) w, (SELECT count(*) FROM compensation_record) c,
              (SELECT count(*) FROM leave_case) l, (SELECT count(*) FROM pay_band) b,
              (SELECT count(*) FROM worksite) s, (SELECT count(*) FROM position) p`,
    )) as Array<Record<string, string>>;
    return c[0];
  });

  console.log(`[seed] tenant=${DEMO_TENANT_ID} (Sample/.example only; no PII)`);
  console.log(`[seed] worksites=${counts.s} positions=${counts.p} workers=${counts.w} comp=${counts.c} leave_cases=${counts.l} pay_bands=${counts.b}`);
  console.log("[seed] inserted via withActor -> RLS + append-only audit applied to every row.");
  await close();
}

main().catch(async (e) => {
  console.error("[seed] failed:", e);
  await close();
  process.exit(1);
});
