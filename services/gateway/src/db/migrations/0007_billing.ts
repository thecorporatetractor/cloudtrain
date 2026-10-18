import { sql, type Kysely } from 'kysely';

/*
 * Billing (services/gateway/src/billing, docs/billing.md): Stripe customers,
 * subscriptions and the entitlements they grant, plus an append-only record of
 * every webhook event. Card data never reaches the platform; the only payment
 * identifiers stored are Stripe object ids.
 *
 * Same tenancy as 0001_platform: org_id on every row, RLS on app.org_id
 * (app.platform for the webhook, which runs before the org is known), DML
 * granted to the app role. Scope: a row with user_id is an individual's
 * (plan kind individual), without it the organisation's (kind organisation).
 *
 * - billing_customers: one Stripe customer per (org, user-or-org).
 * - billing_subscriptions: the subscriptions Stripe reported, latest state.
 * - billing_entitlements: the effective plan per (org, user-or-org); read by
 *   the app, written from subscription state. Not enforced yet (recorded and
 *   displayed; enforcement hook in src/billing/enforce.ts).
 * - billing_events: every webhook delivery by Stripe event id (idempotency),
 *   with a summary (ids, type, amounts) and the outcome. Append-only for the
 *   app role apart from the processing outcome.
 *
 * Additive and idempotent.
 */

export const BILLING_TENANT_TABLES = ['billing_customers', 'billing_subscriptions', 'billing_entitlements', 'billing_events'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS billing_customers (
      id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id              uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id             text        REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      scope_key           text        GENERATED ALWAYS AS (coalesce(user_id, '')) STORED,
      stripe_customer_id  text        NOT NULL UNIQUE CHECK (stripe_customer_id ~ '^cus_'),
      email               text,
      livemode            boolean     NOT NULL DEFAULT false,
      created_at          timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, scope_key)
    );

    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id                  uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id                 text        REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      customer_id             uuid        NOT NULL REFERENCES billing_customers ON DELETE CASCADE,
      stripe_subscription_id  text        NOT NULL UNIQUE CHECK (stripe_subscription_id ~ '^sub_'),
      plan_id                 text        NOT NULL,
      price_lookup_key        text,
      billing_interval        text        NOT NULL CHECK (billing_interval IN ('monthly', 'yearly')),
      seats                   integer     NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 100000),
      status                  text        NOT NULL,
      current_period_end      timestamptz,
      cancel_at_period_end    boolean     NOT NULL DEFAULT false,
      livemode                boolean     NOT NULL DEFAULT false,
      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS billing_subscriptions_scope ON billing_subscriptions (org_id, coalesce(user_id, ''), updated_at DESC);

    CREATE TABLE IF NOT EXISTS billing_entitlements (
      org_id          uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id         text        REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      scope_key       text        GENERATED ALWAYS AS (coalesce(user_id, '')) STORED,
      plan_id         text        NOT NULL,
      entitlements    jsonb       NOT NULL,
      source          text        NOT NULL CHECK (source IN ('subscription', 'default', 'manual')),
      subscription_id uuid        REFERENCES billing_subscriptions ON DELETE SET NULL,
      updated_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, scope_key)
    );

    CREATE TABLE IF NOT EXISTS billing_events (
      id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      stripe_event_id  text        NOT NULL UNIQUE CHECK (stripe_event_id ~ '^evt_'),
      type             text        NOT NULL,
      org_id           uuid        REFERENCES orgs ON DELETE SET NULL,
      user_id          text,
      livemode         boolean     NOT NULL DEFAULT false,
      received_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
      processed_at     timestamptz,
      status           text        NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
      error            text,
      summary          jsonb       NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS billing_events_org ON billing_events (org_id, received_at DESC);
  `.execute(db);

  for (const t of BILLING_TENANT_TABLES) {
    const tbl = sql.id(t);
    await sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant ON ${tbl}`.execute(db);
    await sql`CREATE POLICY tenant ON ${tbl} USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
  }
  await sql`GRANT SELECT, INSERT, UPDATE ON billing_customers, billing_subscriptions, billing_entitlements TO ${app}`.execute(db);
  // Events are appended and then marked processed; never deleted by the app.
  await sql`GRANT SELECT, INSERT, UPDATE (processed_at, status, error, summary, org_id, user_id) ON billing_events TO ${app}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS billing_events`.execute(db);
  await sql`DROP TABLE IF EXISTS billing_entitlements`.execute(db);
  await sql`DROP TABLE IF EXISTS billing_subscriptions`.execute(db);
  await sql`DROP TABLE IF EXISTS billing_customers`.execute(db);
}
