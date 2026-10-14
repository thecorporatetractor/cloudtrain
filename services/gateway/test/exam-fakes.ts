import path from 'node:path';
import { loadContent, type Content } from '../src/content/load.js';
import { loadExamCatalog, type ExamCatalog } from '../src/exams/catalog.js';
import { parseCompiled, type CompiledExam, type ExamCompiler } from '../src/exams/compile.js';
import type { ExamCluster, ExamSession, ExamTemplate } from '../src/exams/kube.js';
import type { LabTemplate } from '../src/kube/types.js';
import { fixtureLabs, repo } from './fakes.js';

/* Exam engine test doubles shared by exams.test.ts and exams-pg.test.ts. */

export const EXAM = 'sim-test-k8s-dev';
export const examDir = path.join(repo, 'services/lab-orchestrator/testdata/exams');

let content: Promise<Content> | undefined;
/** Real content plus the gateway fixture labs and the orchestrator's exam test tasks. */
export function examContent(): Promise<Content> {
  content ??= loadContent(path.join(repo, 'content'), [fixtureLabs, path.join(examDir, 'tasks')]);
  return content;
}
export async function catalog(): Promise<ExamCatalog> {
  return loadExamCatalog(await examContent(), path.join(repo, 'content'), path.join(repo, 'content/curriculum.yaml'), [path.join(examDir, 'exams.yaml')]);
}

const clone = <T>(v: T): T => structuredClone(v);
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = mergePatch((target[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    else target[k] = v;
  }
  return target;
}

/** In-memory exam objects; tests play the orchestrator by setting status. */
export class FakeExamCluster implements ExamCluster {
  labTemplates = new Map<string, LabTemplate>();
  examTemplates = new Map<string, ExamTemplate>();
  sessions = new Map<string, ExamSession>();
  async getLabTemplate(name: string) {
    return this.labTemplates.get(name) ?? null;
  }
  async createLabTemplate(t: LabTemplate) {
    this.labTemplates.set(t.metadata.name, clone(t));
  }
  async getExamTemplate(name: string) {
    return this.examTemplates.get(name) ?? null;
  }
  async createExamTemplate(t: ExamTemplate) {
    this.examTemplates.set(t.metadata.name, clone(t));
  }
  async getExamSession(name: string) {
    const s = this.sessions.get(name);
    return s ? clone(s) : null;
  }
  async createExamSession(s: ExamSession) {
    this.sessions.set(s.metadata.name, clone(s));
    return clone(s);
  }
  async patchExamSession(name: string, patch: Record<string, unknown>) {
    const s = this.sessions.get(name)!;
    mergePatch(s as unknown as Record<string, unknown>, patch);
    return clone(s);
  }
  async deleteExamSession(name: string) {
    this.sessions.delete(name);
  }

  /** The controller drew two tasks and the shared environment is ready. */
  inProgress(name: string, startedAt: string) {
    const s = this.sessions.get(name)!;
    s.status = {
      phase: 'InProgress',
      message: 'The exam is in progress.',
      examID: EXAM,
      startedAt,
      deadline: new Date(Date.parse(startedAt) + 30 * 60_000).toISOString(),
      tasks: [
        { index: 1, id: 'xt-scale-manifest-api', objective: 'ckad:deployment', weight: '40', seed: 1, templateRef: 't1', title: 'Scale the manifest API', statement: 'Scale to **4** replicas.', environment: `${name}-env`, nodes: ['workstation', 'exam-core'], contexts: ['exam-core'] },
        { index: 2, id: 'xt-secret-literal', objective: 'ckad:environment-config-security', weight: '35', seed: 2, templateRef: 't2', title: 'Store the cargo API token', statement: 'Token qltok-abcde', environment: `${name}-env`, nodes: ['workstation', 'exam-core'], contexts: ['exam-core'] },
        { index: 3, id: 'xt-expose-clusterip', objective: 'ckad:services-networking', weight: '25', seed: 3, templateRef: 't3', title: 'Expose', statement: 'Port 8080', environment: `${name}-env`, nodes: ['workstation', 'exam-edge'], contexts: ['exam-edge'] },
      ],
      environments: [
        {
          name: `${name}-env`,
          tasks: [1, 2, 3],
          phase: 'Ready',
          entryNode: 'workstation',
          nodes: ['workstation', 'exam-core', 'exam-edge'],
          endpoints: [{ node: 'workstation', access: 'shell', protocol: 'k8s-exec', target: `ns/${name}-env-workstation-x/node` }],
        },
      ],
    };
  }

  /** The controller graded the attempt. */
  completed(name: string, score: string, passed: boolean) {
    const s = this.sessions.get(name)!;
    s.status = {
      ...s.status,
      phase: 'Completed',
      message: 'Your exam has been graded.',
      submittedAt: s.status?.startedAt,
      frozenAt: new Date(Date.parse(s.status!.startedAt!) + 12 * 60_000).toISOString(),
      completedAt: new Date(Date.parse(s.status!.startedAt!) + 13 * 60_000).toISOString(),
      environmentReleased: true,
      environments: s.status!.environments!.map((e) => ({ ...e, endpoints: [] })),
      report: {
        score,
        passMark: '66',
        passed,
        partialCredit: 'per-check',
        passes: ['initial', 'rerun'],
        gradedAt: new Date(Date.parse(s.status!.startedAt!) + 13 * 60_000).toISOString(),
        objectives: [
          { id: 'ckad:deployment', weight: '40', tasks: 1, score: '100' },
          { id: 'ckad:environment-config-security', weight: '35', tasks: 1, score: '50' },
          { id: 'ckad:services-networking', weight: '25', tasks: 1, score: '0' },
        ],
        tasks: [
          { index: 1, id: 'xt-scale-manifest-api', title: 'Scale', objective: 'ckad:deployment', weight: '40', outcome: 'pass', score: '100', checks: [{ id: 'desired-replicas', passed: true, weight: '1', skills: ['k8s.workloads.scaling'], message: 'passed' }] },
          {
            index: 2,
            id: 'xt-secret-literal',
            title: 'Secret',
            objective: 'ckad:environment-config-security',
            weight: '35',
            outcome: 'partial',
            score: '50',
            checks: [
              { id: 'token-value', passed: true, weight: '1', skills: ['k8s.security.secrets'], message: 'passed' },
              { id: 'generic-type', passed: false, weight: '1', skills: ['k8s.security.secrets'], message: 'no longer satisfied after the idempotency re-run', failedOnRerun: true },
            ],
          },
          { index: 3, id: 'xt-expose-clusterip', title: 'Expose', objective: 'ckad:services-networking', weight: '25', outcome: 'fail', score: '0', checks: [{ id: 'service-ports', passed: false, weight: '1', skills: ['k8s.networking.services'], message: 'not satisfied yet' }] },
        ],
      },
    };
  }
}

/** labctl stand-in: compiles nothing, returns an ExamTemplate + one task template. */
export class StubExamCompiler implements ExamCompiler {
  calls = 0;
  async compile(examId: string): Promise<CompiledExam> {
    this.calls++;
    return parseCompiled(`apiVersion: labs.cloudtrain.dev/v1alpha1
kind: LabTemplate
metadata: {name: xt-scale-manifest-api-v1-0123456789, creationTimestamp: null}
spec: {source: {id: xt-scale-manifest-api, version: 1}}
---
apiVersion: labs.cloudtrain.dev/v1alpha1
kind: ExamTemplate
metadata: {name: ${examId}-abcdef0123}
spec: {source: {id: ${examId}, title: T}, durationMinutes: 30, passMark: "66"}
`);
  }
}

