import { sql } from 'kysely';
import type { LearnerGoals, UpdateLearnerGoalsRequest } from '@cloudtrain/api-types';
import type { Tx } from '../db/index.js';
import { badRequest } from '../errors.js';

/*
 * The learner's own study goals (table learner_goals, migration 0004): exam
 * date and weekly practice target. One row per (org, user); RLS keeps it in
 * the active org and every query here also filters on the caller.
 */

const DAY = 86_400_000;
export const WEEKLY_TARGET_MIN = 5;
export const WEEKLY_TARGET_MAX = 3000;
/** How far ahead an exam date may be. */
const MAX_YEARS_AHEAD = 3;

export const NO_GOALS: LearnerGoals = { targetDate: null, weeklyTargetMinutes: null, updatedAt: null };

export async function readGoals(tx: Tx, userId: string): Promise<LearnerGoals> {
  const r = await tx
    .selectFrom('learner_goals')
    .select([sql<string | null>`target_date::text`.as('target_date'), 'weekly_target_minutes', 'updated_at'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!r) return NO_GOALS;
  return { targetDate: r.target_date, weeklyTargetMinutes: r.weekly_target_minutes, updatedAt: r.updated_at.toISOString() };
}

/** A valid calendar date YYYY-MM-DD, from yesterday (time zones) up to MAX_YEARS_AHEAD. */
export function checkTargetDate(v: unknown, now: Date): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest('targetDate must be a date (YYYY-MM-DD) or null.', { targetDate: 'invalid' });
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v) throw badRequest('targetDate is not a calendar date.', { targetDate: 'invalid' });
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (t < today - DAY) throw badRequest('targetDate is in the past.', { targetDate: 'past' });
  if (t > today + MAX_YEARS_AHEAD * 366 * DAY) throw badRequest(`targetDate is more than ${MAX_YEARS_AHEAD} years ahead.`, { targetDate: 'too_far' });
  return v;
}

export function checkWeeklyTarget(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < WEEKLY_TARGET_MIN || v > WEEKLY_TARGET_MAX) {
    throw badRequest(`weeklyTargetMinutes must be a whole number of minutes from ${WEEKLY_TARGET_MIN} to ${WEEKLY_TARGET_MAX}, or null.`, { weeklyTargetMinutes: 'invalid' });
  }
  return v;
}

/**
 * Applies `req` to the caller's goals. Fields left out stay; null clears.
 * `source: 'browser'` is the one-time import of the web app's old
 * localStorage goals: it fills only fields that are still unset, and an
 * invalid or stale value (an exam date already past) is dropped instead of
 * failing the import.
 */
export async function writeGoals(tx: Tx, orgId: string, userId: string, req: UpdateLearnerGoalsRequest, now: Date): Promise<LearnerGoals> {
  if (!req || typeof req !== 'object') throw badRequest('Body must be an object.');
  const importing = req.source === 'browser';
  const lenient = <T>(f: () => T): T | undefined => {
    try {
      return f();
    } catch (e) {
      if (importing) return undefined;
      throw e;
    }
  };
  const next: { target_date?: string | null; weekly_target_minutes?: number | null } = {};
  if (req.targetDate !== undefined) {
    const v = lenient(() => checkTargetDate(req.targetDate, now));
    if (v !== undefined) next.target_date = v;
  }
  if (req.weeklyTargetMinutes !== undefined) {
    const v = lenient(() => checkWeeklyTarget(req.weeklyTargetMinutes));
    if (v !== undefined) next.weekly_target_minutes = v;
  }
  const current = await readGoals(tx, userId);
  if (importing) {
    if (current.targetDate !== null) delete next.target_date;
    if (current.weeklyTargetMinutes !== null) delete next.weekly_target_minutes;
  }
  if (!Object.keys(next).length) return current;
  await tx
    .insertInto('learner_goals')
    .values({ org_id: orgId, user_id: userId, target_date: next.target_date ?? null, weekly_target_minutes: next.weekly_target_minutes ?? null, updated_at: now })
    .onConflict((oc) => oc.columns(['org_id', 'user_id']).doUpdateSet({ ...next, updated_at: now }))
    .execute();
  return readGoals(tx, userId);
}
