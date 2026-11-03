import type { Lab as SourceLab } from '@cloudtrain/lab-schema';
import { HttpError } from '../errors.js';
import type { ExecTarget } from '../kube/cluster.js';
import type { Endpoint, LabSession, LabTemplate } from '../kube/types.js';

/** The account the jumphost images provide for learners (drivers.LearnerUser in the orchestrator). */
export const LEARNER_USER = 'learner';

const NODE_NAME = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/**
 * A login shell as the learner. Jumphost images already run as `learner`, so
 * the shell starts directly; an image running as root with a learner account
 * switches to it with `su -`; anything else gets the best shell it has. TERM
 * is set because exec does not pass one and readline is unusable without it.
 */
export function loginShellCommand(): string[] {
  const script = [
    'export TERM=xterm-256color',
    `if [ "$(id -u)" = 0 ] && id ${LEARNER_USER} >/dev/null 2>&1; then exec su - ${LEARNER_USER}; fi`,
    'cd "${HOME:-/}" 2>/dev/null',
    'if command -v bash >/dev/null 2>&1; then exec bash -l; fi',
    'exec sh -l',
  ].join('\n');
  return ['/bin/sh', '-c', script];
}

/** `ssh <node>` from the entry node, as the learner (whose ssh config knows every lab node). */
export function sshCommand(node: string): string[] {
  if (!NODE_NAME.test(node)) throw new HttpError(400, `invalid node name ${JSON.stringify(node)}`);
  const script = [
    'export TERM=xterm-256color',
    `if [ "$(id -u)" = 0 ] && id ${LEARNER_USER} >/dev/null 2>&1; then exec su - ${LEARNER_USER} -c 'exec ssh ${node}'; fi`,
    `exec ssh ${node}`,
  ].join('\n');
  return ['/bin/sh', '-c', script];
}

/**
 * Drivers whose nodes never get a login shell: a device's own console program
 * (the endpoint command, e.g. vtysh) is the only way in. The device container
 * runs as root with extra capabilities, so a shell there must never be the
 * fallback.
 */
const CONSOLE_ONLY_DRIVERS = new Set(['netdev']);

/**
 * The endpoint's console program (e.g. vtysh), started with TERM set. The
 * argv is passed as arguments to `sh -c`, never interpolated into the script.
 */
export function consoleCommand(argv: string[]): string[] {
  return ['/bin/sh', '-c', 'export TERM=xterm-256color; exec "$0" "$@"', ...argv];
}

/**
 * What runs on a node's own k8s-exec endpoint: the endpoint's console command
 * when the orchestrator set one, otherwise a login shell. A console-only node
 * (netdev) without a console command is refused instead of getting a shell,
 * and so is a node whose driver neither the lab source (sourceDriver) nor the
 * session status names: a shell is only opened on a node known not to be a
 * device.
 */
export function nodeCommand(ls: LabSession, node: string, ep: Endpoint | undefined, sourceDriver?: string): string[] {
  const argv = (ep?.command ?? '').split(/\s+/).filter(Boolean);
  if (argv.length > 0) return consoleCommand(argv);
  // Either source naming the node console-only is enough (the lab source when
  // the caller has it, and the driver the orchestrator reports).
  const statusDriver = (ls.status?.nodes ?? []).find((n) => n.name === node)?.driver;
  if ([sourceDriver, statusDriver].some((d) => CONSOLE_ONLY_DRIVERS.has(d ?? ''))) {
    throw new HttpError(409, `${node} has no console command yet.`);
  }
  if (!sourceDriver && !statusDriver) throw new HttpError(409, `${node} is not ready for a terminal yet.`);
  return loginShellCommand();
}

/** The driver of a node in a compiled LabTemplate (spec.topology.nodes). */
export function templateDriver(tpl: LabTemplate | null, node: string): string | undefined {
  const topo = (tpl?.spec as { topology?: { nodes?: { name?: string; driver?: string }[] } } | undefined)?.topology;
  return topo?.nodes?.find((n) => n.name === node)?.driver;
}

export function parseExecTarget(target: string | undefined): ExecTarget | null {
  const parts = (target ?? '').split('/');
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [namespace, pod, container] = parts as [string, string, string];
  return { namespace, pod, container };
}

export interface TerminalPlan {
  node: string;
  target: ExecTarget;
  command: string[];
  /** Human description for the banner line. */
  via: string;
}

/** Every name `ssh <name>` may be asked for: topology nodes and kubeadm cluster members. */
function knownNodes(lab: SourceLab): Set<string> {
  const names = new Set<string>();
  for (const n of lab.spec.topology.nodes) {
    names.add(n.name);
    for (const m of n.cluster?.nodes ?? []) names.add(m.name);
  }
  return names;
}

/**
 * Where a terminal for `node` (default: the entry node) runs. A node with its
 * own k8s-exec endpoint gets its console command or a login shell there (see
 * nodeCommand); any other lab node is
 * reached with `ssh <node>` from the entry node, as the readiness contract
 * promises for kubeadm nodes.
 */
export function planTerminal(ls: LabSession, lab: SourceLab, node?: string): TerminalPlan {
  const phase = ls.status?.phase;
  if (phase !== 'Ready' && phase !== 'Grading') throw new HttpError(409, 'The lab environment is not ready yet.');
  const entry = ls.status?.entryNode || lab.spec.topology.entry || lab.spec.topology.nodes[0].name;
  const want = node || entry;
  if (!knownNodes(lab).has(want)) throw new HttpError(404, `Node ${want} is not part of this lab`);
  const execEndpoint = (name: string) => (ls.status?.endpoints ?? []).find((e) => e.node === name && e.protocol === 'k8s-exec');

  const own = execEndpoint(want);
  const ownTarget = parseExecTarget(own?.target);
  if (ownTarget) {
    const driver = lab.spec.topology.nodes.find((n) => n.name === want)?.driver;
    const command = nodeCommand(ls, want, own, driver);
    return { node: want, target: ownTarget, command, via: own?.command ? `console on ${want}` : `shell on ${want}` };
  }

  const entryTarget = parseExecTarget(execEndpoint(entry)?.target);
  if (!entryTarget) throw new HttpError(409, `The entry node ${entry} has no shell endpoint yet.`);
  if (want === entry) throw new HttpError(409, `${entry} has no shell endpoint.`);
  return { node: want, target: entryTarget, command: sshCommand(want), via: `ssh ${want} from ${entry}` };
}
