import { secretParams, type Lab as SourceLab } from '@cloudtrain/lab-schema';
import type { Lab, LabCheck, LabHint, LabQuestion } from '@cloudtrain/api-types';
import { labQuestions } from '../answers/questions.js';

/**
 * The learner's view of a lab. Only what the task panel and overview need:
 * expected values, check commands/queries, setup, the solution and the
 * misconceptions never leave the gateway, and hint bodies are withheld until
 * the hint is revealed on a session (see SessionService.revealHint).
 */
export function learnerLab(src: SourceLab): Lab {
  const checks: LabCheck[] = endStateChecks(src).map((c) => ({
    id: c.id,
    description: c.description,
    skills: [...c.skills],
    type: c.type,
    ...(c.weight !== undefined ? { weight: c.weight } : {}),
    ...(c.on ? { on: c.on } : {}),
  }));
  const hints: LabHint[] = (src.spec.hints ?? []).map((h) => ({ title: '', body: '', cost: h.cost ?? 1, redacted: true }));
  const sequential = src.spec.questionOrder === 'sequential';
  // Prompts of later questions in a sequential lab only appear once they open (GET /sessions/:id/questions).
  const questions: LabQuestion[] = labQuestions(src).map((q, i) => (sequential && i > 0 ? { ...q, prompt: '' } : q));
  return {
    apiVersion: 'cloudtrain.dev/v3',
    kind: 'Lab',
    metadata: { ...src.metadata },
    spec: {
      description: src.spec.description,
      ...(src.spec.objectives ? { objectives: [...src.spec.objectives] } : {}),
      topology: structuredClone(src.spec.topology),
      checks,
      hints,
      ...(questions.length ? { questions, questionOrder: sequential ? 'sequential' : 'free' } : {}),
    },
  };
}

/** The checks graded on end state (Validate); answer checks (questions) are graded on submitted answers. */
export function endStateChecks(src: SourceLab): SourceLab['spec']['checks'][number][] {
  return src.spec.checks.filter((c) => c.type !== 'answer');
}

/** Resolved params a learner may see: every param except the secret ones (answers depend on those). */
export function learnerParams(src: SourceLab, params: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!params) return undefined;
  const secret = secretParams(src);
  if (!secret.size) return params;
  return Object.fromEntries(Object.entries(params).filter(([k]) => !secret.has(k)));
}

const PARAM = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Substitutes resolved {{params}}; unknown names are left as they are. */
export function fillParams(text: string, params: Record<string, string> | undefined): string {
  if (!params) return text;
  return text.replace(PARAM, (m, name: string) => params[name] ?? m);
}

/** Full hint content for a revealed hint, with params filled in. */
export function revealedHint(src: SourceLab, index: number, params: Record<string, string> | undefined): LabHint | undefined {
  const h = src.spec.hints?.[index];
  if (!h) return undefined;
  return {
    title: fillParams(h.title, params),
    body: fillParams(h.body, params),
    ...(h.command ? { command: fillParams(h.command, params) } : {}),
    cost: h.cost ?? 1,
  };
}
