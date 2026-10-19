import { CoreV1Api, CustomObjectsApi, type KubeConfig, type V1Node, type V1Pod } from '@kubernetes/client-node';
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

/** kata-deploy (and the managed Kata node pools' runtime) label nodes that run Kata sandboxes. */
export const KATA_NODE_LABEL = 'katacontainers.io/kata-runtime';
/** The orchestrator's sandbox decision on a lab pod ("<RuntimeClass>" or "none: <reason>"). */
export const SANDBOX_ANNOTATION = 'labs.cloudtrain.dev/sandbox';

/** A lab pod that runs in a tier sandbox (a Kata VM per pod), not on the node's kernel. */
export function isSandboxPod(p: V1Pod): boolean {
  const a = p.metadata?.annotations?.[SANDBOX_ANNOTATION];
  return !!p.spec?.runtimeClassName && !!a && !a.startsWith('none');
}

/**
 * Per-node capacity. A sandboxed pod (tier B on Kata) reserves its requests plus the
 * RuntimeClass overhead (pod.spec.overhead, the VMM and guest kernel), so requested
 * memory counts both; sandboxes are counted apart from KubeVirt VMs (they need no
 * devices.kubevirt.io/kvm slot, only a Kata node).
 */
export function summarizeNode(n: V1Node, pods: V1Pod[], vmsOnNode: number): CapacityNode {
  const name = n.metadata?.name ?? '';
  const on = pods.filter((p) => p.spec?.nodeName === name);
  const req = (k: 'cpu' | 'memory') =>
    on.reduce((a, p) => {
      const of = (q: string | undefined) => (k === 'cpu' ? cpuOf(q) : memMiB(q));
      const containers = (p.spec?.containers ?? []).reduce((b, c) => b + of(c.resources?.requests?.[k]), 0);
      return a + containers + of(p.spec?.overhead?.[k]);
    }, 0);
  const labels = n.metadata?.labels ?? {};
  return {
    name,
    roles: Object.keys(labels).filter((l) => l.startsWith('node-role.kubernetes.io/')).map((l) => l.split('/')[1]!),
    ready: (n.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True'),
    kvm: Number(n.status?.allocatable?.['devices.kubevirt.io/kvm'] ?? 0) > 0 || labels['kubevirt.io/schedulable'] === 'true',
    sandbox: labels[KATA_NODE_LABEL] === 'true',
    cpu: { capacity: cpuOf(n.status?.capacity?.cpu), allocatable: cpuOf(n.status?.allocatable?.cpu), requested: Math.round(req('cpu') * 100) / 100 },
    memoryMiB: { capacity: memMiB(n.status?.capacity?.memory), allocatable: memMiB(n.status?.allocatable?.memory), requested: req('memory') },
    pods: on.length,
    vms: vmsOnNode,
    sandboxes: on.filter(isSandboxPod).length,
  };
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
    return nodes.items.map((n) => summarizeNode(n, pods.items, vms.byNode[n.metadata?.name ?? ''] ?? 0));
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
