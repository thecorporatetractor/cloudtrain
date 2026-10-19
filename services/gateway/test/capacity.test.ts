import type { V1Node, V1ObjectMeta, V1Pod, V1PodSpec } from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import { isSandboxPod, KATA_NODE_LABEL, SANDBOX_ANNOTATION, summarizeNode } from '../src/kube/capacity.js';

const node = (name: string, labels: Record<string, string> = {}): V1Node => ({
  metadata: { name, labels },
  status: { capacity: { cpu: '8', memory: '16Gi' }, allocatable: { cpu: '7500m', memory: '15Gi' }, conditions: [{ type: 'Ready', status: 'True' }] },
});

const pod = (nodeName: string, cpu: string, memory: string, metadata: V1ObjectMeta = {}, spec: Partial<V1PodSpec> = {}): V1Pod => ({
  metadata,
  spec: { nodeName, containers: [{ name: 'node', resources: { requests: { cpu, memory } } }], ...spec },
});

describe('capacity: tier-B sandboxes', () => {
  const kata = node('w1', { [KATA_NODE_LABEL]: 'true', 'node-role.kubernetes.io/worker': '' });
  const sandboxed = pod('w1', '1', '1Gi', { annotations: { [SANDBOX_ANNOTATION]: 'kata-clh-runtime-rs' } }, { runtimeClassName: 'kata-clh-runtime-rs', overhead: { cpu: '250m', memory: '130Mi' } });
  const plain = pod('w1', '500m', '512Mi');
  const unsandboxed = pod('w1', '100m', '64Mi', { annotations: { [SANDBOX_ANNOTATION]: 'none: RuntimeClass kata-clh-runtime-rs not found' } }, { runtimeClassName: 'kata' });

  it('counts sandboxed lab pods apart from VMs, with their RuntimeClass overhead', () => {
    const n = summarizeNode(kata, [sandboxed, plain, unsandboxed, pod('w2', '4', '4Gi')], 2);
    expect(n).toMatchObject({ name: 'w1', sandbox: true, sandboxes: 1, vms: 2, pods: 3, roles: ['worker'], ready: true });
    // 1 + 0.25 overhead + 0.5 + 0.1 CPU; 1024 + 130 + 512 + 64 MiB.
    expect(n.cpu.requested).toBe(1.85);
    expect(n.memoryMiB.requested).toBe(1730);
  });

  it('a node without Kata has no sandbox capacity', () => {
    expect(summarizeNode(node('w2'), [], 0)).toMatchObject({ sandbox: false, sandboxes: 0 });
  });

  it('only pods the orchestrator put in a sandbox count', () => {
    expect(isSandboxPod(sandboxed)).toBe(true);
    expect(isSandboxPod(plain)).toBe(false);
    expect(isSandboxPod(unsandboxed)).toBe(false);
  });
});
