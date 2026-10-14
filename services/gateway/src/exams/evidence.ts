import type { ExamReport, ExamSkillEvidence } from '@cloudtrain/api-types';

/** One graded exam task as evidence for the learner model. */
export interface TaskEvidence {
  index: number;
  taskId: string;
  /** Lab difficulty of the task (easy/medium/hard) for the evidence weight. */
  difficulty: string;
  /** Percent. */
  score: number;
  checks: { id: string; passed: boolean; weight: number; skills: string[] }[];
}

export interface ExamEvidenceInput {
  orgId: string;
  userId: string;
  attemptId: string;
  examId: string;
  at: Date;
  startedAt: Date;
  tasks: TaskEvidence[];
}

/**
 * Feeds exam results into the learner model. Called exactly once per graded
 * attempt (the attempt record's `evidenceRecorded` guards it).
 *
 * Platform-api adapter (Postgres): one `recordRun(tx, ...)` per task from
 * services/gateway/src/learner/learning.ts, inside `withTenant(db, { orgId,
 * userId })`, with `sessionName: "<attemptId>/t<index>"`, `lab` = the task's
 * lab.yaml, `score` = task score, `checks` = the task's checks, `hintsUsed: 0`
 * (exams have no hints), `at` = graded time. That writes lab_attempts,
 * check_results and skill_evidence rows and updates learner_skill_state with
 * the same Glicko-style model as labs, so exam evidence and lab evidence are
 * one stream.
 */
export interface ExamEvidenceSink {
  record(input: ExamEvidenceInput): Promise<void>;
}

/** Keeps evidence in memory (tests, dev gateway without Postgres). */
export class MemoryEvidenceSink implements ExamEvidenceSink {
  readonly recorded: ExamEvidenceInput[] = [];
  async record(input: ExamEvidenceInput): Promise<void> {
    this.recorded.push(structuredClone(input));
  }
}

/** Per-skill pass/fail counts of a report (the report's skill breakdown). */
export function skillEvidence(report: Pick<ExamReport, 'tasks'>): ExamSkillEvidence[] {
  const by = new Map<string, ExamSkillEvidence>();
  for (const t of report.tasks) {
    for (const c of t.checks) {
      for (const s of c.skills) {
        const e = by.get(s) ?? { skillId: s, passed: 0, failed: 0 };
        if (c.passed) e.passed++;
        else e.failed++;
        by.set(s, e);
      }
    }
  }
  return [...by.values()].sort((a, b) => a.skillId.localeCompare(b.skillId));
}
