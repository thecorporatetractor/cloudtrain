import type { DiffLine, Lab, StudioDraft, VerificationGate } from '@/api/types';
import { labById } from './labs';

export const gateTemplate: Omit<VerificationGate, 'status' | 'items' | 'durationSec'>[] = [
  { id: 'setup-idempotent', name: 'Setup is idempotent', description: 'Run setup twice on a fresh topology; the second run must change nothing.' },
  { id: 'fails-before', name: 'Checks fail before the solution', description: 'Every check must fail on a freshly set up lab; a check that passes early is not measuring anything.' },
  { id: 'passes-after', name: 'Checks pass after the solution', description: 'Apply the reference solution; every check must pass within its timeout.' },
  { id: 'mutations', name: 'Misconception mutations fail', description: 'Each misconception mutation is applied instead of the solution; at least one check must fail.' },
  { id: 'alt-solutions', name: 'Alternative solutions pass', description: 'Equivalent approaches (imperative vs declarative, different tools) must also pass.' },
  { id: 'teardown-clean', name: 'Teardown is clean', description: 'After teardown, no lab resources remain in the cluster or on nodes.' },
  { id: 'variants', name: 'Parameter variants work', description: 'Sample 5 parameter combinations; setup, solution and checks must agree for each.' },
];

export function freshGates(): VerificationGate[] {
  return gateTemplate.map((g) => ({ ...g, status: 'pending', items: [] }));
}

function gatesFor(statuses: Array<[VerificationGate['status'], number | undefined, { label: string; status: VerificationGate['status']; detail?: string }[]]>): VerificationGate[] {
  return gateTemplate.map((g, i) => {
    const [status, durationSec, items] = statuses[i] ?? ['pending', undefined, []];
    return { ...g, status, durationSec, items };
  });
}

export function specFromPrompt(prompt: string, id: string): Lab {
  const lower = prompt.toLowerCase();
  const domain: Lab['metadata']['domain'] = /vlan|ospf|router|switch|acl|bgp/.test(lower) ? 'networking' : /systemd|lvm|cron|ssh|user|disk/.test(lower) ? 'linux' : 'kubernetes';
  const title = prompt.split(/[.\n]/)[0]?.trim().slice(0, 78) || 'Untitled lab';
  const topology: Lab['spec']['topology'] =
    domain === 'kubernetes'
      ? {
          entry: 'workstation',
          nodes: [
            { name: 'workstation', driver: 'container', image: 'jumphost:1', access: ['shell'] },
            { name: 'meadow-cluster', driver: 'k8s-cluster', image: 'kubeadm:1.35', access: ['ssh'], cluster: { mode: 'kubeadm', version: '1.35.1', context: 'meadow', nodes: [{ name: 'meadow-cp-1', role: 'control-plane' }, { name: 'meadow-w-1', role: 'worker' }] } },
          ],
          links: [{ a: 'workstation:eth0', b: 'meadow-cluster:eth0', subnet: '10.70.0.0/24' }],
        }
      : domain === 'linux'
        ? {
            entry: 'workstation',
            nodes: [
              { name: 'workstation', driver: 'container', image: 'jumphost:1', access: ['shell'] },
              { name: 'granary-vm', driver: 'vm', image: 'ubuntu:24.04', access: ['ssh', 'console'], resources: { cpu: 1, memoryMiB: 1024 } },
            ],
            links: [{ a: 'workstation:eth0', b: 'granary-vm:ens3', subnet: '10.71.0.0/24' }],
          }
        : {
            entry: 'workstation',
            nodes: [
              { name: 'workstation', driver: 'container', image: 'jumphost:1', access: ['shell'] },
              { name: 'yard-rtr-1', driver: 'netdev', image: 'frr:10', access: ['console'] },
              { name: 'yard-rtr-2', driver: 'netdev', image: 'frr:10', access: ['console'] },
            ],
            links: [
              { a: 'workstation:eth0', b: 'yard-rtr-1:eth0', subnet: '10.72.0.0/24' },
              { a: 'yard-rtr-1:eth1', b: 'yard-rtr-2:eth0', subnet: '10.72.1.0/30' },
            ],
          };
  const skill = domain === 'kubernetes' ? 'k8s.rbac.roles' : domain === 'linux' ? 'linux.ops.systemd' : 'net.l3.ospf';
  return {
    apiVersion: 'cloudtrain.dev/v3',
    kind: 'Lab',
    metadata: { id, title, domain, difficulty: /hard|advanced/.test(lower) ? 'hard' : /easy|intro|basic/.test(lower) ? 'easy' : 'medium', estimatedMinutes: 25, frameworks: [], tags: ['generated'], version: 1 },
    spec: {
      description: prompt.trim(),
      objectives: ['Reproduce the described starting state', 'Apply the fix the task asks for', 'Verify without reading the solution'],
      topology,
      checks: [
        { id: 'state-fixed', description: 'The target state described in the task is reached', type: domain === 'kubernetes' ? 'k8s-query' : domain === 'linux' ? 'shell' : 'device-cmd', skills: [skill], weight: 2 },
        { id: 'no-collateral', description: 'Unrelated resources were not modified', type: 'shell', skills: [skill] },
        { id: 'still-healthy', description: 'The platform is healthy after the change', type: domain === 'networking' ? 'reachability' : 'service-state', skills: [skill] },
      ],
      hints: [{ title: 'Where to look', body: 'Start by inspecting the current state before changing anything.', cost: 1 }],
    },
  };
}

const netpolDiff: DiffLine[] = [
  { kind: 'ctx', text: 'metadata:' },
  { kind: 'ctx', text: '  id: orchard-netpol-isolation' },
  { kind: 'del', text: '  version: 3' },
  { kind: 'add', text: '  version: 4' },
  { kind: 'ctx', text: 'spec:' },
  { kind: 'ctx', text: '  checks:' },
  { kind: 'ctx', text: '    - id: dns-allowed' },
  { kind: 'del', text: '      type: shell' },
  { kind: 'del', text: '      command: nslookup kubernetes.default' },
  { kind: 'add', text: '      type: shell' },
  { kind: 'add', text: '      command: nslookup -timeout=2 kubernetes.default.svc' },
  { kind: 'add', text: '      timeoutSec: 8' },
  { kind: 'ctx', text: '  misconceptions:' },
  { kind: 'add', text: '    - id: egress-forgotten' },
  { kind: 'add', text: '      description: Learner writes ingress rules only and breaks DNS' },
  { kind: 'add', text: '      feedback: NetworkPolicy evaluates Ingress and Egress separately...' },
];

export const drafts: StudioDraft[] = [
  {
    id: 'draft-netpol-v4',
    title: 'Isolate the payments namespace with NetworkPolicy (v4)',
    prompt: 'Tighten the DNS check timeout and add a misconception for forgetting egress rules.',
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    author: 'Ingrid Solvang',
    stage: 'review',
    spec: { ...labById.get('orchard-netpol-isolation')!, metadata: { ...labById.get('orchard-netpol-isolation')!.metadata, version: 4 } },
    gates: gatesFor([
      ['passed', 48, [{ label: 'second run: 0 changes', status: 'passed' }]],
      ['passed', 31, [
        { label: 'default-deny-exists', status: 'passed', detail: 'failed before solution, as required' },
        { label: 'checkout-allowed', status: 'passed' },
        { label: 'other-denied', status: 'passed' },
        { label: 'dns-allowed', status: 'passed' },
        { label: 'no-wide-open', status: 'passed' },
      ]],
      ['passed', 74, [{ label: '5 / 5 checks pass after solution', status: 'passed' }]],
      ['passed', 212, [
        { label: 'egress-forgotten', status: 'passed', detail: 'dns-allowed failed, as required' },
        { label: 'pod-selector-wrong', status: 'passed', detail: 'checkout-allowed failed' },
        { label: 'allow-all-namespaces', status: 'passed', detail: 'no-wide-open failed' },
      ]],
      ['passed', 96, [{ label: 'imperative kubectl', status: 'passed' }, { label: 'ipBlock instead of namespaceSelector', status: 'passed' }]],
      ['passed', 22, [{ label: 'no leftover NetworkPolicy, probe pods removed', status: 'passed' }]],
      ['passed', 310, [{ label: '5 variants', status: 'passed' }]],
    ]),
    diff: netpolDiff,
  },
  {
    id: 'draft-registry-mirror',
    title: 'Pin workloads to a signed internal registry mirror',
    prompt: 'A CKS supply-chain lab: learners must configure an ImagePolicyWebhook (or a ValidatingAdmissionPolicy) on the meadow cluster so only images from registry.tessera.internal signed with the platform cosign key are admitted. Include a misconception where they allow by tag instead of digest.',
    createdAt: new Date(Date.now() - 26 * 3600000).toISOString(),
    author: 'Aino Lehto',
    stage: 'verify',
    spec: specFromPrompt('Pin workloads to a signed internal registry mirror. Learners configure an ImagePolicyWebhook (or ValidatingAdmissionPolicy) on the meadow cluster so only images from registry.tessera.internal signed with the platform cosign key are admitted. Hard.', 'meadow-signed-registry'),
    gates: gatesFor([
      ['passed', 52, [{ label: 'second run: 0 changes', status: 'passed' }]],
      ['passed', 40, [{ label: '4 / 4 checks fail before solution', status: 'passed' }]],
      ['failed', 118, [
        { label: 'unsigned-rejected', status: 'passed' },
        { label: 'signed-admitted', status: 'failed', detail: 'timed out after 30s: webhook pod not Ready (image pull from registry mirror failed)' },
        { label: 'policy-present', status: 'passed' },
        { label: 'tag-not-trusted', status: 'passed' },
      ]],
      ['skipped', undefined, []],
      ['skipped', undefined, []],
      ['passed', 19, [{ label: 'clean', status: 'passed' }]],
      ['pending', undefined, []],
    ]),
  },
  {
    id: 'draft-ospf-stub',
    title: 'Make the depot a totally stubby OSPF area',
    prompt: 'Convert area 10 behind yard-rtr-2 into a totally stubby area and prove the depot still reaches the core.',
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    author: 'Mira Adeyemi',
    stage: 'pilot',
    spec: specFromPrompt('Make the depot a totally stubby OSPF area. Convert area 10 behind yard-rtr-2 into a totally stubby area and prove the depot still reaches the core via the router default.', 'yard-ospf-stub-area'),
    gates: gatesFor([
      ['passed', 30, []], ['passed', 25, []], ['passed', 61, []], ['passed', 140, []], ['passed', 44, []], ['passed', 12, []], ['passed', 190, []],
    ]),
    pilot: { cohort: 'Network on-call cohort B', learners: 9, startedAt: new Date(Date.now() - 3 * 86400000).toISOString() },
  },
];
