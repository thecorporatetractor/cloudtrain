import type { Lab, LabSession, TopologyNode } from '@/api/types';

const PARAM = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Fills `{{param}}` with the session's values; unresolved ones read as ‹name›. */
export function fillParams(text: string, params: Record<string, string> | undefined): string {
  return text.replace(PARAM, (_, name: string) => params?.[name] ?? `‹${name}›`);
}

/**
 * The lab as this attempt sees it: params resolved in the task text, objectives,
 * checks and hints, and revealed hint content (the real API withholds hint bodies
 * until a hint is revealed on the session).
 */
export function personalize(lab: Lab, session?: LabSession): Lab {
  const p = session?.params;
  const f = (t: string) => fillParams(t, p);
  return {
    ...lab,
    spec: {
      ...lab.spec,
      description: f(lab.spec.description),
      objectives: lab.spec.objectives?.map(f),
      checks: lab.spec.checks.map((c) => ({ ...c, description: f(c.description) })),
      hints: lab.spec.hints?.map((h, i) => {
        const revealed = session?.hints?.[i];
        const hint = revealed ?? h;
        return { ...hint, title: f(hint.title), body: f(hint.body), ...(hint.command ? { command: f(hint.command) } : {}) };
      }),
    },
  };
}

/**
 * A node a console can open on: a topology node, or a member of a kubeadm cluster
 * (reached with `ssh <member>` from the jumphost).
 */
export function findConsoleNode(lab: Lab, name: string, includeMembers: boolean): TopologyNode | undefined {
  const direct = lab.spec.topology.nodes.find((n) => n.name === name);
  if (direct || !includeMembers) return direct;
  for (const n of lab.spec.topology.nodes) {
    if (n.cluster?.nodes?.some((m) => m.name === name)) return { name, driver: 'vm', access: ['ssh'] };
  }
  return undefined;
}

/** Cluster members as ssh access points, for the console menu. */
export function clusterMembers(lab: Lab): TopologyNode[] {
  return lab.spec.topology.nodes.flatMap((n) => (n.cluster?.mode === 'kubeadm' ? (n.cluster.nodes ?? []).map((m): TopologyNode => ({ name: m.name, driver: 'vm', access: ['ssh'] })) : []));
}
