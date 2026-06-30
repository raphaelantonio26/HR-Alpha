-- HR OS — RLS + append-only audit proof (pgTAP).
--
-- This is the test the Stage-1 handoff could not run: the prior container had no
-- database, so the security layer typechecked but was never executed. This file
-- exercises it against a real Postgres, AS THE NON-SUPERUSER APPLICATION ROLE
-- (hros_app). That distinction matters: a superuser or table owner bypasses RLS,
-- so proving isolation requires running as the same constrained role the server
-- connects as in production.
--
-- Run:  pg_prove -d hros -h 127.0.0.1 -p 5432 -U hros_app \
--         packages/server/test/pgtap/rls_audit.sql
--
-- Covers Definition-of-Done #2 and the §10 adversarial brief:
--   (a) RLS blocks cross-tenant SELECT and INSERT (read + write isolation).
--   (b) The AFTER trigger audits every INSERT/UPDATE/DELETE with correct
--       actor/tenant attribution, and DELETE captures the OLD row.
--   (c) audit_log rejects UPDATE / DELETE / TRUNCATE from the app role.
--   (+) Deny-by-default when no tenant GUC is set.
--
-- The whole file runs in one transaction and ROLLs BACK, so it persists nothing.

BEGIN;
SELECT plan(25);

-- Fixed synthetic identifiers (no PII; tables carry no FK constraints by design,
-- so worksite/position ids need not pre-exist). withActor() sets these GUCs via
-- set_config(..., true); SET LOCAL is the identical transaction-scoped mechanism.
-- ---------------------------------------------------------------------------
-- Tenant A context (actor: alice.example)
-- ---------------------------------------------------------------------------
SET LOCAL app.actor_id  = 'alice.example';
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- (b) INSERT is audited with the acting actor + tenant.
SELECT lives_ok(
  $$ INSERT INTO worker (id, tenant_id, file_number, first_name, last_name, status,
       worksite_id, position_id, employment_type, hire_date, hours_per_week)
     VALUES ('fae00000-0000-4000-8000-0000000000a1',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '000123', 'Sample', 'Worker-A',
       'active', 'c0000000-0000-4000-8000-00000000000c',
       'd0000000-0000-4000-8000-00000000000d', 'open_shop', DATE '2023-01-15', 40) $$,
  'tenant A: insert own worker succeeds under matching tenant GUC');

SELECT is(
  (SELECT count(*)::int FROM audit_log
     WHERE entity = 'worker' AND action = 'INSERT'
       AND entity_id = 'fae00000-0000-4000-8000-0000000000a1'
       AND tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       AND actor_id = 'alice.example'),
  1, 'INSERT is audited with correct actor + tenant attribution');

-- (b) UPDATE is audited.
SELECT lives_ok(
  $$ UPDATE worker SET last_name = 'Sample-Updated'
       WHERE id = 'fae00000-0000-4000-8000-0000000000a1' $$,
  'tenant A: update own worker succeeds');

SELECT is(
  (SELECT count(*)::int FROM audit_log
     WHERE entity = 'worker' AND action = 'UPDATE'
       AND entity_id = 'fae00000-0000-4000-8000-0000000000a1'
       AND tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1, 'UPDATE is audited');

-- (b) The trigger covers a second table (compensation_record), not just worker.
SELECT lives_ok(
  $$ INSERT INTO compensation_record (id, tenant_id, worker_id, amount, unit,
       effective_date, hours_worked_12mo)
     VALUES ('e0000000-0000-4000-8000-00000000000e',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'fae00000-0000-4000-8000-0000000000a1', 41.50, 'hourly',
       DATE '2024-01-01', 2080) $$,
  'tenant A: insert compensation record succeeds');

SELECT is(
  (SELECT count(*)::int FROM audit_log
     WHERE entity = 'compensation_record' AND action = 'INSERT'
       AND entity_id = 'e0000000-0000-4000-8000-00000000000e'),
  1, 'compensation_record INSERT is audited (trigger spans all business tables)');

-- (b) The new canonical tables (leave_case, pay_band) are wired into the same
--     audit trigger -- proving they are protected, not just that the mechanism works.
SELECT lives_ok(
  $$ INSERT INTO leave_case (id, tenant_id, worker_id, reason_id, designation,
       status, start_date, jurisdiction)
     VALUES ('f0000000-0000-4000-8000-00000000000f',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'fae00000-0000-4000-8000-0000000000a1', 'serious_health', NULL,
       'intake', DATE '2026-05-27', 'US-CA') $$,
  'tenant A: insert leave_case (await-designation) succeeds');

SELECT is(
  (SELECT count(*)::int FROM audit_log
     WHERE entity = 'leave_case' AND action = 'INSERT'
       AND entity_id = 'f0000000-0000-4000-8000-00000000000f'
       AND tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1, 'leave_case INSERT is audited (new canonical table is protected)');

SELECT lives_ok(
  $$ INSERT INTO pay_band (id, tenant_id, title_key, unit, p25, p50, p75,
       confidence, locked)
     VALUES ('aa000000-0000-4000-8000-0000000000aa',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'journeyman_electrician', 'hourly', 36, 42, 50, 72, false) $$,
  'tenant A: insert pay_band succeeds');

SELECT is(
  (SELECT count(*)::int FROM audit_log
     WHERE entity = 'pay_band' AND action = 'INSERT'
       AND entity_id = 'aa000000-0000-4000-8000-0000000000aa'),
  1, 'pay_band INSERT is audited (new canonical table is protected)');

-- ---------------------------------------------------------------------------
-- Switch to tenant B context (actor: bob.example)
-- ---------------------------------------------------------------------------
SET LOCAL app.actor_id  = 'bob.example';
SET LOCAL app.tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- (a) READ isolation: tenant B cannot see tenant A's worker.
SELECT is(
  (SELECT count(*)::int FROM worker),
  0, 'RLS: tenant B sees zero of tenant A rows (read isolation)');

-- (a) Read isolation extends to the new canonical tables.
SELECT is(
  (SELECT count(*)::int FROM leave_case),
  0, 'RLS: tenant B sees zero of tenant A leave_case rows');

SELECT is(
  (SELECT count(*)::int FROM pay_band),
  0, 'RLS: tenant B sees zero of tenant A pay_band rows');

-- (a) WRITE isolation: tenant B cannot insert a row stamped for tenant A
--     (RLS WITH CHECK -> SQLSTATE 42501).
SELECT throws_ok(
  $$ INSERT INTO worker (id, tenant_id, file_number, first_name, last_name, status,
       worksite_id, position_id, employment_type, hire_date)
     VALUES ('a1111111-0000-4000-8000-00000000000a',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '000999', 'Sample', 'Cross-Tenant',
       'active', 'c0000000-0000-4000-8000-00000000000c',
       'd0000000-0000-4000-8000-00000000000d', 'open_shop', DATE '2023-01-15') $$,
  '42501', NULL,
  'RLS: tenant B cannot write a row stamped for tenant A (WITH CHECK blocks it)');

-- tenant B inserts its own worker.
SELECT lives_ok(
  $$ INSERT INTO worker (id, tenant_id, file_number, first_name, last_name, status,
       worksite_id, position_id, employment_type, hire_date)
     VALUES ('b0000000-0000-4000-8000-00000000000b',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '000456', 'Sample', 'Worker-B',
       'active', 'c0000000-0000-4000-8000-00000000000c',
       'd0000000-0000-4000-8000-00000000000d', 'union', DATE '2022-06-01') $$,
  'tenant B: insert own worker succeeds');

SELECT is(
  (SELECT count(*)::int FROM worker),
  1, 'RLS: tenant B now sees exactly its own one worker');

-- ---------------------------------------------------------------------------
-- Back to tenant A: isolation holds in the other direction too.
-- ---------------------------------------------------------------------------
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT is(
  (SELECT count(*)::int FROM worker),
  1, 'RLS: tenant A sees exactly its own one worker (not tenant B''s)');

-- (b) DELETE is audited and captures the OLD row.
SELECT lives_ok(
  $$ DELETE FROM worker WHERE id = 'fae00000-0000-4000-8000-0000000000a1' $$,
  'tenant A: delete own worker succeeds');

SELECT is(
  (SELECT count(*)::int FROM audit_log
     WHERE entity = 'worker' AND action = 'DELETE'
       AND entity_id = 'fae00000-0000-4000-8000-0000000000a1'),
  1, 'DELETE is audited');

SELECT is(
  (SELECT detail->>'last_name' FROM audit_log
     WHERE entity = 'worker' AND action = 'DELETE'
       AND entity_id = 'fae00000-0000-4000-8000-0000000000a1'),
  'Sample-Updated', 'DELETE audit detail captures the OLD row');

-- ---------------------------------------------------------------------------
-- Deny-by-default: with no tenant GUC, nothing is visible and nothing writes.
-- ---------------------------------------------------------------------------
SET LOCAL app.tenant_id = '';
SELECT is(
  (SELECT count(*)::int FROM worker),
  0, 'RLS: empty tenant GUC -> deny by default on read');

SELECT throws_ok(
  $$ INSERT INTO worker (id, tenant_id, file_number, first_name, last_name, status,
       worksite_id, position_id, employment_type, hire_date)
     VALUES ('a2222222-0000-4000-8000-00000000000a',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '000777', 'Sample', 'No-Context',
       'active', 'c0000000-0000-4000-8000-00000000000c',
       'd0000000-0000-4000-8000-00000000000d', 'open_shop', DATE '2023-01-15') $$,
  '42501', NULL,
  'RLS: empty tenant GUC -> deny by default on write');

-- ---------------------------------------------------------------------------
-- (c) Append-only audit: the app role may INSERT/SELECT audit_log but never
--     UPDATE/DELETE/TRUNCATE it (privileges revoked) -> SQLSTATE 42501.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ UPDATE audit_log SET action = 'tampered' WHERE TRUE $$,
  '42501', NULL,
  'audit_log: UPDATE is denied to the app role (append-only)');

SELECT throws_ok(
  $$ DELETE FROM audit_log WHERE TRUE $$,
  '42501', NULL,
  'audit_log: DELETE is denied to the app role (append-only)');

SELECT throws_ok(
  $$ TRUNCATE audit_log $$,
  '42501', NULL,
  'audit_log: TRUNCATE is denied to the app role (append-only)');

SELECT * FROM finish();
ROLLBACK;
