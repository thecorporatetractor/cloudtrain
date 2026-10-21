import { sql, type Kysely } from 'kysely';

/*
 * Pay for compute (services/gateway/src/billing, docs/billing.md): metered lab
 * sessions, the outbox of Stripe meter events, organisation seats, spend caps,
 * and the payment and dunning state of a billing customer.
 *
 * Same tenancy as 0007_billing: org_id on every row, RLS on app.org_id
 * (app.platform for the webhook, the sweep and the outbox worker), DML granted
 * to the app role.
 *
 * - billing_usage: one row per metered lab session (session_name unique):
 *   who ran it, who pays (payer_key: a user id, or '' for the organisation),
 *   the compute tier and its rate when it started, start and end, billed
 *   minutes and units. Trial sessions and sessions without a billing account
 *   are recorded with billable = false.
 * - billing_meter_outbox: one Stripe meter event per billable usage row, keyed
 *   by its identifier (Stripe deduplicates on it too); written in the same
 *   transaction that ends the session, sent and retried by the outbox worker.
 * - billing_seats: organisation members holding a seat of the org plan.
 * - billing_limits: a monthly compute spend cap per (org, user-or-org) that
 *   overrides the site default.
 * - billing_customers gains the payment method flag, the dunning state and the
 *   compute (metered) subscription; billing_subscriptions gains `kind` so the
 *   compute subscription is kept apart from plan subscriptions.
 *
 * Additive and idempotent.
 */

export const COMPUTE_TENANT_TABLES = ['billing_usage', 'billing_meter_outbox', 'billing_seats', 'billing_limits'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    ALTER TABLE billing_customers ADD COLUMN IF NOT EXISTS has_payment_method boolean NOT NULL DEFAULT false;
    ALTER TABLE billing_customers ADD COLUMN IF NOT EXISTS invoice_failed_at timestamptz;
    ALTER TABLE billing_customers ADD COLUMN IF NOT EXISTS delinquent_since timestamptz;
    ALTER TABLE billing_customers ADD COLUMN IF NOT EXISTS compute_subscription_id text CHECK (compute_subscription_id IS NULL OR compute_subscription_id ~ '^sub_');
    ALTER TABLE billing_customers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'plan';
    DO $$ BEGIN
      ALTER TABLE billing_subscriptions ADD CONSTRAINT billing_subscriptions_kind CHECK (kind IN ('plan', 'compute'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS billing_usage (
      id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id            uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id           text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      lab_id            text        NOT NULL,
      session_name      text        NOT NULL UNIQUE,
      compute_tier      text        NOT NULL CHECK (compute_tier IN ('pod', 'vm', 'heavy')),
      units_per_minute  integer     NOT NULL CHECK (units_per_minute >= 0),
      unit_price        numeric(12, 6) NOT NULL CHECK (unit_price >= 0),
      payer_key         text        NOT NULL,
      customer_id       uuid        REFERENCES billing_customers ON DELETE SET NULL,
      trial             boolean     NOT NULL DEFAULT false,
      billable          boolean     NOT NULL,
      started_at        timestamptz NOT NULL,
      ended_at          timestamptz,
      minutes           integer     CHECK (minutes IS NULL OR minutes >= 0),
      units             integer     CHECK (units IS NULL OR units >= 0),
      created_at        timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS billing_usage_payer ON billing_usage (org_id, payer_key, started_at DESC);
    CREATE INDEX IF NOT EXISTS billing_usage_user ON billing_usage (org_id, user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS billing_usage_open ON billing_usage (started_at) WHERE ended_at IS NULL;

    CREATE TABLE IF NOT EXISTS billing_meter_outbox (
      id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id              uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      usage_id            uuid        NOT NULL UNIQUE REFERENCES billing_usage ON DELETE CASCADE,
      identifier          text        NOT NULL UNIQUE,
      event_name          text        NOT NULL,
      stripe_customer_id  text        NOT NULL CHECK (stripe_customer_id ~ '^cus_'),
      value               integer     NOT NULL CHECK (value >= 0),
      event_at            timestamptz NOT NULL,
      status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
      attempts            integer     NOT NULL DEFAULT 0,
      next_attempt_at     timestamptz NOT NULL DEFAULT now(),
      last_error          text,
      sent_at             timestamptz,
      created_at          timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS billing_meter_outbox_due ON billing_meter_outbox (next_attempt_at) WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS billing_seats (
      org_id       uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id      text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      assigned_by  text,
      assigned_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS billing_limits (
      org_id       uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id      text        REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      scope_key    text        GENERATED ALWAYS AS (coalesce(user_id, '')) STORED,
      monthly_cap  integer     NOT NULL CHECK (monthly_cap >= 0),
      hard_stop    boolean     NOT NULL,
      updated_by   text,
      updated_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, scope_key)
    );
  `.execute(db);

  for (const t of COMPUTE_TENANT_TABLES) {
    const tbl = sql.id(t);
    await sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant ON ${tbl}`.execute(db);
    await sql`CREATE POLICY tenant ON ${tbl} USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
  }
  await sql`GRANT SELECT, INSERT, UPDATE ON billing_usage, billing_meter_outbox, billing_limits TO ${app}`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON billing_seats TO ${app}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS billing_limits`.execute(db);
  await sql`DROP TABLE IF EXISTS billing_seats`.execute(db);
  await sql`DROP TABLE IF EXISTS billing_meter_outbox`.execute(db);
  await sql`DROP TABLE IF EXISTS billing_usage`.execute(db);
  await sql`ALTER TABLE billing_subscriptions DROP CONSTRAINT IF EXISTS billing_subscriptions_kind`.execute(db);
  await sql`ALTER TABLE billing_subscriptions DROP COLUMN IF EXISTS kind`.execute(db);
  for (const c of ['has_payment_method', 'invoice_failed_at', 'delinquent_since', 'compute_subscription_id', 'updated_at']) await sql`ALTER TABLE billing_customers DROP COLUMN IF EXISTS ${sql.id(c)}`.execute(db);
}
