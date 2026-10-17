import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { learnerLab, fillParams, revealedHint } from '../src/content/view.js';
import { LabctlCompiler } from '../src/kube/compile.js';
import { fixtureLabs, realContent, repo } from './fakes.js';

describe('content loader (real content/)', () => {
  it('serves every Kubernetes pack lab, valid against the v3 schema', async () => {
    const c = await realContent();
    expect(c.issues).toEqual([]);
    const onDisk = (await readdir(path.join(repo, 'content/packs/kubernetes/labs'), { withFileTypes: true })).filter((e) => e.isDirectory()).length;
    const k8s = c.summaries.filter((l) => l.domain === 'kubernetes').map((l) => l.id).sort();
    expect(k8s).toHaveLength(onDisk);
    expect(k8s).toContain('drain-yard-worker');
    expect(c.domains.find((d) => d.id === 'kubernetes')?.labCount).toBe(onDisk);
  });

  it('maps the skill graph and every check skill exists', async () => {
    const c = await realContent();
    const ids = new Set(c.skills.map((s) => s.id));
    expect(c.skills.length).toBeGreaterThan(100);
    expect(c.skills.find((s) => s.id === 'k8s.cli.contexts')).toMatchObject({ domain: 'kubernetes' });
    for (const l of c.summaries) for (const s of l.skillIds) expect(ids.has(s), `${l.id}: ${s}`).toBe(true);
    // Promoted skills (content/skills.yaml) and curriculum newSkills that a pack lab uses join the graph.
    const git = c.skills.find((s) => s.id === 'linux.git.basics');
    expect(git).toMatchObject({ domain: 'linux' });
    expect(c.competencies.find((k) => k.id === 'linux.git')?.skillIds).toContain('linux.git.basics');
    // ...but newSkills no lab uses do not (the Linux newSkills were promoted in round 4).
    expect(ids.has('linux.shell.help-docs')).toBe(true);
    const unused = c.skills.filter((s) => s.id === 'containers.build.multi-stage');
    expect(unused).toEqual([]);
  });

  it('maps frameworks: ids prefixed per objective, weights summing to 1', async () => {
    const c = await realContent();
    expect(c.frameworks.map((f) => f.id).sort()).toEqual(['ccna', 'cka', 'ckad', 'cks', 'lfcs']);
    const cka = c.frameworks.find((f) => f.id === 'cka')!;
    expect(cka.name).toBe('CKA');
    expect(cka.fullName).toBe('Certified Kubernetes Administrator');
    expect(cka.domains.find((d) => d.id === 'cka:troubleshooting')?.weight).toBeCloseTo(0.3);
    expect(cka.domains.reduce((a, d) => a + d.weight, 0)).toBeCloseTo(1);
    // lab metadata.frameworks reference these ids
    const drain = c.summaries.find((l) => l.id === 'drain-yard-worker')!;
    for (const f of drain.frameworks ?? []) expect(cka.domains.some((d) => d.id === f)).toBe(true);
  });

  it('loads every framework file, so tags of a known framework resolve to its domains', async () => {
    // CKAD was dropped by the loader: its tags rendered as raw ids ("CKAD · services networking")
    // next to the real name of the sibling CKA domain ("CKA · Services and networking").
    const c = await realContent();
    const files = (await readdir(path.join(repo, 'content/frameworks'))).filter((f) => /\.ya?ml$/.test(f));
    expect(c.frameworks).toHaveLength(files.length);
    const loaded = new Set(c.frameworks.map((f) => f.id as string));
    const domains = new Set(c.frameworks.flatMap((f) => f.domains.map((d) => d.id)));
    const unknown = c.summaries.flatMap((l) => (l.frameworks ?? []).filter((f) => loaded.has(f.split(':')[0]!) && !domains.has(f)).map((f) => `${l.id}: ${f}`));
    expect(unknown).toEqual([]);
  });

  it('turns pack courses and paths into catalog paths', async () => {
    const c = await realContent();
    const ids = c.paths.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['k8s-admin-essentials', 'k8s-access-and-networking', 'k8s-cluster-maintenance', 'cka-track']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(c.paths.find((p) => p.id === 'cka-track')).toMatchObject({ framework: 'cka', domain: 'kubernetes' });
    expect(c.paths.find((p) => p.id === 'cka-track')!.labIds).toHaveLength(11);
    expect(c.summaries.find((l) => l.id === 'two-container-pod')?.pathId).toBe('k8s-admin-essentials');
  });

  it('loads extra lab directories (test fixtures) without a pack', async () => {
    const c = await realContent();
    expect(c.labs.get('gateway-smoke')?.file).toBe(path.join(fixtureLabs, 'gateway-smoke/lab.yaml'));
  });
});

describe('learner view of a lab', () => {
  it('never contains expected values, commands, queries, setup, solution or misconceptions', async () => {
    const c = await realContent();
    const src = c.labs.get('two-container-pod')!.lab;
    const view = learnerLab(src);
    const json = JSON.stringify(view);
    for (const secret of ['"expect"', '"query"', '"command"', '"solution"', '"misconceptions"', '"setup"', '"teardown"', 'jsonpath', 'kubectl -n depot-kiosk wait']) {
      expect(json).not.toContain(secret);
    }
    expect(view.spec.checks.map((ch) => ch.id)).toEqual(src.spec.checks.map((ch) => ch.id));
    expect(view.spec.checks[0]).toMatchObject({ type: 'k8s-context', on: 'workstation', weight: 0.5, skills: ['k8s.cli.contexts'] });
    expect(view.spec.hints?.every((h) => h.redacted && h.body === '' && h.title === '')).toBe(true);
    expect(view.spec.topology.entry).toBe('workstation');
  });

  it('fills params into text and revealed hints', async () => {
    const c = await realContent();
    const src = c.labs.get('two-container-pod')!.lab;
    expect(fillParams('pod {{pod}} / {{ missing }}', { pod: 'kiosk-duo' })).toBe('pod kiosk-duo / {{ missing }}');
    expect(revealedHint(src, 1, { pod: 'gate-panel' })?.command).toContain('run gate-panel');
    expect(revealedHint(src, 99, {})).toBeUndefined();
  });
});

const labctl = path.join(repo, 'services/lab-orchestrator/bin/labctl');
describe.skipIf(!existsSync(labctl))('labctl compiler', () => {
  it('compiles a pack lab into a content-addressed LabTemplate', async () => {
    const c = await realContent();
    const t = await new LabctlCompiler(labctl).compile(c.labs.get('drain-yard-worker')!.file);
    expect(t.kind).toBe('LabTemplate');
    expect(t.metadata.name).toMatch(/^drain-yard-worker-v1-[0-9a-f]{10}$/);
    expect(t.metadata.labels?.['app.kubernetes.io/managed-by']).toBe('cloudtrain-gateway');
    expect(t.metadata.creationTimestamp).toBeUndefined();
  });

  it('reports labctl errors with its message', async () => {
    await expect(new LabctlCompiler(labctl).compile(path.join(repo, 'package.json'))).rejects.toThrow(/labctl compile/);
  });
});
