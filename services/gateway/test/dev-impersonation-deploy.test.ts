import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repo } from './fakes.js';

/*
 * CT_DEV_IMPERSONATE (dev sign-in-as) is for `task dev:gateway` only. No
 * manifest, compose file, chart value, deploy script, Dockerfile or CI workflow
 * may set it.
 */
const SETS_IT = [
  /CT_DEV_IMPERSONATE["']?\s*[:=]/, // KEY=1, KEY: "1", "KEY": "1"
  /name:\s*["']?CT_DEV_IMPERSONATE\b/, // Kubernetes env: - name: CT_DEV_IMPERSONATE
  /(?:-e|--env)[\s=]+["']?CT_DEV_IMPERSONATE\b/, // docker run -e
  /export\s+CT_DEV_IMPERSONATE\b/,
];

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name === 'node_modules' || e.name === '.results' || e.name === '.cache') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

describe('CT_DEV_IMPERSONATE stays out of deployments', () => {
  it('no deploy/ manifest or script, Dockerfile or CI workflow sets it', async () => {
    const candidates = [...(await files(path.join(repo, 'deploy'))), ...(await files(path.join(repo, '.github'))), ...(await files(path.join(repo, 'services'))).filter((f) => /(^|\/)(Dockerfile[^/]*|Containerfile|[^/]*\.ya?ml)$/.test(f))];
    expect(candidates.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const f of candidates) {
      const rel = path.relative(repo, f);
      const text = await readFile(f, 'utf8').catch(() => '');
      text.split('\n').forEach((line, i) => {
        if (SETS_IT.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('only task dev:gateway turns it on, and lets you turn it off', async () => {
    const taskfile = await readFile(path.join(repo, 'Taskfile.yml'), 'utf8');
    const block = taskfile.slice(taskfile.indexOf('  dev:gateway:'), taskfile.indexOf('  dev:web:'));
    expect(block).toMatch(/CT_DEV_IMPERSONATE: '\{\{\.CT_DEV_IMPERSONATE \| default "1"\}\}'/);
    expect(taskfile.split('CT_DEV_IMPERSONATE:').length - 1).toBe(1);
  });
});
