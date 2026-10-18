import { sql, type Kysely } from 'kysely';

/*
 * CTF events (services/gateway/src/events, docs/ctf-events.md).
 *
 * Same tenancy as 0001_platform: org_id on every row, RLS on app.org_id
 * (app.platform for platform code paths), DML granted to the app role.
 *
 * - ctf_events: a timed event over a set of CTF labs, solo or team, with its
 *   scoring rules (static or dynamic points, first bloods, scoreboard freeze).
 * - ctf_event_teams: teams of a team event (unique name per event).
 * - ctf_event_participants: who joined, and their team. One row per person
 *   and event, so a person is in at most one team.
 *
 * Submissions and hint reveals stay in answer_submissions /
 * answer_hint_reveals (0005_ctf_answers) with event_id and team_id set; the
 * scoreboard is computed from them. Additive and idempotent.
 */

export const EVENT_TENANT_TABLES = ['ctf_events', 'ctf_event_teams', 'ctf_event_participants'] as const;

export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  const app = sql.id(appRole);
  await sql`
    CREATE TABLE IF NOT EXISTS ctf_events (
      id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id           uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      title            text        NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
      description      text,
      lab_ids          text[]      NOT NULL CHECK (cardinality(lab_ids) BETWEEN 1 AND 50),
      starts_at        timestamptz NOT NULL,
      ends_at          timestamptz NOT NULL,
      mode             text        NOT NULL CHECK (mode IN ('solo', 'team')),
      team_size_max    integer     NOT NULL DEFAULT 1 CHECK (team_size_max BETWEEN 1 AND 20),
      team_formation   text        NOT NULL DEFAULT 'self' CHECK (team_formation IN ('self', 'manager')),
      scoring          text        NOT NULL CHECK (scoring IN ('static', 'dynamic')),
      dynamic_min_pct  integer     NOT NULL DEFAULT 30 CHECK (dynamic_min_pct BETWEEN 1 AND 100),
      dynamic_decay    integer     NOT NULL DEFAULT 10 CHECK (dynamic_decay BETWEEN 1 AND 1000),
      first_blood      boolean     NOT NULL DEFAULT true,
      freeze_minutes   integer     NOT NULL DEFAULT 0 CHECK (freeze_minutes >= 0),
      published        boolean     NOT NULL DEFAULT false,
      created_by       text        REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      CHECK (ends_at > starts_at)
    );
    CREATE INDEX IF NOT EXISTS ctf_events_window ON ctf_events (org_id, starts_at DESC);

    CREATE TABLE IF NOT EXISTS ctf_event_teams (
      id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      event_id    uuid        NOT NULL REFERENCES ctf_events ON DELETE CASCADE,
      name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
      created_by  text        REFERENCES users ON DELETE SET NULL ON UPDATE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ctf_event_teams_name ON ctf_event_teams (event_id, lower(name));

    CREATE TABLE IF NOT EXISTS ctf_event_participants (
      org_id      uuid        NOT NULL REFERENCES orgs ON DELETE CASCADE,
      event_id    uuid        NOT NULL REFERENCES ctf_events ON DELETE CASCADE,
      user_id     text        NOT NULL REFERENCES users ON DELETE CASCADE ON UPDATE CASCADE,
      team_id     uuid        REFERENCES ctf_event_teams ON DELETE SET NULL,
      joined_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id, event_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS ctf_event_participants_team ON ctf_event_participants (event_id, team_id);
  `.execute(db);
  for (const t of EVENT_TENANT_TABLES) {
    const tbl = sql.id(t);
    await sql`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant ON ${tbl}`.execute(db);
    await sql`CREATE POLICY tenant ON ${tbl} USING (org_id = app_org_id() OR app_platform()) WITH CHECK (org_id = app_org_id() OR app_platform())`.execute(db);
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tbl} TO ${app}`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS ctf_event_participants, ctf_event_teams, ctf_events`.execute(db);
}
