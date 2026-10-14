import { ApiException, CustomObjectsApi, PatchStrategy, setHeaderOptions, type KubeConfig } from '@kubernetes/client-node';
import { ConflictError } from '../kube/cluster.js';
import { LABS_API_VERSION, LABS_GROUP, LABS_VERSION, type Condition, type Endpoint, type LabTemplate, type ObjectMeta } from '../kube/types.js';

/*
 * The subset of the exam API (labs.cloudtrain.dev/v1alpha1 ExamTemplate,
 * ExamSession) the gateway reads and writes. Source of truth:
 * services/lab-orchestrator/api/v1alpha1/exam_types.go.
 */

export interface ExamTemplate {
  apiVersion: typeof LABS_API_VERSION;
  kind: 'ExamTemplate';
  metadata: ObjectMeta;
  spec: {
    source: { id: string; title: string; digest?: string; [k: string]: unknown };
    durationMinutes: number;
    passMark: string;
    [k: string]: unknown;
  };
}

export type ExamSessionPhase = 'Pending' | 'Provisioning' | 'InProgress' | 'Grading' | 'Completed' | 'Failed';

export interface ExamTaskStatus {
  index: number;
  id: string;
  objective: string;
  weight: string;
  seed: number;
  templateRef: string;
  title: string;
  statement: string;
  estimatedMinutes?: number;
  environment: string;
  nodes?: string[];
  contexts?: string[];
}

export interface ExamEnvironmentStatus {
  name: string;
  tasks: number[];
  phase?: string;
  entryNode?: string;
  nodes?: string[];
  endpoints?: Endpoint[];
  message?: string;
}

export interface ExamCheckReport {
  id: string;
  description?: string;
  passed: boolean;
  weight?: string;
  skills?: string[];
  message?: string;
  failedAfterReboot?: boolean;
  failedOnRerun?: boolean;
}

export interface ExamScoreReportCR {
  score: string;
  passMark: string;
  passed: boolean;
  partialCredit?: 'per-check' | 'per-task' | 'none';
  objectives: { id: string; weight: string; tasks: number; score: string }[];
  tasks: { index: number; id: string; title: string; objective: string; weight: string; outcome: 'pass' | 'partial' | 'fail'; score: string; checks: ExamCheckReport[] }[];
  passes?: string[];
  gradedAt: string;
}

export interface ExamSession {
  apiVersion: typeof LABS_API_VERSION;
  kind: 'ExamSession';
  metadata: ObjectMeta;
  spec: {
    examTemplateRef: { name: string };
    candidate: { id: string; org?: string };
    seed: number;
    avoidTasks?: string[];
    duration?: string;
    submit?: boolean;
    retainEnvironment?: boolean;
  };
  status?: {
    phase?: ExamSessionPhase;
    conditions?: Condition[];
    message?: string;
    examID?: string;
    tasks?: ExamTaskStatus[];
    environments?: ExamEnvironmentStatus[];
    startedAt?: string;
    deadline?: string;
    submittedAt?: string;
    frozenAt?: string;
    completedAt?: string;
    grading?: { stage: string; message?: string };
    report?: ExamScoreReportCR;
    environmentReleased?: boolean;
  };
}

/** Everything the exam service does against the cluster (tests use a fake). */
export interface ExamCluster {
  getLabTemplate(name: string): Promise<LabTemplate | null>;
  createLabTemplate(t: LabTemplate): Promise<void>;
  getExamTemplate(name: string): Promise<ExamTemplate | null>;
  createExamTemplate(t: ExamTemplate): Promise<void>;
  getExamSession(name: string): Promise<ExamSession | null>;
  createExamSession(s: ExamSession): Promise<ExamSession>;
  /** JSON merge patch on the main resource. */
  patchExamSession(name: string, patch: Record<string, unknown>): Promise<ExamSession>;
  deleteExamSession(name: string): Promise<void>;
}

const isStatus = (code: number) => (e: unknown) => e instanceof ApiException && e.code === code;
const notFound = isStatus(404);
const conflict = isStatus(409);

export class KubeExamCluster implements ExamCluster {
  private readonly api: CustomObjectsApi;

  constructor(
    kc: KubeConfig,
    private readonly namespace: string,
  ) {
    this.api = kc.makeApiClient(CustomObjectsApi);
  }

  private p(plural: string) {
    return { group: LABS_GROUP, version: LABS_VERSION, namespace: this.namespace, plural };
  }

  private async get<T>(plural: string, name: string): Promise<T | null> {
    try {
      return (await this.api.getNamespacedCustomObject({ ...this.p(plural), name })) as T;
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  private async create(plural: string, body: { metadata: ObjectMeta }): Promise<unknown> {
    try {
      return await this.api.createNamespacedCustomObject({ ...this.p(plural), body: { ...body, metadata: { ...body.metadata, namespace: this.namespace } } });
    } catch (e) {
      if (conflict(e)) throw new ConflictError(`${plural}/${body.metadata.name} already exists`);
      throw e;
    }
  }

  getLabTemplate(name: string) {
    return this.get<LabTemplate>('labtemplates', name);
  }
  async createLabTemplate(t: LabTemplate) {
    await this.create('labtemplates', t);
  }
  getExamTemplate(name: string) {
    return this.get<ExamTemplate>('examtemplates', name);
  }
  async createExamTemplate(t: ExamTemplate) {
    await this.create('examtemplates', t);
  }
  getExamSession(name: string) {
    return this.get<ExamSession>('examsessions', name);
  }
  async createExamSession(s: ExamSession) {
    return (await this.create('examsessions', s)) as ExamSession;
  }
  async patchExamSession(name: string, patch: Record<string, unknown>) {
    return (await this.api.patchNamespacedCustomObject(
      { ...this.p('examsessions'), name, body: patch, fieldManager: 'cloudtrain-gateway' },
      setHeaderOptions('Content-Type', PatchStrategy.MergePatch),
    )) as ExamSession;
  }
  async deleteExamSession(name: string) {
    try {
      await this.api.deleteNamespacedCustomObject({ ...this.p('examsessions'), name, propagationPolicy: 'Background' });
    } catch (e) {
      if (!notFound(e)) throw e;
    }
  }
}
