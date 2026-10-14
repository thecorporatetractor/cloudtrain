import { sql, type Kysely } from 'kysely';

/*
 * Platform schema (docs/platform-identity.md "Data model").
 *
 * Tenancy: every tenant table carries org_id and has row-level security on.
 * The gateway connects as `cloudtrain_app` (not the owner, no BYPASSRLS) and
 * sets, per transaction:
 *   SET LOCAL app.org_id   = '<active org uuid>'
 *   SET LOCAL app.user_id  = '<caller sub>'
 *   SET LOCAL app.platform = 'on'      -- only on platform-admin code paths
 * A transaction without app.org_id sees no tenant rows at all.
 *
 * Lookups that must happen before the org is known (login routing, the
 * memberships list for the org switcher, background sweeps) go through a few
 * narrow SECURITY DEFINER functions (auth_*, sys_*), never a blanket bypass.
 *
 * The migration runs as the owner; `appRole` gets DML grants (audit_log:
 * SELECT + INSERT only, it is append-only).
 */

export const TENANT_TABLES = [
  'org_domains',
  'sso_connections',
  'memberships',
  'invitations',
  'teams',
  'team_members',
  'cohorts',
  'cohort_members',
  'assignments',
  'lab_attempts',
  'check_results',
  'skill_evidence',
  'learner_skill_state',
  'content_visibility',
  'quotas',
  'audit_log',
  'session_notices',
] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
    CREATE FUNCTION app_user_id() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
    CREATE FUNCTION app_platform() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT coalesce(current_setting('app.platform', true), '') = 'on' $$;

    CREATE TABLE orgs (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
      name        text NOT NULL,
      status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      settings    jsonb NOT NULL DEFAULT '{}',
      kc_org_id   text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE users (
      id             text PRIMARY KEY,               -- Keycloak sub ('pending-<uuid>' until first login)
      email          text NOT NULL,
      name           text NOT NULL,
      title          text,
      avatar_url     text,
      platform_roles text[] NOT NULL DEFAULT '{}',   -- {'platform_admin'}: not an org role
      last_login_at  timestamptz,
      last_idp       text,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX users_email ON users (lower(email));

    CREATE TABLE org_domains (
      org_id              uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      domain              text PRIMARY KEY CHECK (domain = lower(domain)),
      verification_token  text NOT NULL,
      verified_at         timestamptz,
      created_at          timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE sso_connections (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      kc_alias        text NOT NULL UNIQUE,
      type            text NOT NULL CHECK (type IN ('oidc', 'saml')),
      display_name    text NOT NULL,
      enforced        boolean NOT NULL DEFAULT false,
      group_mappings  jsonb NOT NULL DEFAULT '[]',
      default_roles   text[] NOT NULL DEFAULT '{learner}',
      settings        jsonb NOT NULL DEFAULT '{}',   -- non-secret IdP settings (the secret lives in Keycloak only)
      status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'error', 'disabled')),
      last_test       jsonb,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE memberships (
      org_id      uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id     text NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      roles       text[] NOT NULL DEFAULT '{learner}',
      status      text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'deactivated')),
      source      text NOT NULL DEFAULT 'local' CHECK (source IN ('sso', 'local', 'invite', 'seed')),
      invited_by  text REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, user_id),
      CHECK (roles <@ ARRAY['learner', 'manager', 'instructor', 'author', 'org_admin']::text[])
    );
    CREATE INDEX memberships_user ON memberships (user_id);

    CREATE TABLE invitations (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      email        text NOT NULL,
      user_id      text REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      roles        text[] NOT NULL,
      teams        jsonb NOT NULL DEFAULT '[]',
      token_hash   text NOT NULL UNIQUE,
      invited_by   text REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE,
      created_at   timestamptz NOT NULL DEFAULT now(),
      expires_at   timestamptz NOT NULL,
      accepted_at  timestamptz,
      revoked_at   timestamptz
    );
    CREATE INDEX invitations_email ON invitations (org_id, lower(email));

    CREATE TABLE teams (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      name        text NOT NULL,
      parent_id   uuid REFERENCES teams ON DELETE RESTRICT,
      created_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (org_id, name)
    );

    CREATE TABLE team_members (
      org_id   uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      team_id  uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
      user_id  text NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      role     text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'manager')),
      source   text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'sso')),
      PRIMARY KEY (team_id, user_id)
    );
    CREATE INDEX team_members_user ON team_members (org_id, user_id);

    CREATE TABLE cohorts (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      name            text NOT NULL,
      starts_at       timestamptz NOT NULL,
      ends_at         timestamptz NOT NULL,
      instructor_ids  text[] NOT NULL DEFAULT '{}',
      path_id         text,
      lab_ids         text[] NOT NULL DEFAULT '{}',
      created_by      text REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE,
      created_at      timestamptz NOT NULL DEFAULT now(),
      CHECK (ends_at > starts_at)
    );

    CREATE TABLE cohort_members (
      org_id     uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      cohort_id  uuid NOT NULL REFERENCES cohorts ON DELETE CASCADE,
      user_id    text NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      PRIMARY KEY (cohort_id, user_id)
    );

    CREATE TABLE assignments (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      target_kind  text NOT NULL CHECK (target_kind IN ('team', 'user', 'cohort')),
      target_id    text NOT NULL,
      item_kind    text NOT NULL CHECK (item_kind IN ('lab', 'path', 'framework')),
      item_id      text NOT NULL,
      lab_ids      text[] NOT NULL,                  -- the item's labs, resolved from content at creation
      due_at       timestamptz,
      required     boolean NOT NULL DEFAULT true,
      note         text,
      assigned_by  text REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX assignments_target ON assignments (org_id, target_kind, target_id);

    CREATE TABLE lab_attempts (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id        uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id       text NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      lab_id        text NOT NULL,
      lab_version   integer NOT NULL DEFAULT 1,
      difficulty    text NOT NULL DEFAULT 'medium',
      session_name  text NOT NULL UNIQUE,
      started_at    timestamptz NOT NULL DEFAULT now(),
      ended_at      timestamptz,
      outcome       text NOT NULL DEFAULT 'in_progress' CHECK (outcome IN ('in_progress', 'passed', 'partial', 'failed', 'abandoned')),
      score         integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
      hints_used    integer NOT NULL DEFAULT 0,
      validations   integer NOT NULL DEFAULT 0,
      duration_s    integer NOT NULL DEFAULT 0,
      checks_total  integer NOT NULL DEFAULT 0,
      checks_passed integer NOT NULL DEFAULT 0
    );
    CREATE INDEX lab_attempts_user ON lab_attempts (org_id, user_id, started_at DESC);
    CREATE INDEX lab_attempts_open ON lab_attempts (org_id) WHERE ended_at IS NULL;

    CREATE TABLE check_results (
      org_id      uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      attempt_id  uuid NOT NULL REFERENCES lab_attempts ON DELETE CASCADE,
      check_id    text NOT NULL,
      run         integer NOT NULL,
      passed      boolean NOT NULL,
      weight      real NOT NULL DEFAULT 1,
      skills      text[] NOT NULL DEFAULT '{}',
      message     text,
      graded_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (attempt_id, check_id, run)
    );

    CREATE TABLE skill_evidence (
      id          bigserial PRIMARY KEY,
      org_id      uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id     text NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      skill_id    text NOT NULL,
      attempt_id  uuid NOT NULL REFERENCES lab_attempts ON DELETE CASCADE,
      check_id    text NOT NULL,
      outcome     real NOT NULL,          -- 1 pass, 0 fail
      weight      real NOT NULL,          -- evidence weight (check weight x hint discount)
      difficulty  real NOT NULL,          -- 0..1
      at          timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX skill_evidence_user ON skill_evidence (org_id, user_id, skill_id, at);

    CREATE TABLE learner_skill_state (
      org_id      uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id     text NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      skill_id    text NOT NULL,
      mu          real NOT NULL,
      sigma       real NOT NULL,
      evidence    integer NOT NULL DEFAULT 0,
      last_delta  real NOT NULL DEFAULT 0,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, user_id, skill_id)
    );

    CREATE TABLE content_visibility (
      org_id   uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      kind     text NOT NULL CHECK (kind IN ('pack', 'lab', 'path')),
      ref_id   text NOT NULL,
      enabled  boolean NOT NULL DEFAULT true,   -- pack/lab: shown and startable
      pinned   boolean NOT NULL DEFAULT false,  -- path: pinned to the top
      PRIMARY KEY (org_id, kind, ref_id)
    );

    CREATE TABLE quotas (
      org_id                   uuid PRIMARY KEY REFERENCES orgs ON DELETE CASCADE,
      max_concurrent_sessions  integer NOT NULL DEFAULT 20 CHECK (max_concurrent_sessions >= 0),
      monthly_lab_hours        integer NOT NULL DEFAULT 500 CHECK (monthly_lab_hours >= 0),
      max_session_minutes      integer NOT NULL DEFAULT 120 CHECK (max_session_minutes > 0)
    );

    CREATE TABLE audit_log (
      id            bigserial PRIMARY KEY,
      org_id        uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      at            timestamptz NOT NULL DEFAULT clock_timestamp(),
      actor_id      text,
      actor_name    text,
      action        text NOT NULL,
      target_type   text NOT NULL,
      target_id     text NOT NULL,
      target_label  text,
      ip            text,
      details       jsonb NOT NULL DEFAULT '{}'
    );
    CREATE INDEX audit_log_org_at ON audit_log (org_id, at DESC, id DESC);

    CREATE TABLE session_notices (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id        uuid NOT NULL REFERENCES orgs ON DELETE CASCADE,
      user_id       text NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      session_name  text,                    -- null: applies to any session of the user (broadcast)
      kind          text NOT NULL,
      message       text NOT NULL,
      from_id       text,
      at            timestamptz NOT NULL DEFAULT now(),
      active        boolean NOT NULL DEFAULT false,
      ended_at      timestamptz
    );
    CREATE INDEX session_notices_user ON session_notices (org_id, user_id, at DESC);

    -- Gateway (BFF) login state and server-side sessions. Not tenant data: keyed
    -- by a hash of the cookie value, read before any org is selected.
    CREATE TABLE auth_login_states (
      state       text PRIMARY KEY,
      verifier    text NOT NULL,
      nonce       text NOT NULL,
      return_to   text NOT NULL DEFAULT '/',
      email       text,
      org_id      uuid,
      invite      text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE auth_sessions (
      id_hash           text PRIMARY KEY,
      user_id           text NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      org_id            uuid REFERENCES orgs ON DELETE CASCADE,
      csrf              text NOT NULL,
      kc_sid            text,
      idp               text,
      id_token          text,
      refresh_token     text,                -- AES-256-GCM sealed with CT_SESSION_SECRET
      access_expires_at timestamptz,
      expires_at        timestamptz NOT NULL,
      created_at        timestamptz NOT NULL DEFAULT now(),
      last_seen_at      timestamptz NOT NULL DEFAULT now(),
      ip                text,
      user_agent        text
    );
    CREATE INDEX auth_sessions_user ON auth_sessions (user_id);
    CREATE INDEX auth_sessions_sid ON auth_sessions (kc_sid);
  `.execute(db);

  // Row-level security on every tenant table.
  for (const t of TENANT_TABLES) {
    const tbl = sql.id(t);
    await sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`.execute(db);
    if (t === 'audit_log') {
      await sql`CREATE POLICY tenant_read ON ${tbl} FOR SELECT USING (org_id = app_org_id() OR app_platform())`.execute(db);
      await sql`CREATE POLICY tenant_append ON ${tbl} FOR INSERT WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
      await sql`GRANT SELECT, INSERT ON ${tbl} TO ${app}`.execute(db);
    } else {
      await sql`CREATE POLICY tenant ON ${tbl} USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
      await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tbl} TO ${app}`.execute(db);
    }
  }

  await sql`
    -- Orgs the current user belongs to (bypasses memberships RLS for app.user_id only).
    CREATE FUNCTION app_user_org_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
      $$ SELECT org_id FROM memberships WHERE user_id = app_user_id() AND status <> 'deactivated' $$;

    ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY org_read ON orgs FOR SELECT USING (id = app_org_id() OR app_platform() OR id IN (SELECT app_user_org_ids()));
    CREATE POLICY org_update ON orgs FOR UPDATE USING (id = app_org_id() OR app_platform()) WITH CHECK (id = app_org_id() OR app_platform());
    CREATE POLICY org_insert ON orgs FOR INSERT WITH CHECK (app_platform());
    CREATE POLICY org_delete ON orgs FOR DELETE USING (app_platform());

    -- Users are global identities; a request sees itself plus members of the active org.
    CREATE FUNCTION app_org_user_ids() RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
      $$ SELECT user_id FROM memberships WHERE org_id = app_org_id() $$;
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    CREATE POLICY user_read ON users FOR SELECT USING (id = app_user_id() OR app_platform() OR id IN (SELECT app_org_user_ids()));
    CREATE POLICY user_insert ON users FOR INSERT WITH CHECK (id = app_user_id() OR app_platform() OR app_org_id() IS NOT NULL);
    CREATE POLICY user_update ON users FOR UPDATE USING (id = app_user_id() OR app_platform() OR id IN (SELECT app_org_user_ids()));

    -- Login routing: which org claims an email domain / an IdP alias (no org selected yet).
    CREATE FUNCTION auth_org_for_domain(p_domain text)
      RETURNS TABLE (org_id uuid, slug text, name text, status text, verified boolean, idp_alias text, idp_name text, enforced boolean)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT o.id, o.slug, o.name, o.status, d.verified_at IS NOT NULL, s.kc_alias, s.display_name, coalesce(s.enforced, false)
        FROM org_domains d JOIN orgs o ON o.id = d.org_id
        LEFT JOIN LATERAL (SELECT * FROM sso_connections s WHERE s.org_id = o.id AND s.status = 'active' ORDER BY s.enforced DESC, s.created_at LIMIT 1) s ON true
        WHERE d.domain = lower(p_domain)
      $$;
    CREATE FUNCTION auth_org_for_idp(p_alias text) RETURNS TABLE (org_id uuid, status text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT s.org_id, o.status FROM sso_connections s JOIN orgs o ON o.id = s.org_id WHERE s.kc_alias = p_alias AND s.status <> 'disabled'
      $$;
    -- Every membership of one user (org switcher, login org choice).
    CREATE FUNCTION auth_user_memberships(p_user text)
      RETURNS TABLE (org_id uuid, slug text, name text, org_status text, logo_url text, roles text[], status text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT o.id, o.slug, o.name, o.status, o.settings->>'logoUrl', m.roles, m.status
        FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = p_user ORDER BY o.name
      $$;
    -- A user row by email, for claiming a pre-provisioned ('pending-…') identity on first login.
    CREATE FUNCTION auth_user_by_email(p_email text) RETURNS TABLE (id text, platform_roles text[])
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT id, platform_roles FROM users WHERE lower(email) = lower(p_email)
      $$;
    -- Background jobs iterate orgs, then work inside each org's RLS scope.
    CREATE FUNCTION sys_org_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
      $$ SELECT id FROM orgs $$;

    -- Per user x assignment status. security_invoker: the caller's RLS applies.
    CREATE VIEW assignment_targets WITH (security_invoker = true) AS
      SELECT a.id AS assignment_id, a.org_id, tm.user_id, 'team'::text AS via_kind, a.target_id AS via_id
        FROM assignments a JOIN team_members tm ON a.target_kind = 'team' AND tm.team_id::text = a.target_id
      UNION
      SELECT a.id, a.org_id, a.target_id, 'user', a.target_id FROM assignments a WHERE a.target_kind = 'user'
      UNION
      SELECT a.id, a.org_id, cm.user_id, 'cohort', a.target_id
        FROM assignments a JOIN cohort_members cm ON a.target_kind = 'cohort' AND cm.cohort_id::text = a.target_id;

    CREATE VIEW assignment_status WITH (security_invoker = true) AS
      SELECT t.assignment_id, t.org_id, t.user_id, t.via_kind, t.via_id, a.due_at, a.required,
             p.labs_total, p.labs_passed, p.labs_touched, p.best_score, p.completed_at,
             CASE
               WHEN p.labs_total > 0 AND p.labs_passed >= p.labs_total THEN 'completed'
               WHEN a.due_at IS NOT NULL AND a.due_at < now() THEN 'overdue'
               WHEN p.labs_touched > 0 THEN 'in_progress'
               ELSE 'not_started'
             END AS status,
             CASE WHEN p.labs_total = 0 THEN 0 ELSE p.labs_passed::real / p.labs_total END AS progress
      FROM assignment_targets t
      JOIN assignments a ON a.id = t.assignment_id
      CROSS JOIN LATERAL (
        SELECT cardinality(a.lab_ids) AS labs_total,
               count(DISTINCT la.lab_id) FILTER (WHERE la.outcome = 'passed') AS labs_passed,
               count(DISTINCT la.lab_id) AS labs_touched,
               max(la.score) AS best_score,
               CASE WHEN count(DISTINCT la.lab_id) FILTER (WHERE la.outcome = 'passed') >= cardinality(a.lab_ids)
                    THEN max(la.ended_at) FILTER (WHERE la.outcome = 'passed') END AS completed_at
        FROM lab_attempts la
        WHERE la.org_id = a.org_id AND la.user_id = t.user_id AND la.lab_id = ANY (a.lab_ids)
      ) p;
  `.execute(db);

  await sql`
    GRANT SELECT, INSERT, UPDATE, DELETE ON orgs, users TO ${app};
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_login_states, auth_sessions TO ${app};
    GRANT SELECT ON assignment_targets, assignment_status TO ${app};
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${app};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${app};
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP VIEW IF EXISTS assignment_status, assignment_targets;
    DROP TABLE IF EXISTS auth_sessions, auth_login_states, session_notices, audit_log, quotas, content_visibility,
      learner_skill_state, skill_evidence, check_results, lab_attempts, assignments, cohort_members, cohorts,
      team_members, teams, invitations, memberships, sso_connections, org_domains, users, orgs CASCADE;
    DROP FUNCTION IF EXISTS sys_org_ids, auth_user_by_email, auth_user_memberships, auth_org_for_idp, auth_org_for_domain,
      app_org_user_ids, app_user_org_ids, app_platform, app_user_id, app_org_id;
  `.execute(db);
}
