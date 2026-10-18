/**
 * CTF shapes: questions (answer checks) of a lab session and their
 * submissions. Learner-safe by construction: expected answers, secret params
 * and computed values never appear here; a question carries only what the
 * questions panel shows.
 */

import type { UserRef } from './platform.js';
import type { Difficulty } from './index.js';

/** locked: waits for the question before it (sequential order). closed: out of attempts. */
export type QuestionState = 'locked' | 'open' | 'solved' | 'closed';

/** Static facts about a question, part of the lab view (`Lab.spec.questions`). */
export interface LabQuestion {
  id: string;
  /** The question (Markdown, params filled in). */
  prompt: string;
  skills: string[];
  /** `number` for number answers (numeric keyboard on phones); otherwise text. */
  input: 'text' | 'number';
  placeholder?: string;
  points: number;
  penalty: number;
  /** Wrong answers allowed before the question closes; absent = unlimited. */
  maxAttempts?: number;
  /** Point cost of each hint, in reveal order. */
  hintCosts: number[];
}

export interface QuestionHint {
  index: number;
  cost: number;
  revealed: boolean;
  /** Present once revealed. */
  body?: string;
  revealedBy?: UserRef;
}

export interface Question extends LabQuestion {
  state: QuestionState;
  wrongAttempts: number;
  /** Absent when attempts are unlimited. */
  attemptsLeft?: number;
  hints: QuestionHint[];
  /** Sum of the costs of revealed hints. */
  hintCost: number;
  /** Points a correct answer earns now: points (or the event's current value) minus penalties and hint costs, never below 0. */
  available: number;
  /** Points earned (solved questions). */
  awarded?: number;
  solvedAt?: string;
  /** The accepted answer as the solver typed it (their own input, never the expected value). */
  answer?: string;
  /** Who solved it (team events: possibly a teammate). */
  solvedBy?: UserRef;
  /** First solve of this question in the event. */
  firstBlood?: boolean;
}

export interface QuestionsView {
  sessionId: string;
  labId: string;
  order: 'free' | 'sequential';
  questions: Question[];
  /** Points earned so far. */
  earned: number;
  /** Points of every question at full value. */
  possible: number;
  solved: number;
  total: number;
  /** Present when the session belongs to a CTF event (progress shared with the team). */
  event?: { id: string; title: string; teamId?: string; teamName?: string; endsAt: string; scoring: 'static' | 'dynamic' };
}

export interface SubmitAnswerRequest {
  answer: string;
}

export interface SubmitAnswerResponse {
  correct: boolean;
  /** Learner-safe feedback ("Correct", "Not correct: 2 attempts left", ...). */
  message: string;
  view: QuestionsView;
}

/** Personal CTF totals (history and skills). */
export interface CtfTotals {
  points: number;
  solved: number;
  /** CTF labs with at least one answer submitted. */
  labs: number;
}

/* ================================================================ events */

export type CtfEventMode = 'solo' | 'team';
export type CtfScoring = 'static' | 'dynamic';
/** Derived from the window: upcoming before startsAt, running until endsAt, then ended. */
export type CtfEventStatus = 'draft' | 'upcoming' | 'running' | 'ended';

export interface CtfEventSettings {
  title: string;
  description?: string;
  /** CTF labs (labs with answer checks) of the event, in display order. */
  labIds: string[];
  startsAt: string;
  endsAt: string;
  mode: CtfEventMode;
  /** Team mode: largest team (1-20). */
  teamSizeMax?: number;
  /** Team mode: `self` = learners create and join teams; `manager` = the manager assigns members. */
  teamFormation?: 'self' | 'manager';
  scoring: CtfScoring;
  /** Dynamic scoring: a question's value never drops below this share of its points (1-100, default 30). */
  dynamicMinPct?: number;
  /** Dynamic scoring: number of solves at which a question reaches its minimum (default 10). */
  dynamicDecay?: number;
  /** Mark the first solve of every question. */
  firstBlood: boolean;
  /** Scoreboard frozen for learners during the last N minutes (0 = never). */
  freezeMinutes: number;
  /** Learners only see published events. */
  published: boolean;
}

export type CreateCtfEventRequest = CtfEventSettings;
export type UpdateCtfEventRequest = Partial<CtfEventSettings>;

export interface CtfEventLab {
  labId: string;
  title: string;
  difficulty: Difficulty;
  estimatedMinutes: number;
  questionCount: number;
  /** Sum of the questions' points at full value. */
  points: number;
}

export interface CtfTeam {
  id: string;
  name: string;
  members: UserRef[];
}

export interface CtfEventSummary extends CtfEventSettings {
  id: string;
  status: CtfEventStatus;
  createdBy: UserRef;
  participants: number;
  teams: number;
  /** The caller has joined. */
  joined: boolean;
}

export interface CtfEventDetail extends CtfEventSummary {
  labs: CtfEventLab[];
  /** Team mode: every team (names and members). */
  teamList: CtfTeam[];
  /** The caller's team (team mode) once joined. */
  myTeam?: CtfTeam;
  /** The caller's live session per lab, to resume. */
  mySessions: Record<string, string>;
  /** Server time, for countdowns. */
  serverNow: string;
  canManage: boolean;
}

export interface JoinCtfEventRequest {
  /** Team mode: join this team... */
  teamId?: string;
  /** ...or create a team with this name. */
  teamName?: string;
}

export interface CtfScoreRow {
  rank: number;
  /** Team id, or user id in solo events. */
  id: string;
  name: string;
  members: UserRef[];
  points: number;
  solves: number;
  firstBloods: number;
  /** Time of the last solve that scored (tie-break: earlier ranks higher). */
  lastSolveAt?: string;
}

export interface CtfSolve {
  at: string;
  /** Team id, or user id in solo events. */
  entrantId: string;
  entrantName: string;
  labId: string;
  checkId: string;
  questionNumber: number;
  /** Points this solve is worth now (dynamic scoring follows the solve count). */
  points: number;
  firstBlood: boolean;
  solvedBy?: UserRef;
}

export interface CtfQuestionStat {
  labId: string;
  checkId: string;
  questionNumber: number;
  prompt: string;
  points: number;
  /** Current value (dynamic scoring), else = points. */
  value: number;
  solves: number;
  firstBlood?: { entrantName: string; at: string };
}

export interface CtfScoreboard {
  eventId: string;
  title: string;
  mode: CtfEventMode;
  scoring: CtfScoring;
  status: CtfEventStatus;
  startsAt: string;
  endsAt: string;
  serverNow: string;
  /** Learners' view during the freeze: solves after `frozenAt` are hidden. */
  frozen: boolean;
  frozenAt?: string;
  rows: CtfScoreRow[];
  /** Cumulative points per entrant over time (top entrants), for the timeline. */
  timeline: { entrantId: string; name: string; points: { at: string; total: number }[] }[];
  /** Most recent solves first. */
  solves: CtfSolve[];
  questions: CtfQuestionStat[];
  /** The caller's row id (their team, or themselves). */
  mine?: string;
}

/** Manager view: the live scoreboard plus participation. */
export interface CtfEventReport {
  event: CtfEventDetail;
  scoreboard: CtfScoreboard;
  participants: { user: UserRef; teamId?: string; teamName?: string; joinedAt: string; submissions: number; correct: number; hints: number; lastActivityAt?: string }[];
}
