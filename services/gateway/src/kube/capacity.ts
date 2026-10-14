import { CoreV1Api, CustomObjectsApi, type KubeConfig } from '@kubernetes/client-node';
import type { CapacityNode, WarmPoolInfo } from '@cloudtrain/api-types';
import { LABS_GROUP, LABS_VERSION, type LabSession } from './types.js';

/** Read-only cluster facts for the platform capacity view. */
export interface ClusterInfo {
  nodes(): Promise<CapacityNode[]>;
  vms(): Promise<{ running: number; total: number; byNode: Record<string, number> }>;
  warmPools(): Promise<WarmPoolInfo[]>;
  allSessions(): Promise<LabSession[]>;
}

/** "250m" -> 0.25, "2" -> 2 */
export function cpuOf(q: string | undefined): number {
  if (!q) return 0;
  if (q.endsWith('m')) return Number(q.slice(0, -1)) / 1000;
  if (q.endsWith('n')) return Number(q.slice(0, -1)) / 1e9;
  return Number(q) || 0;
}

/** "512Mi" / "2Gi" / "1000000Ki" / bytes -> MiB */
export function memMiB(q: string | undefined): number {
  if (!q) return 0;
  const m = /^(\d+(?:\.\d+)?)([KMGTE]i?|[kmgt])?$/.exec(q);
  if (!m) return 0;
  const n = Number(m[1]);
  const f: Record<string, number> = { Ki: 1 / 1024, Mi: 1, Gi: 1024, Ti: 1024 * 1024, k: 1000 / 1048576, M: 1e6 / 1048576, G: 1e9 / 1048576, T: 1e12 / 1048576 };
  return Math.round(m[2] ? n * (f[m[2]] ?? 0) : n / 1048576);
}

export class KubeClusterInfo implements ClusterInfo {
  private readonly core: CoreV1Api;
  private readonly custom: CustomObjectsApi;
  constructor(kc: KubeConfig) {
    this.core = kc.makeApiClient(CoreV1Api);
    this.custom = kc.makeApiClient(CustomObjectsApi);
  }

  async nodes(): Promise<CapacityNode[]> {
    const [nodes, pods, vms] = await Promise.all([this.core.listNode(), this.core.listPodForAllNamespaces({ fieldSelector: 'status.phase!=Succeeded,status.phase!=Failed' }), this.vms()]);
    return nodes.items.map((n) => {
      const name = n.metadata?.name ?? '';
      const on = pods.items.filter((p) => p.spec?.nodeName === name);
      const req = (k: 'cpu' | 'memory') => on.reduce((a, p) => a + (p.spec?.containers ?? []).reduce((b, c) => b + (k === 'cpu' ? cpuOf(c.resources?.requests?.cpu) : memMiB(c.resources?.requests?.memory)), 0), 0);
      const labels = n.metadata?.labels ?? {};
      return {
        name,
        roles: Object.keys(labels).filter((l) => l.startsWith('node-role.kubernetes.io/')).map((l) => l.split('/')[1]!),
        ready: (n.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True'),
        kvm: Number(n.status?.allocatable?.['devices.kubevirt.io/kvm'] ?? 0) > 0 || labels['kubevirt.io/schedulable'] === 'true',
        cpu: { capacity: cpuOf(n.status?.capacity?.cpu), allocatable: cpuOf(n.status?.allocatable?.cpu), requested: Math.round(req('cpu') * 100) / 100 },
        memoryMiB: { capacity: memMiB(n.status?.capacity?.memory), allocatable: memMiB(n.status?.allocatable?.memory), requested: req('memory') },
        pods: on.length,
        vms: vms.byNode[name] ?? 0,
      };
    });
  }

  async vms() {
    try {
      const list = (await this.custom.listClusterCustomObject({ group: 'kubevirt.io', version: 'v1', plural: 'virtualmachineinstances' })) as { items: { status?: { phase?: string; nodeName?: string } }[] };
      const byNode: Record<string, number> = {};
      let running = 0;
      for (const v of list.items) {
        if (v.status?.phase === 'Running') {
          running++;
          if (v.status.nodeName) byNode[v.status.nodeName] = (byNode[v.status.nodeName] ?? 0) + 1;
        }
      }
      return { running, total: list.items.length, byNode };
    } catch {
      return { running: 0, total: 0, byNode: {} }; // KubeVirt not installed
    }
  }

  async warmPools(): Promise<WarmPoolInfo[]> {
    try {
      const list = (await this.custom.listClusterCustomObject({ group: LABS_GROUP, version: LABS_VERSION, plural: 'warmpools' })) as {
        items: { metadata: { name: string; namespace: string }; spec: { templateRef: { name: string }; size: number }; status?: { ready?: number } }[];
      };
      return list.items.map((w) => ({ name: w.metadata.name, namespace: w.metadata.namespace, template: w.spec.templateRef.name, size: w.spec.size, ready: w.status?.ready ?? 0 }));
    } catch {
      return [];
    }
  }

  async allSessions(): Promise<LabSession[]> {
    const list = (await this.custom.listClusterCustomObject({ group: LABS_GROUP, version: LABS_VERSION, plural: 'labsessions' })) as { items: LabSession[] };
    return list.items;
  }
}
