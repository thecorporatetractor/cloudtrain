import type { Lab as SourceLab } from '@cloudtrain/lab-schema';
import type { Lab, LabCheck, LabHint } from '@cloudtrain/api-types';

/**
 * The learner's view of a lab. Only what the task panel and overview need:
 * expected values, check commands/queries, setup, the solution and the
 * misconceptions never leave the gateway, and hint bodies are withheld until
 * the hint is revealed on a session (see SessionService.revealHint).
 */
export function learnerLab(src: SourceLab): Lab {
  const checks: LabCheck[] = src.spec.checks.map((c) => ({
    id: c.id,
    description: c.description,
    skills: [...c.skills],
    type: c.type,
    ...(c.weight !== undefined ? { weight: c.weight } : {}),
    ...(c.on ? { on: c.on } : {}),
  }));
  const hints: LabHint[] = (src.spec.hints ?? []).map((h) => ({ title: '', body: '', cost: h.cost ?? 1, redacted: true }));
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
    },
  };
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
