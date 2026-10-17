import { useCallback, useState } from 'react';
import type { GoalForecast } from '@/api/types';

/**
 * Study plan on the Home goal card. The gateway sends how many practice
 * minutes are still needed (`minutesToReady`); the learner may pick their own
 * exam date and weekly target. Both are per-browser preferences until the
 * platform stores learner goals.
 */

const DAY = 86_400_000;
const KEY = 'ct.home.plan';

export interface PlanPrefs {
  /** Overrides goal.targetDate (YYYY-MM-DD). */
  targetDate?: string;
  /** Weekly practice target in minutes. */
  weeklyTarget?: number;
}

function read(): PlanPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as PlanPrefs;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function usePlanPrefs(): [PlanPrefs, (p: PlanPrefs) => void] {
  const [prefs, setPrefs] = useState<PlanPrefs>(read);
  const save = useCallback((p: PlanPrefs) => {
    setPrefs(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* private window: keep it for this visit */
    }
  }, []);
  return [prefs, save];
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
  const minutesToReady = goal.minutesToReady ?? 0;
  const dailyNeeded = minutesToReady ? round5(minutesToReady / daysLeft(targetDate, now)) : 0;
  return {
    targetDate,
    dateChosen: !!prefs.targetDate || goal.targetDateSource === 'assignment',
    minutesToReady,
    dailyNeeded,
    weeklyNeeded: dailyNeeded * 7,
    ...(prefs.weeklyTarget ? { weeklyTarget: prefs.weeklyTarget } : {}),
    tooTight: dailyNeeded > SUSTAINABLE_DAILY,
  };
}

/** A date that keeps the plan near `daily` minutes a day. */
export function dateFor(minutesToReady: number, daily: number, now = Date.now()): string {
  return new Date(now + Math.ceil(minutesToReady / daily) * DAY).toISOString().slice(0, 10);
}
