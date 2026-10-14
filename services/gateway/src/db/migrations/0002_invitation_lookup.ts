import { sql, type Kysely } from 'kysely';

/** Invitation links are opened before any org is selected: a narrow definer lookup by token hash. */
export async function up(db: Kysely<unknown>, appRole = 'cloudtrain_app'): Promise<void> {
  await sql`
    CREATE FUNCTION auth_invitation_by_token(p_hash text)
      RETURNS TABLE (id uuid, org_id uuid, email text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT id, org_id, email, expires_at, accepted_at, revoked_at FROM invitations WHERE token_hash = p_hash
      $$;
    GRANT EXECUTE ON FUNCTION auth_invitation_by_token(text) TO ${sql.id(appRole)};
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS auth_invitation_by_token`.execute(db);
}
