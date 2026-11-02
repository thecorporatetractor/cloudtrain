import { sql, type Kysely } from 'kysely';

/*
 * GDPR data-subject rights and provable erasure (services/gateway/src/gdpr, docs/gdpr.md).
 *
 * - gdpr_ledger: the default evidence ledger (src/gdpr/ledger.ts, PostgresLedger): one
 *   hash-chained record per completed request, without any direct identifier. Append-only:
 *   the app role has SELECT and INSERT only, and a trigger refuses UPDATE, DELETE and
 *   TRUNCATE for every role, the owner included, unless a superuser or the owner turns it off.
 * - gdpr_requests: the work queue of the rights flows. `token_hash` is the hash of the
 *   confirmation link; `email_sealed` is the address, AES-GCM sealed with CT_SESSION_SECRET,
 *   and is cleared as soon as the request is finished or expires. Nothing here is tenant
 *   data: only platform code paths reach it.
 * - users gets its first DELETE policy. Without one, RLS makes the app role's
 *   `DELETE FROM users` a silent no-op.
 * - billing_usage rows outlive their user (the org's and the person's bill rest on them):
 *   user_id becomes nullable and SET NULL instead of CASCADE.
 * - gdpr_scrub_audit_log(): audit_log stays append-only for the app role; this one narrow
 *   SECURITY DEFINER function anonymises one person's traces in it (with or without an account:
 *   an address that was only ever refused at login sits in actor_name, target_label and ip too).
 * - sys_prune_audit_log(), sys_prune_gdpr_ledger(): the retention sweep (src/gdpr/retention.ts).
 *   Each deletes only rows past a hard floor, so a compromised app role cannot use them to wipe
 *   recent evidence. Ledger pruning leaves a signed checkpoint the chain continues from.
 *
 * Additive and idempotent.
 */

export const GDPR_TABLES = ['gdpr_ledger', 'gdpr_ledger_checkpoints', 'gdpr_requests'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS gdpr_ledger (
      seq          bigint      PRIMARY KEY CHECK (seq > 0),
      request_id   uuid        NOT NULL UNIQUE,
      type         text        NOT NULL CHECK (type IN ('erasure', 'withdrawal', 'export', 'restriction')),
      subject_key  text        NOT NULL CHECK (subject_key ~ '^[0-9a-f]{64}$'),
      prev_hash    text        NOT NULL UNIQUE CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
      hash         text        NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
      record       text        NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gdpr_ledger_subject ON gdpr_ledger (subject_key);

    CREATE OR REPLACE FUNCTION gdpr_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'gdpr_ledger is append-only';
      END
    $$;
    DROP TRIGGER IF EXISTS gdpr_ledger_no_change ON gdpr_ledger;
    CREATE TRIGGER gdpr_ledger_no_change BEFORE UPDATE OR DELETE ON gdpr_ledger FOR EACH ROW EXECUTE FUNCTION gdpr_ledger_immutable();
    DROP TRIGGER IF EXISTS gdpr_ledger_no_truncate ON gdpr_ledger;
    CREATE TRIGGER gdpr_ledger_no_truncate BEFORE TRUNCATE ON gdpr_ledger FOR EACH STATEMENT EXECUTE FUNCTION gdpr_ledger_immutable();

    CREATE TABLE IF NOT EXISTS gdpr_ledger_checkpoints (
      through_seq  bigint      PRIMARY KEY,
      record       text        NOT NULL
    );
    DROP TRIGGER IF EXISTS gdpr_checkpoints_no_change ON gdpr_ledger_checkpoints;
    CREATE TRIGGER gdpr_checkpoints_no_change BEFORE UPDATE OR DELETE ON gdpr_ledger_checkpoints FOR EACH ROW EXECUTE FUNCTION gdpr_ledger_immutable();
    DROP TRIGGER IF EXISTS gdpr_checkpoints_no_truncate ON gdpr_ledger_checkpoints;
    CREATE TRIGGER gdpr_checkpoints_no_truncate BEFORE TRUNCATE ON gdpr_ledger_checkpoints FOR EACH STATEMENT EXECUTE FUNCTION gdpr_ledger_immutable();

    CREATE TABLE IF NOT EXISTS gdpr_requests (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      type          text        NOT NULL CHECK (type IN ('erasure', 'withdrawal', 'export', 'restriction')),
      scope         text        NOT NULL CHECK (scope IN ('waitlist', 'account')),
      actor         text        NOT NULL DEFAULT 'self' CHECK (actor IN ('self', 'admin')),
      subject_key   text        NOT NULL,
      user_key      text,
      token_hash    text        UNIQUE,
      email_sealed  text,
      user_id       text,
      status        text        NOT NULL CHECK (status IN ('awaiting_confirmation', 'processing', 'evidence_pending', 'completed')),
      requested_at  timestamptz NOT NULL,
      verified_at   timestamptz,
      expires_at    timestamptz,
      completed_at  timestamptz,
      lease_until   timestamptz,
      attempts      integer     NOT NULL DEFAULT 0,
      last_error    text,
      state         jsonb       NOT NULL DEFAULT '{}'::jsonb,
      ledger_seq    bigint
    );
    CREATE INDEX IF NOT EXISTS gdpr_requests_open ON gdpr_requests (status, lease_until) WHERE status <> 'completed';
    CREATE INDEX IF NOT EXISTS gdpr_requests_subject ON gdpr_requests (subject_key, requested_at DESC);
  `.execute(db);

  await sql`ALTER TABLE gdpr_ledger ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE gdpr_requests ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE gdpr_ledger_checkpoints ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS gdpr_checkpoints_read ON gdpr_ledger_checkpoints`.execute(db);
  await sql`CREATE POLICY gdpr_checkpoints_read ON gdpr_ledger_checkpoints FOR SELECT USING (app_platform())`.execute(db);
  await sql`GRANT SELECT ON gdpr_ledger_checkpoints TO ${app}`.execute(db);
  await sql`DROP POLICY IF EXISTS gdpr_ledger_read ON gdpr_ledger`.execute(db);
  await sql`DROP POLICY IF EXISTS gdpr_ledger_append ON gdpr_ledger`.execute(db);
  await sql`DROP POLICY IF EXISTS gdpr_requests_platform ON gdpr_requests`.execute(db);
  await sql`CREATE POLICY gdpr_ledger_read ON gdpr_ledger FOR SELECT USING (app_platform())`.execute(db);
  await sql`CREATE POLICY gdpr_ledger_append ON gdpr_ledger FOR INSERT WITH CHECK (app_platform())`.execute(db);
  await sql`CREATE POLICY gdpr_requests_platform ON gdpr_requests USING (app_platform()) WITH CHECK (app_platform())`.execute(db);
  await sql`GRANT SELECT, INSERT ON gdpr_ledger TO ${app}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON gdpr_requests TO ${app}`.execute(db);

  // The one way a user row goes away: a platform code path (the erasure service).
  await sql`DROP POLICY IF EXISTS user_delete ON users`.execute(db);
  await sql`CREATE POLICY user_delete ON users FOR DELETE USING (app_platform())`.execute(db);

  await sql`
    ALTER TABLE billing_usage ALTER COLUMN user_id DROP NOT NULL;
    ALTER TABLE billing_usage DROP CONSTRAINT IF EXISTS billing_usage_user_id_fkey;
    ALTER TABLE billing_usage ADD CONSTRAINT billing_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE;
  `.execute(db);

  // Rows that name the person: as actor, as target, by label, or in the details. Case-insensitive
  // for the address. Refuses outside a platform code path, like the policies do.
  await sql.raw(String.raw`
    CREATE OR REPLACE FUNCTION gdpr_scrub_details(p_details text, p_user text, p_email_re text, p_customers text[]) RETURNS jsonb
      LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE
        scrubbed text := regexp_replace(p_details, p_email_re, '[erased]', 'gi');
        c text;
      BEGIN
        scrubbed := replace(scrubbed, p_user, '[erased]');
        FOREACH c IN ARRAY p_customers LOOP
          scrubbed := replace(scrubbed, c, 'cus_erased');
        END LOOP;
        RETURN scrubbed::jsonb;
      END
    $fn$;

    CREATE OR REPLACE FUNCTION gdpr_scrub_audit_log(p_user text, p_email text, p_name text, p_customers text[]) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
      DECLARE
        n integer;
        email_re text := regexp_replace(p_email, '([.\\+*?\[\]^$(){}|-])', '\\\1', 'g');
      BEGIN
        IF NOT app_platform() THEN
          RAISE EXCEPTION 'gdpr_scrub_audit_log needs a platform code path';
        END IF;
        IF coalesce(p_email, '') = '' THEN
          RAISE EXCEPTION 'gdpr_scrub_audit_log needs the address';
        END IF;
        UPDATE audit_log a SET
          actor_id = CASE WHEN a.actor_id = p_user THEN NULL ELSE a.actor_id END,
          actor_name = CASE WHEN a.actor_id = p_user OR lower(a.actor_name) = lower(p_email) THEN '[erased]' ELSE a.actor_name END,
          ip = CASE WHEN a.actor_id = p_user OR lower(a.actor_name) = lower(p_email) THEN NULL ELSE a.ip END,
          target_id = CASE
            WHEN a.target_id = p_user THEN '[erased]'
            WHEN a.target_id = ANY (p_customers) THEN 'cus_erased'
            -- A refused login names the attempted identity by address and by its Keycloak sub.
            WHEN a.target_type = 'user' AND (lower(a.target_label) = lower(p_email) OR lower(a.actor_name) = lower(p_email)) THEN '[erased]'
            ELSE a.target_id END,
          target_label = CASE WHEN lower(a.target_label) = lower(p_email) OR (a.target_type = 'user' AND (a.target_id = p_user OR a.target_label = p_name)) THEN '[erased]' ELSE a.target_label END,
          details = gdpr_scrub_details(a.details::text, p_user, email_re, p_customers)
        WHERE a.actor_id = p_user
           OR a.target_id = p_user
           OR a.target_id = ANY (p_customers)
           OR lower(a.actor_name) = lower(p_email)
           OR lower(a.target_label) = lower(p_email)
           OR (p_name <> '' AND a.target_type = 'user' AND a.target_label = p_name)
           OR (p_user <> '' AND position(p_user IN a.details::text) > 0)
           OR a.details::text ~* email_re
           OR EXISTS (SELECT 1 FROM unnest(p_customers) c WHERE position(c IN a.details::text) > 0);
        GET DIAGNOSTICS n = ROW_COUNT;
        RETURN n;
      END
    $fn$;
    REVOKE ALL ON FUNCTION gdpr_scrub_audit_log(text, text, text, text[]) FROM PUBLIC;

    -- Retention. audit_log stays append-only for the app role: this deletes one batch of rows
    -- older than the cutoff, and no cutoff can reach the last 28 days.
    CREATE OR REPLACE FUNCTION sys_prune_audit_log(p_cutoff timestamptz, p_limit integer) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
      DECLARE n integer;
      BEGIN
        IF NOT app_platform() THEN
          RAISE EXCEPTION 'sys_prune_audit_log needs a platform code path';
        END IF;
        IF p_cutoff > now() - interval '28 days' THEN
          RAISE EXCEPTION 'sys_prune_audit_log refuses a cutoff within the last 28 days';
        END IF;
        DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE at < p_cutoff ORDER BY at LIMIT p_limit);
        GET DIAGNOSTICS n = ROW_COUNT;
        RETURN n;
      END
    $fn$;
    REVOKE ALL ON FUNCTION sys_prune_audit_log(timestamptz, integer) FROM PUBLIC;

    -- Retention of the ledger: removes the oldest records through p_through and stores the signed
    -- checkpoint verification continues from. p_through must be the newest removed record, its hash must
    -- match, and a record newer than 12 months is never removed. The append-only trigger holds
    -- for everyone else: it is off only inside this function's transaction.
    CREATE OR REPLACE FUNCTION sys_prune_gdpr_ledger(p_through bigint, p_hash text, p_checkpoint text) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
      DECLARE n integer;
      BEGIN
        IF NOT app_platform() THEN
          RAISE EXCEPTION 'sys_prune_gdpr_ledger needs a platform code path';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM gdpr_ledger WHERE seq = p_through AND hash = p_hash) THEN
          RAISE EXCEPTION 'sys_prune_gdpr_ledger: no such record';
        END IF;
        IF EXISTS (SELECT 1 FROM gdpr_ledger WHERE seq <= p_through AND (record::jsonb->>'completedAt')::timestamptz > now() - interval '12 months') THEN
          RAISE EXCEPTION 'sys_prune_gdpr_ledger refuses records newer than 12 months';
        END IF;
        INSERT INTO gdpr_ledger_checkpoints (through_seq, record) VALUES (p_through, p_checkpoint);
        ALTER TABLE gdpr_ledger DISABLE TRIGGER gdpr_ledger_no_change;
        DELETE FROM gdpr_ledger WHERE seq <= p_through;
        GET DIAGNOSTICS n = ROW_COUNT;
        ALTER TABLE gdpr_ledger ENABLE TRIGGER gdpr_ledger_no_change;
        RETURN n;
      END
    $fn$;
    REVOKE ALL ON FUNCTION sys_prune_gdpr_ledger(bigint, text, text) FROM PUBLIC;
  `).execute(db);
  await sql`GRANT EXECUTE ON FUNCTION gdpr_scrub_audit_log(text, text, text, text[]) TO ${app}`.execute(db);
  await sql`GRANT EXECUTE ON FUNCTION sys_prune_audit_log(timestamptz, integer) TO ${app}`.execute(db);
  await sql`GRANT EXECUTE ON FUNCTION sys_prune_gdpr_ledger(bigint, text, text) TO ${app}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS sys_prune_gdpr_ledger(bigint, text, text)`.execute(db);
  await sql`DROP FUNCTION IF EXISTS sys_prune_audit_log(timestamptz, integer)`.execute(db);
  await sql`DROP FUNCTION IF EXISTS gdpr_scrub_audit_log(text, text, text, text[])`.execute(db);
  await sql`DROP FUNCTION IF EXISTS gdpr_scrub_details(text, text, text, text[])`.execute(db);
  await sql`DELETE FROM billing_usage WHERE user_id IS NULL`.execute(db);
  await sql`
    ALTER TABLE billing_usage DROP CONSTRAINT IF EXISTS billing_usage_user_id_fkey;
    ALTER TABLE billing_usage ADD CONSTRAINT billing_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE billing_usage ALTER COLUMN user_id SET NOT NULL;
  `.execute(db);
  await sql`DROP POLICY IF EXISTS user_delete ON users`.execute(db);
  await sql`DROP TABLE IF EXISTS gdpr_requests`.execute(db);
  await sql`DROP TABLE IF EXISTS gdpr_ledger_checkpoints`.execute(db);
  await sql`DROP TABLE IF EXISTS gdpr_ledger`.execute(db);
  await sql`DROP FUNCTION IF EXISTS gdpr_ledger_immutable()`.execute(db);
}
