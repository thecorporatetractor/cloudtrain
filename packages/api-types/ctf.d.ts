/**
 * CTF shapes: questions (answer checks) of a lab session and their
 * submissions. Learner-safe by construction: expected answers, secret params
 * and computed values never appear here; a question carries only what the
 * questions panel shows.
 */

import type { UserRef } from './platform.js';

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
