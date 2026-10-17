import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, put, request } from '@/api/client';
import type { GoalForecast, LearnerGoals, UpdateLearnerGoalsRequest } from '@/api/types';

/**
 * Study plan on the Home goal card. The gateway sends how many practice
 * minutes are still needed (`minutesToReady`); the learner may pick their own
 * exam date and weekly target, stored on the server (`/api/me/goals`, per org).
 *
 * Before goals were stored on the server the app kept them in localStorage
 * (KEY). On the first load with the server available they are imported once
 * (`source: 'browser'`: only fields not set yet) and the key is removed.
 * Without the goals API (a gateway running without a database) the app keeps
 * using localStorage.
 */

const DAY = 86_400_000;
const KEY = 'ct.home.plan';

export interface PlanPrefs {
  /** Overrides goal.targetDate (YYYY-MM-DD). */
  targetDate?: string;
  /** Weekly practice target in minutes. */
  weeklyTarget?: number;
}

function readLocal(): PlanPrefs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PlanPrefs;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
function writeLocal(p: PlanPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private window: keep it for this visit */
  }
}
function dropLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const toPrefs = (g: LearnerGoals): PlanPrefs => ({ ...(g.targetDate ? { targetDate: g.targetDate } : {}), ...(g.weeklyTargetMinutes ? { weeklyTarget: g.weeklyTargetMinutes } : {}) });
const GOALS_KEY = ['me', 'goals'] as const;

/** The goals API is missing (gateway without a database): fall back to localStorage. */
const unsupported = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);

export interface PlanPrefsState {
  prefs: PlanPrefs;
  save: (p: PlanPrefs) => void;
  saving: boolean;
  /** Last save failed; the card shows it and keeps the previous goals. */
  error?: string;
}

export function usePlanPrefs(): PlanPrefsState {
  const qc = useQueryClient();
  const goals = useQuery({ queryKey: GOALS_KEY, queryFn: () => request<LearnerGoals>('/api/me/goals'), staleTime: 5 * 60_000, retry: (n, e) => !unsupported(e) && n < 1 });
  const local = goals.isError && unsupported(goals.error);
  const [localPrefs, setLocalPrefs] = useState<PlanPrefs>(() => readLocal() ?? {});

  const mutation = useMutation({
    mutationFn: (body: UpdateLearnerGoalsRequest) => put<LearnerGoals>('/api/me/goals', body),
    onSuccess: (g) => {
      qc.setQueryData(GOALS_KEY, g);
      // The goal card's numbers (daily minutes, source of the date) come from /api/home.
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
  });

  // One-time import of the old per-browser goals.
  const imported = useRef(false);
  useEffect(() => {
    if (imported.current || !goals.isSuccess) return;
    imported.current = true;
    const old = readLocal();
    if (!old) return;
    if (!old.targetDate && !old.weeklyTarget) return dropLocal();
    mutation.mutate({ source: 'browser', ...(old.targetDate ? { targetDate: old.targetDate } : {}), ...(old.weeklyTarget ? { weeklyTargetMinutes: Math.round(old.weeklyTarget) } : {}) }, { onSuccess: dropLocal });
  }, [goals.isSuccess, mutation]);

  const save = useCallback(
    (p: PlanPrefs) => {
      if (local) {
        setLocalPrefs(p);
        writeLocal(p);
        return;
      }
      mutation.mutate({ targetDate: p.targetDate ?? null, weeklyTargetMinutes: p.weeklyTarget ?? null });
    },
    [local, mutation],
  );

  if (local) return { prefs: localPrefs, save, saving: false };
  // While a save is in flight show what was asked for.
  const pending = mutation.isPending && mutation.variables && mutation.variables.source !== 'browser' ? mutation.variables : undefined;
  const prefs = pending ? toPrefs({ targetDate: pending.targetDate ?? null, weeklyTargetMinutes: pending.weeklyTargetMinutes ?? null, updatedAt: null }) : goals.data ? toPrefs(goals.data) : {};
  return { prefs, save, saving: mutation.isPending, ...(mutation.isError ? { error: mutation.error.message } : {}) };
}

/** Days from today until the end of `date` (at least 1). */
export function daysLeft(date: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((Date.parse(`${date}T23:59:59`) - now) / DAY));
}

/** Rounded up to 5 minutes: a target people can remember. */
const round5 = (m: number) => Math.max(5, Math.ceil(m / 5) * 5);

export interface Plan {
  targetDate: string;
  /** The learner picked the date (here or through an assignment). */
  dateChosen: boolean;
  minutesToReady: number;
  dailyNeeded: number;
  weeklyNeeded: number;
  /** The learner's own weekly target, if set. */
  weeklyTarget?: number;
  /** Above this a plan is hard to sustain: suggest a later date. */
  tooTight: boolean;
}

export const SUSTAINABLE_DAILY = 60;

export function planOf(goal: GoalForecast, prefs: PlanPrefs, now = Date.now()): Plan {
  const targetDate = prefs.targetDate ?? goal.targetDate;
  const weeklyTarget = prefs.weeklyTarget ?? goal.weeklyTargetMinutes;
  const minutesToReady = goal.minutesToReady ?? 0;
  const dailyNeeded = minutesToReady ? round5(minutesToReady / daysLeft(targetDate, now)) : 0;
  return {
    targetDate,
    dateChosen: !!prefs.targetDate || goal.targetDateSource === 'assignment' || goal.targetDateSource === 'learner',
    minutesToReady,
    dailyNeeded,
    weeklyNeeded: dailyNeeded * 7,
    ...(weeklyTarget ? { weeklyTarget } : {}),
    tooTight: dailyNeeded > SUSTAINABLE_DAILY,
  };
}

/** A date that keeps the plan near `daily` minutes a day. */
export function dateFor(minutesToReady: number, daily: number, now = Date.now()): string {
  return new Date(now + Math.ceil(minutesToReady / daily) * DAY).toISOString().slice(0, 10);
}
