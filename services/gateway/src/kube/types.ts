/**
 * The subset of labs.cloudtrain.dev/v1alpha1 the gateway reads and writes.
 * Source of truth: services/lab-orchestrator/api/v1alpha1 (Go).
 */

export const LABS_GROUP = 'labs.cloudtrain.dev';
export const LABS_VERSION = 'v1alpha1';
export const LABS_API_VERSION = `${LABS_GROUP}/${LABS_VERSION}`;

export interface ObjectMeta {
  name: string;
  namespace?: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  resourceVersion?: string;
}

export interface LabTemplate {
  apiVersion: typeof LABS_API_VERSION;
  kind: 'LabTemplate';
  metadata: ObjectMeta;
  spec: {
    source: { id: string; version: number; digest?: string; estimatedMinutes?: number; [k: string]: unknown };
    [k: string]: unknown;
  };
}

export type SessionPhase = 'Pending' | 'Provisioning' | 'Ready' | 'Grading' | 'Hibernated' | 'Expired' | 'Failed';
export type NodePhase = 'Pending' | 'Provisioning' | 'Ready' | 'Hibernated' | 'Failed' | 'Destroyed';

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface NodeStatus {
  name: string;
  driver: string;
  phase: NodePhase;
  message?: string;
  instanceID?: string;
  details?: Record<string, string>;
}

export interface Endpoint {
  node: string;
  access: string;
  protocol: string;
  host?: string;
  port?: number;
  /** For k8s-exec: "namespace/pod/container". */
  target?: string;
  url?: string;
}

export interface CheckResult {
  id: string;
  passed: boolean;
  weight?: string;
  skills?: string[];
  message?: string;
  output?: string;
  durationMs?: number;
}

export interface ValidationStatus {
  observedRequest: number;
  phase: 'Running' | 'Complete' | 'Failed';
  message?: string;
  startedAt?: string;
  completedAt?: string;
  score: number;
  checks?: CheckResult[];
}

export interface LabSessionSpec {
  templateRef: { name: string };
  learner: { id: string; org?: string };
  seed: number;
  ttl?: string;
  expiresAt?: string;
  hibernate?: boolean;
  resetGeneration?: number;
  validateRequest?: number;
}

export interface LabSessionStatus {
  phase?: SessionPhase;
  conditions?: Condition[];
  resolvedParams?: Record<string, string>;
  nodes?: NodeStatus[];
  endpoints?: Endpoint[];
  entryNode?: string;
  expiresAt?: string;
  readyAt?: string;
  validation?: ValidationStatus;
}

export interface LabSession {
  apiVersion: typeof LABS_API_VERSION;
  kind: 'LabSession';
  metadata: ObjectMeta;
  spec: LabSessionSpec;
  status?: LabSessionStatus;
}

/** Labels and annotations the gateway puts on the objects it creates. */
export const LABEL_LAB = 'labs.cloudtrain.dev/lab-id';
export const LABEL_LEARNER = 'cloudtrain.dev/learner';
export const LABEL_ORG = 'cloudtrain.dev/org';
export const LABEL_MANAGED_BY = 'app.kubernetes.io/managed-by';
export const MANAGED_BY = 'cloudtrain-gateway';
export const ANNOTATION_HINTS = 'cloudtrain.dev/revealed-hints';
