-- HR OS — initial schema, audit, and row-level security.
-- ADDITIVE & IDEMPOTENT (§3.7): safe to re-run. Uses IF NOT EXISTS / guarded DO
-- blocks so applying twice never errors and never drops data. The authoritative
-- audit trail is written by an AFTER trigger and the audit table revokes
-- UPDATE/DELETE, making it append-only and tamper-evident (§3.2).

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Tables (canonical model). tenant_id on every business table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worksite (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  name           text NOT NULL,
  city           text NOT NULL,
  state          text NOT NULL,
  jurisdictions  text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS org_unit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL,
  parent_id  uuid
);

CREATE TABLE IF NOT EXISTS position (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  title        text NOT NULL,
  title_key    text NOT NULL,
  flsa         text NOT NULL,
  soc_code     text,
  adp_job_code text,
  org_unit_id  uuid
);

CREATE TABLE IF NOT EXISTS worker (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  file_number      text NOT NULL,             -- TEXT preserves leading zeros
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  status           text NOT NULL,
  worksite_id      uuid NOT NULL,
  position_id      uuid NOT NULL,
  manager_id       uuid,
  employment_type  text NOT NULL,
  hire_date        date NOT NULL,
  hours_per_week   double precision
);

CREATE TABLE IF NOT EXISTS compensation_record (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  worker_id          uuid NOT NULL,
  amount             numeric(12,2) NOT NULL,
  unit               text NOT NULL,
  effective_date     date NOT NULL,
  hours_worked_12mo  double precision
);

-- Leave case: the canonical leave record. The unifying thesis (docs/DATA-TOPOLOGY.md)
-- is that LeaveIQ cases consolidate here, attached to the one employee file by
-- worker_id. Blank designation => await-designation: no clocks run until HR assigns.
CREATE TABLE IF NOT EXISTS leave_case (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  worker_id     uuid NOT NULL,
  reason_id     text NOT NULL,
  designation   text[],                              -- NULL => await-designation
  status        text NOT NULL DEFAULT 'intake',      -- intake | open | closed
  start_date    date,
  end_date      date,
  intermittent  boolean NOT NULL DEFAULT false,
  priority      text NOT NULL DEFAULT 'Medium',
  jurisdiction  text NOT NULL DEFAULT 'US-CA',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Pay band: a governed band per normalized title_key. A band must be LOCKED before
-- it can reach payroll or a posting (governance). Market values are operator-supplied
-- and confidence-scored, never invented (§2 invariant 2).
CREATE TABLE IF NOT EXISTS pay_band (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  title_key   text NOT NULL,
  unit        text NOT NULL,
  p10         numeric(12,2),
  p25         numeric(12,2),
  p50         numeric(12,2),
  p75         numeric(12,2),
  p90         numeric(12,2),
  confidence  integer,
  locked      boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text,
  actor_id   text,
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  action     text NOT NULL,
  detail     jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);

-- Idempotent indexes & uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS worker_tenant_file_uniq ON worker (tenant_id, file_number);
CREATE INDEX IF NOT EXISTS worker_tenant_idx ON worker (tenant_id);
CREATE INDEX IF NOT EXISTS worker_mgr_idx ON worker (tenant_id, manager_id);
CREATE INDEX IF NOT EXISTS position_titlekey_idx ON position (tenant_id, title_key);
CREATE INDEX IF NOT EXISTS comp_tenant_worker_idx ON compensation_record (tenant_id, worker_id);
CREATE INDEX IF NOT EXISTS leave_tenant_worker_idx ON leave_case (tenant_id, worker_id);
CREATE INDEX IF NOT EXISTS leave_tenant_status_idx ON leave_case (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS payband_tenant_titlekey_uniq ON pay_band (tenant_id, title_key);
CREATE INDEX IF NOT EXISTS audit_tenant_at_idx ON audit_log (tenant_id, at);

-- ---------------------------------------------------------------------------
-- Append-only audit trigger. Stamps actor/tenant from the request GUCs that
-- withActor() sets LOCAL to the transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hros_audit() RETURNS trigger AS $$
DECLARE
  ent text := TG_TABLE_NAME;
  eid text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    eid := OLD.id::text;
  ELSE
    eid := NEW.id::text;
  END IF;
  INSERT INTO audit_log (tenant_id, actor_id, entity, entity_id, action, detail, at)
  VALUES (
    current_setting('app.tenant_id', true),
    current_setting('app.actor_id', true),
    ent, eid, TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END,
    now()
  );
  IF (TG_OP = 'DELETE') THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['worksite','org_unit','position','worker','compensation_record','leave_case','pay_band']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'audit_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hros_audit()',
      'audit_' || t, t
    );
  END LOOP;
END $$;

-- Application role privileges (idempotent, guarded). hros_app is the non-superuser
-- principal the server connects as; RLS still scopes every row to the tenant GUC.
-- It does NOT own these tables, so the audit_log REVOKE below actually binds
-- (a table owner cannot be constrained by REVOKE). audit_log is append-only:
-- INSERT/SELECT only -- no UPDATE/DELETE/TRUNCATE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hros_app') THEN
    GRANT USAGE ON SCHEMA public TO hros_app;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON tenant, worksite, org_unit, position, worker, compensation_record, leave_case, pay_band
      TO hros_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM hros_app;
    GRANT INSERT, SELECT ON audit_log TO hros_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security: every business table is scoped to the request's tenant
-- GUC. Policies are created idempotently.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['worksite','org_unit','position','worker','compensation_record','leave_case','pay_band']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- app_user: SSO/SCIM-provisioned platform identities (distinct from `worker`,
-- the HR employee record). Added additively (this phase); tenant-scoped,
-- RLS-FORCED, and audited by the same append-only trigger as every business
-- table. Safe to re-run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  external_id  text NOT NULL,            -- IdP object id (oid/sub) or SCIM externalId
  user_name    text NOT NULL,           -- userPrincipalName / SCIM userName (.example in demo)
  role         text NOT NULL DEFAULT 'employee',
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_user_tenant_extid_uniq ON app_user (tenant_id, external_id);
CREATE INDEX IF NOT EXISTS app_user_tenant_idx ON app_user (tenant_id);

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS audit_app_user ON app_user';
  EXECUTE 'CREATE TRIGGER audit_app_user AFTER INSERT OR UPDATE OR DELETE ON app_user FOR EACH ROW EXECUTE FUNCTION hros_audit()';
  EXECUTE 'ALTER TABLE app_user ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE app_user FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS app_user_tenant_isolation ON app_user';
  EXECUTE 'CREATE POLICY app_user_tenant_isolation ON app_user USING (tenant_id::text = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hros_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app_user TO hros_app;
  END IF;
END $$;
