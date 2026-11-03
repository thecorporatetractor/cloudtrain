import { sql } from 'kysely';
import type { Tx } from '../db/index.js';
import type { SystemOutcome } from './ledger.js';

/*
 * Download my data (GDPR Art. 15 and 20): one person's rows across all orgs, as JSON.
 * Each query filters on the person; nothing about another member is included. Never in here:
 * session tokens, CSRF tokens, invitation token hashes, exam seeds and task pools (exam content,
 * not personal data).
 */

export interface AccountExport {
  exportedAt: string;
  profile: unknown;
  sections: Record<string, unknown[]>;
}

export async function collectAccountExport(tx: Tx, userId: string, email: string, now: Date): Promise<{ data: AccountExport; outcomes: SystemOutcome[] }> {
  const lower = email.trim().toLowerCase();
  const profile = await tx.selectFrom('users').select(['id', 'email', 'name', 'title', 'avatar_url', 'last_login_at', 'last_idp', 'created_at']).where('id', '=', userId).executeTakeFirst();
  const q = (query: Promise<unknown[]>) => query;
  const sections: Record<string, unknown[]> = {
    memberships: await q(tx.selectFrom('memberships as m').innerJoin('orgs as o', 'o.id', 'm.org_id').select(['o.name as organisation', 'm.roles', 'm.status', 'm.source', 'm.created_at']).where('m.user_id', '=', userId).execute()),
    teams: await q(tx.selectFrom('team_members as tm').innerJoin('teams as t', 't.id', 'tm.team_id').select(['t.name as team', 'tm.role', 'tm.source']).where('tm.user_id', '=', userId).execute()),
    cohorts: await q(tx.selectFrom('cohort_members as cm').innerJoin('cohorts as c', 'c.id', 'cm.cohort_id').select(['c.name as cohort', 'c.starts_at', 'c.ends_at']).where('cm.user_id', '=', userId).execute()),
    invitations: await q(tx.selectFrom('invitations').select(['org_id', 'email', 'roles', 'created_at', 'expires_at', 'accepted_at', 'revoked_at']).where(sql`lower(email)`, '=', lower).execute()),
    assignments: await q(tx.selectFrom('assignments').select(['item_kind', 'item_id', 'due_at', 'required', 'note', 'created_at']).where('target_kind', '=', 'user').where('target_id', '=', userId).execute()),
    labAttempts: await q(tx.selectFrom('lab_attempts').selectAll().where('user_id', '=', userId).orderBy('started_at').execute()),
    checkResults: await q(tx.selectFrom('check_results as c').innerJoin('lab_attempts as a', 'a.id', 'c.attempt_id').select(['c.attempt_id', 'c.check_id', 'c.run', 'c.passed', 'c.weight', 'c.skills', 'c.message', 'c.graded_at']).where('a.user_id', '=', userId).execute()),
    labHints: await q(tx.selectFrom('lab_hint_reveals').select(['lab_id', 'session_name', 'hint_index', 'revealed_at']).where('user_id', '=', userId).execute()),
    skillEvidence: await q(tx.selectFrom('skill_evidence').selectAll().where('user_id', '=', userId).execute()),
    skillState: await q(tx.selectFrom('learner_skill_state').selectAll().where('user_id', '=', userId).execute()),
    goals: await q(tx.selectFrom('learner_goals').selectAll().where('user_id', '=', userId).execute()),
    notices: await q(tx.selectFrom('session_notices').selectAll().where('user_id', '=', userId).execute()),
    examAttempts: await q(tx.selectFrom('exam_attempts').select(['org_id', 'id', 'exam_id', 'exam_title', 'number', 'phase', 'started_at', 'submitted_at', 'completed_at', 'duration_minutes', 'score', 'passed', 'report', 'voided_at', 'void_reason']).where('user_id', '=', userId).execute()),
    examTaskResults: await q(tx.selectFrom('exam_task_results as t').innerJoin('exam_attempts as a', (j) => j.onRef('a.org_id', '=', 't.org_id').onRef('a.id', '=', 't.attempt_id')).select(['t.attempt_id', 't.task_index', 't.objective', 't.weight', 't.outcome', 't.score']).where('a.user_id', '=', userId).execute()),
    examRetakeGrants: await q(tx.selectFrom('exam_retake_grants').select(['exam_id', 'reason', 'created_at', 'used_at']).where('user_id', '=', userId).execute()),
    answerSubmissions: await q(tx.selectFrom('answer_submissions').select(['lab_id', 'check_id', 'answer', 'correct', 'points', 'submitted_at', 'event_id', 'team_id']).where('user_id', '=', userId).execute()),
    answerHints: await q(tx.selectFrom('answer_hint_reveals').select(['lab_id', 'check_id', 'hint_index', 'cost', 'revealed_at', 'event_id', 'team_id']).where('user_id', '=', userId).execute()),
    events: await q(tx.selectFrom('ctf_event_participants as p').innerJoin('ctf_events as e', 'e.id', 'p.event_id').select(['e.title as event', 'p.team_id', 'p.joined_at']).where('p.user_id', '=', userId).execute()),
    billingCustomers: await q(tx.selectFrom('billing_customers').select(['stripe_customer_id', 'email', 'has_payment_method', 'created_at']).where('user_id', '=', userId).execute()),
    billingSubscriptions: await q(tx.selectFrom('billing_subscriptions').select(['stripe_subscription_id', 'plan_id', 'kind', 'status', 'billing_interval', 'current_period_end', 'created_at']).where('user_id', '=', userId).execute()),
    billingUsage: await q(tx.selectFrom('billing_usage').select(['lab_id', 'session_name', 'compute_tier', 'started_at', 'ended_at', 'minutes', 'units', 'billable', 'trial']).where('user_id', '=', userId).execute()),
    signIns: await q(tx.selectFrom('auth_sessions').select(['created_at', 'last_seen_at', 'expires_at', 'ip', 'user_agent', 'idp']).where('user_id', '=', userId).execute()),
    activity: await q(tx.selectFrom('audit_log').select(['at', 'action', 'target_type', 'target_label', 'ip', 'details']).where('actor_id', '=', userId).orderBy('at').limit(5000).execute()),
    aboutYou: await q(tx.selectFrom('audit_log').select(['at', 'action', 'target_type']).where('target_id', '=', userId).where((eb) => eb.or([eb('actor_id', 'is', null), eb('actor_id', '<>', userId)])).orderBy('at').limit(5000).execute()),
  };
  const outcomes: SystemOutcome[] = [{ system: 'postgres.users', category: 'identity', action: 'exported', rows: profile ? 1 : 0 }];
  for (const [name, rows] of Object.entries(sections)) outcomes.push({ system: `postgres.${name}`, category: 'account', action: 'exported', rows: rows.length });
  return { data: { exportedAt: now.toISOString(), profile: profile ?? null, sections }, outcomes };
}
