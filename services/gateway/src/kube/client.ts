import { ApiException, CustomObjectsApi, Exec, KubeConfig, PatchStrategy, setHeaderOptions, type V1Status } from '@kubernetes/client-node';
import { ConflictError, type ExecHandle, type ExecStreams, type ExecTarget, type LabCluster } from './cluster.js';
import { LABS_GROUP, LABS_VERSION, type LabSession, type LabTemplate } from './types.js';

/**
 * Loads the default kubeconfig ($KUBECONFIG or ~/.kube/config) and selects
 * `context` on the in-memory copy only. The file, and with it every other
 * tool's current-context, is never modified.
 */
export function kubeConfigFor(context: string): KubeConfig {
  const kc = new KubeConfig();
  kc.loadFromDefault();
  if (!kc.getContextObject(context)) {
    const known = kc.getContexts().map((c) => c.name).join(', ');
    throw new Error(`kubeconfig has no context "${context}" (known: ${known || 'none'})`);
  }
  kc.setCurrentContext(context);
  return kc;
}

const isStatus = (code: number) => (e: unknown) => e instanceof ApiException && e.code === code;
const notFound = isStatus(404);
const conflict = isStatus(409);

/** Exit code from an exec status frame: Success = 0, NonZeroExitCode carries the code in details.causes. */
export function exitCodeOf(status: V1Status | undefined): number {
  if (!status) return -1;
  if (status.status === 'Success') return 0;
  const cause = status.details?.causes?.find((c) => c.reason === 'ExitCode');
  const n = Number(cause?.message);
  return Number.isFinite(n) ? n : 1;
}

export class KubeLabCluster implements LabCluster {
  private readonly api: CustomObjectsApi;
  private readonly execApi: Exec;

  constructor(
    kc: KubeConfig,
    private readonly namespace: string,
  ) {
    this.api = kc.makeApiClient(CustomObjectsApi);
    this.execApi = new Exec(kc);
  }

  private params(plural: string) {
    return { group: LABS_GROUP, version: LABS_VERSION, namespace: this.namespace, plural };
  }

  async getTemplate(name: string): Promise<LabTemplate | null> {
    try {
      return (await this.api.getNamespacedCustomObject({ ...this.params('labtemplates'), name })) as LabTemplate;
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async createTemplate(t: LabTemplate): Promise<LabTemplate> {
    try {
      return (await this.api.createNamespacedCustomObject({ ...this.params('labtemplates'), body: { ...t, metadata: { ...t.metadata, namespace: this.namespace } } })) as LabTemplate;
    } catch (e) {
      if (conflict(e)) throw new ConflictError(`LabTemplate ${t.metadata.name} already exists`);
      throw e;
    }
  }

  async getSession(name: string): Promise<LabSession | null> {
    try {
      return (await this.api.getNamespacedCustomObject({ ...this.params('labsessions'), name })) as LabSession;
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async listSessions(labelSelector: string): Promise<LabSession[]> {
    const list = (await this.api.listNamespacedCustomObject({ ...this.params('labsessions'), labelSelector })) as { items: LabSession[] };
    return list.items;
  }

  async createSession(s: LabSession): Promise<LabSession> {
    return (await this.api.createNamespacedCustomObject({ ...this.params('labsessions'), body: { ...s, metadata: { ...s.metadata, namespace: this.namespace } } })) as LabSession;
  }

  async patchSession(name: string, patch: Record<string, unknown>): Promise<LabSession> {
    return (await this.api.patchNamespacedCustomObject(
      { ...this.params('labsessions'), name, body: patch, fieldManager: 'cloudtrain-gateway' },
      setHeaderOptions('Content-Type', PatchStrategy.MergePatch),
    )) as LabSession;
  }

  async deleteSession(name: string): Promise<void> {
    try {
      await this.api.deleteNamespacedCustomObject({ ...this.params('labsessions'), name, propagationPolicy: 'Background' });
    } catch (e) {
      if (!notFound(e)) throw e;
    }
  }

  async exec(target: ExecTarget, command: string[], streams: ExecStreams, tty: boolean): Promise<ExecHandle> {
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((r) => (resolveExit = r));
    let status: V1Status | undefined;
    const ws = await this.execApi.exec(target.namespace, target.pod, target.container, command, streams.stdout, streams.stderr, streams.stdin, tty, (s) => {
      status = s;
      resolveExit(exitCodeOf(s));
    });
    ws.on('close', () => resolveExit(exitCodeOf(status)));
    ws.on('error', () => resolveExit(exitCodeOf(status)));
    return {
      exited,
      close: () => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      },
    };
  }
}
