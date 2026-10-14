import { PassThrough } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devPrincipal, type Principal } from '../src/auth.js';
import { loadContent, type Content } from '../src/content/load.js';
import { ConflictError, type ExecHandle, type ExecStreams, type ExecTarget, type LabCluster } from '../src/kube/cluster.js';
import type { Compiler } from '../src/kube/compile.js';
import type { LabSession, LabTemplate } from '../src/kube/types.js';
import type { TerminalOutput } from '../src/terminal/bridge.js';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../..');
export const fixtureLabs = path.join(here, 'fixtures/labs');

let cached: Promise<Content> | undefined;
/** The real content/ tree plus the gateway's fixture labs. */
export function realContent(): Promise<Content> {
  cached ??= loadContent(path.join(repo, 'content'), [fixtureLabs]);
  return cached;
}

export const alice: Principal = devPrincipal({ sub: 'alice', name: 'Alice', email: 'alice@quillmoor.example', orgId: 'org-a', orgName: 'Org A', orgSlug: 'org-a', team: 'Ops', roles: ['learner'] });
export const bob: Principal = { ...alice, sub: 'bob', name: 'Bob' };

const clone = <T>(v: T): T => structuredClone(v);

function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (typeof v === 'object' && !Array.isArray(v)) target[k] = mergePatch((target[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    else target[k] = v;
  }
  return target;
}

export interface FakeExec {
  target: ExecTarget;
  command: string[];
  tty: boolean;
  stdout: TerminalOutput;
  stdin: PassThrough;
  exit(code: number): void;
  closed: boolean;
}

/**
 * In-memory LabCluster. `onPatch` lets a test play the controller/grader
 * (e.g. answer a validateRequest); `onExec` plays the process in the pod.
 */
export class FakeCluster implements LabCluster {
  templates = new Map<string, LabTemplate>();
  sessions = new Map<string, LabSession>();
  execs: FakeExec[] = [];
  createdTemplates = 0;
  onPatch?: (s: LabSession) => void;
  onExec?: (e: FakeExec) => void;
  private clock = Date.parse('2026-10-13T10:00:00Z');

  async getTemplate(name: string) {
    const t = this.templates.get(name);
    return t ? clone(t) : null;
  }
  async createTemplate(t: LabTemplate) {
    if (this.templates.has(t.metadata.name)) throw new ConflictError('exists');
    this.createdTemplates++;
    this.templates.set(t.metadata.name, clone(t));
    return clone(t);
  }
  async getSession(name: string) {
    const s = this.sessions.get(name);
    return s ? clone(s) : null;
  }
  async listSessions(selector: string) {
    const want = selector.split(',').map((kv) => kv.split('=') as [string, string]);
    return [...this.sessions.values()].filter((s) => want.every(([k, v]) => s.metadata.labels?.[k] === v)).map(clone);
  }
  async createSession(s: LabSession) {
    const created: LabSession = clone(s);
    created.metadata.uid = `uid-${s.metadata.name}`;
    created.metadata.creationTimestamp = new Date((this.clock += 1000)).toISOString();
    this.sessions.set(s.metadata.name, created);
    return clone(created);
  }
  async patchSession(name: string, patch: Record<string, unknown>) {
    const s = this.sessions.get(name);
    if (!s) throw new Error('not found');
    mergePatch(s as unknown as Record<string, unknown>, clone(patch));
    this.onPatch?.(s);
    return clone(s);
  }
  async deleteSession(name: string) {
    this.sessions.delete(name);
  }
  async exec(target: ExecTarget, command: string[], streams: ExecStreams, tty: boolean): Promise<ExecHandle> {
    let resolve!: (n: number) => void;
    const exited = new Promise<number>((r) => (resolve = r));
    const e: FakeExec = { target, command, tty, stdout: streams.stdout as TerminalOutput, stdin: streams.stdin as PassThrough, exit: resolve, closed: false };
    this.execs.push(e);
    this.onExec?.(e);
    return { exited, close: () => ((e.closed = true), resolve(-1)) };
  }

  /** Plays the orchestrator: the session became Ready with a jumphost exec endpoint. */
  markReady(name: string, params: Record<string, string> = {}) {
    const s = this.sessions.get(name)!;
    s.status = {
      phase: 'Ready',
      entryNode: 'workstation',
      resolvedParams: params,
      expiresAt: new Date(Date.parse(s.metadata.creationTimestamp!) + 30 * 60_000).toISOString(),
      nodes: [{ name: 'workstation', driver: 'container', phase: 'Ready', details: { ip: '10.244.1.7' } }],
      endpoints: [{ node: 'workstation', access: 'shell', protocol: 'k8s-exec', target: `ns1/${name}-workstation-abc/node` }],
    };
  }
}

/** Compiler stand-in: a LabTemplate named like labctl output, without the Go binary. */
export class FakeCompiler implements Compiler {
  calls = 0;
  async compile(labFile: string): Promise<LabTemplate> {
    this.calls++;
    const id = path.basename(path.dirname(labFile));
    return {
      apiVersion: 'labs.cloudtrain.dev/v1alpha1',
      kind: 'LabTemplate',
      metadata: { name: `${id}-v1-0123456789` },
      spec: { source: { id, version: 1, digest: 'sha256:0123456789abcdef' } },
    };
  }
}
