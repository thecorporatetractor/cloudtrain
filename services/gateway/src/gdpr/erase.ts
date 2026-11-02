import { sql } from 'kysely';
import type { Tx } from '../db/index.js';
import type { SystemOutcome } from './ledger.js';

/*
 * The erasure itself, inside one platform-scoped transaction (docs/gdpr.md has the data map
 * this implements; test/gdpr-pg.test.ts fails when a table with a personal column is missing here).
 *
 * Deleting the users row cascades through the foreign keys. Referential actions run as the
 * table owner and ignore RLS and grants, so answer_submissions (no DELETE for the app role)
 * goes too. The waitlist is not here: it has its own store interface (src/waitlist/store.ts) and
 * is a step of its own in the service, so it can live elsewhere. Rows are counted first so the ledger can say how many went, and checked again
 * afterwards in the same transaction, so a record can only say what is true.
 */

export interface DataMapEntry {
  /** Evidence label. */
  category: string;
  action: 'deleted' | 'anonymised' | 'retained' | 'none';
}

/** Tables whose rows hang off users(id) and go with it. */
export const CASCADE_TABLES = {
  memberships: 'organisation',
  team_members: 'organisation',
  cohort_members: 'organisation',
  invitations: 'organisation',
  session_notices: 'learning',
  lab_attempts: 'learning',
  skill_evidence: 'learning',
  learner_skill_state: 'learning',
  learner_goals: 'learning',
  exam_attempts: 'exams',
  exam_retake_grants: 'exams',
  answer_submissions: 'ctf',
  answer_hint_reveals: 'ctf',
  ctf_event_participants: 'ctf',
  billing_customers: 'billing',
  billing_subscriptions: 'billing',
  billing_entitlements: 'billing',
  billing_seats: 'billing',
  billing_limits: 'billing',
  auth_sessions: 'identity',
} as const satisfies Record<string, string>;

type CascadeTable = keyof typeof CASCADE_TABLES;

/**
 * Every table with a column that points at a person, and what erasure does with it. A test
 * compares this with the live schema, so a new personal column cannot slip past erasure.
 */
export const PERSONAL_COLUMNS: Record<string, string[]> = {
  users: ['id', 'email', 'name', 'title', 'avatar_url', 'last_login_at', 'last_idp', 'restricted_at', 'closed_at', 'closed_orgs', 'inactivity_warned_at', 'privacy_notice_version', 'privacy_notice_at'],
  memberships: ['user_id', 'invited_by'],
  invitations: ['email', 'user_id', 'invited_by'],
  team_members: ['user_id'],
  cohorts: ['instructor_ids', 'created_by'],
  cohort_members: ['user_id'],
  assignments: ['target_id', 'assigned_by'],
  lab_attempts: ['user_id'],
  skill_evidence: ['user_id'],
  learner_skill_state: ['user_id'],
  learner_goals: ['user_id'],
  audit_log: ['actor_id', 'actor_name', 'target_id', 'target_label', 'ip', 'details'],
  session_notices: ['user_id', 'from_id', 'message'],
  auth_login_states: ['email'],
  auth_sessions: ['user_id', 'ip', 'user_agent'],
  exam_attempts: ['user_id', 'voided_by'],
  exam_retake_grants: ['user_id', 'granted_by'],
  answer_submissions: ['user_id'],
  answer_hint_reveals: ['user_id'],
  ctf_events: ['created_by'],
  ctf_event_teams: ['created_by'],
  ctf_event_participants: ['user_id'],
  billing_customers: ['user_id', 'email'],
  billing_subscriptions: ['user_id'],
  billing_entitlements: ['user_id'],
  billing_events: ['user_id', 'summary'],
  billing_usage: ['user_id', 'payer_key'],
  billing_meter_outbox: ['stripe_customer_id'],
  billing_seats: ['user_id', 'assigned_by'],
  billing_limits: ['user_id', 'updated_by'],
  waitlist_entries: ['email', 'organisation', 'role'],
  gdpr_requests: ['email_sealed', 'user_id'],
};

export const INVOICE_LEGAL_BASIS = 'Invoices are kept by Stripe for the retention period of tax and accounting law (GDPR Art. 17(3)(b)); the period is confirmed by counsel.';
export const USAGE_LEGAL_BASIS = 'Anonymous usage rows support issued invoices (GDPR Art. 17(3)(b)); no link to the person remains.';
export const AUDIT_LEGAL_BASIS = "Security log of the organisation, kept without the person's identifiers (GDPR Art. 6(1)(f)).";
export const BACKUP_LEGAL_BASIS = 'Database dumps expire after 14 days; gdpr:reapply re-erases after a restore.';

const count = async (tx: Tx, table: string, column: string, value: string): Promise<number> => {
  const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.id(table)} WHERE ${sql.id(column)} = ${value}`.execute(tx);
  return r.rows[0]?.n ?? 0;
};

const outcome = (system: string, category: string, action: SystemOutcome['action'], rows: number, legalBasis?: string): SystemOutcome => ({ system, category, action, rows, ...(legalBasis ? { legalBasis } : {}) });

/** An address with no account: only the traces in the audit log (a refused login, an invitation). */
export async function scrubAuditByAddress(tx: Tx, email: string): Promise<SystemOutcome> {
  const r = await sql<{ n: number }>`SELECT gdpr_scrub_audit_log('', ${email}, '', '{}'::text[]) AS n`.execute(tx);
  const rows = r.rows[0]?.n ?? 0;
  return outcome('postgres.audit_log', 'audit', rows ? 'anonymised' : 'none', rows, rows ? AUDIT_LEGAL_BASIS : undefined);
}

export interface AccountSubject {
  userId: string;
  email: string;
  name: string;
  stripeCustomerIds: string[];
}

/**
 * Deletes and anonymises every row of one person, across all orgs. The transaction must be
 * platform-scoped: rows of an org the person has since left must go too, and the caller has
 * no org context for those. Every statement is filtered on this person, by id or by address.
 */
export async function eraseAccountRows(tx: Tx, s: AccountSubject): Promise<SystemOutcome[]> {
  const out: SystemOutcome[] = [];
  const email = s.email.trim().toLowerCase();

  // Text columns that hold the id without a foreign key.
  const noticesFrom = await tx.updateTable('session_notices').set({ from_id: null, message: sql`replace(message, ${s.name}, 'A staff member')` }).where('from_id', '=', s.userId).executeTakeFirst();
  const seats = await tx.updateTable('billing_seats').set({ assigned_by: null }).where('assigned_by', '=', s.userId).executeTakeFirst();
  const limits = await tx.updateTable('billing_limits').set({ updated_by: null }).where('updated_by', '=', s.userId).executeTakeFirst();
  const instructors = await tx.updateTable('cohorts').set({ instructor_ids: sql`array_remove(instructor_ids, ${s.userId})` }).where(sql<boolean>`${s.userId} = ANY (instructor_ids)`).executeTakeFirst();
  const assignments = await tx.deleteFrom('assignments').where('target_kind', '=', 'user').where('target_id', '=', s.userId).executeTakeFirst();
  out.push(outcome('postgres.assignments', 'learning', 'deleted', Number(assignments.numDeletedRows ?? 0)));
  const references = Number(noticesFrom.numUpdatedRows ?? 0) + Number(seats.numUpdatedRows ?? 0) + Number(limits.numUpdatedRows ?? 0) + Number(instructors.numUpdatedRows ?? 0);
  out.push(outcome('postgres.references', 'organisation', 'anonymised', references));

  // Invitations and login attempts by address, including those without a user row.
  const invited = await tx.deleteFrom('invitations').where(sql`lower(email)`, '=', email).where((eb) => eb.or([eb('user_id', 'is', null), eb('user_id', '<>', s.userId)])).executeTakeFirst();
  out.push(outcome('postgres.invitations_by_address', 'organisation', 'deleted', Number(invited.numDeletedRows ?? 0)));
  const logins = await tx.deleteFrom('auth_login_states').where(sql`lower(email)`, '=', email).executeTakeFirst();
  out.push(outcome('postgres.auth_login_states', 'identity', 'deleted', Number(logins.numDeletedRows ?? 0)));

  // The bill stands, without the person: usage they paid or ran, what went to Stripe, webhook history.
  const paid = await tx.updateTable('billing_usage').set({ payer_key: 'erased' }).where('payer_key', '=', s.userId).executeTakeFirst();
  const ran = await count(tx, 'billing_usage', 'user_id', s.userId);
  out.push(outcome('postgres.billing_usage', 'billing', 'anonymised', Math.max(ran, Number(paid.numUpdatedRows ?? 0)), USAGE_LEGAL_BASIS));
  if (s.stripeCustomerIds.length) {
    const meter = await tx.updateTable('billing_meter_outbox').set({ stripe_customer_id: 'cus_erased' }).where('stripe_customer_id', 'in', s.stripeCustomerIds).where('status', '<>', 'pending').executeTakeFirst();
    out.push(outcome('postgres.billing_meter_outbox', 'billing', 'anonymised', Number(meter.numUpdatedRows ?? 0), USAGE_LEGAL_BASIS));
  }
  const events = await tx
    .updateTable('billing_events')
    .set({
      user_id: null,
      summary: sql`gdpr_scrub_details(summary::text, ${s.userId}, ${email.replace(/[.\\+*?[\]^$(){}|-]/g, '\\$&')}, ${sql.val(s.stripeCustomerIds)}::text[])`,
    })
    .where((eb) => eb.or([eb('user_id', '=', s.userId), ...s.stripeCustomerIds.map((c) => eb(sql<string>`summary::text`, 'like', `%${c}%`))]))
    .executeTakeFirst();
  out.push(outcome('postgres.billing_events', 'billing', 'anonymised', Number(events.numUpdatedRows ?? 0)));

  // The audit log stays append-only for the app role; this narrow function scrubs one person from it.
  const scrubbed = await sql<{ n: number }>`SELECT gdpr_scrub_audit_log(${s.userId}, ${s.email}, ${s.name}, ${sql.val(s.stripeCustomerIds)}::text[]) AS n`.execute(tx);
  out.push(outcome('postgres.audit_log', 'audit', 'anonymised', scrubbed.rows[0]?.n ?? 0, AUDIT_LEGAL_BASIS));

  // Count what is about to go, then delete the identity; the foreign keys take the rest.
  const counts: { table: CascadeTable; rows: number }[] = [];
  for (const table of Object.keys(CASCADE_TABLES) as CascadeTable[]) counts.push({ table, rows: await count(tx, table, 'user_id', s.userId) });
  const checks = await sql<{ n: number }>`SELECT count(*)::int AS n FROM check_results c JOIN lab_attempts a ON a.id = c.attempt_id WHERE a.user_id = ${s.userId}`.execute(tx);
  const tasks = await sql<{ n: number }>`SELECT count(*)::int AS n FROM exam_task_results t JOIN exam_attempts a ON a.org_id = t.org_id AND a.id = t.attempt_id WHERE a.user_id = ${s.userId}`.execute(tx);
  const gone = await tx.deleteFrom('users').where('id', '=', s.userId).executeTakeFirst();
  if (Number(gone.numDeletedRows ?? 0) !== 1) throw new Error('erasure: the identity row was not deleted');
  out.push(outcome('postgres.users', 'identity', 'deleted', 1));
  for (const { table, rows } of counts) out.push(outcome(`postgres.${table}`, CASCADE_TABLES[table], rows ? 'deleted' : 'none', rows));
  out.push(outcome('postgres.check_results', 'learning', checks.rows[0]?.n ? 'deleted' : 'none', checks.rows[0]?.n ?? 0));
  out.push(outcome('postgres.exam_task_results', 'exams', tasks.rows[0]?.n ? 'deleted' : 'none', tasks.rows[0]?.n ?? 0));

  // Verified, not assumed: nothing of this person is left in the tables the map names.
  for (const table of Object.keys(CASCADE_TABLES) as CascadeTable[]) {
    if ((await count(tx, table, 'user_id', s.userId)) !== 0) throw new Error(`erasure: rows left in ${table}`);
  }
  if ((await count(tx, 'billing_usage', 'user_id', s.userId)) !== 0) throw new Error('erasure: rows left in billing_usage');
  const byAddress = await sql<{ n: number }>`SELECT (SELECT count(*) FROM invitations WHERE lower(email) = ${email}) + (SELECT count(*) FROM users WHERE lower(email) = ${email}) AS n`.execute(tx);
  if (Number(byAddress.rows[0]?.n ?? 0) !== 0) throw new Error('erasure: rows left under the address');
  return out;
}
