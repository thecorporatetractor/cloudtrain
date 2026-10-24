import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repo } from './fakes.js';

/*
 * CT_DEV_IMPERSONATE (dev sign-in-as) and CT_DEV_LICENSE (the development license,
 * docs/licensing-keys.md) are for `task dev:gateway` only. No manifest, compose
 * file, chart value, deploy script, Dockerfile or CI workflow may set them.
 */
const DEV_ONLY = ['CT_DEV_IMPERSONATE', 'CT_DEV_LICENSE'] as const;
const setsIt = (v: string) => [
  new RegExp(`${v}["']?\\s*[:=]`), // KEY=1, KEY: "1", "KEY": "1"
  new RegExp(`name:\\s*["']?${v}\\b`), // Kubernetes env: - name: KEY
  new RegExp(`(?:-e|--env)[\\s=]+["']?${v}\\b`), // docker run -e
  new RegExp(`export\\s+${v}\\b`),
];
const SETS_IT = DEV_ONLY.flatMap(setsIt);

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

describe('CT_DEV_IMPERSONATE and CT_DEV_LICENSE stay out of deployments', () => {
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

  it.each(DEV_ONLY)('only task dev:gateway turns %s on, and lets you turn it off', async (v) => {
    const taskfile = await readFile(path.join(repo, 'Taskfile.yml'), 'utf8');
    const block = taskfile.slice(taskfile.indexOf('  dev:gateway:'), taskfile.indexOf('  dev:web:'));
    expect(block).toContain(`${v}: '{{.${v} | default "1"}}'`);
    expect(taskfile.split(`${v}:`).length - 1).toBe(1);
  });
});
