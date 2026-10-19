import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../config.js';
import { loadContent } from '../content/load.js';
import { loadExamCatalog } from '../exams/catalog.js';
import { loadSiteConfig } from './config.js';
import { staticSiteFiles } from './export.js';

/*
 * Writes the public website's data files for a static deployment.
 *
 *   pnpm --filter @cloudtrain/gateway site:export --out /tmp/site-data [--pricing] [--app-url https://app.example.com]
 *
 * Reads the same inputs as the gateway: CT_CONTENT_DIR (default content),
 * CT_SITE_CONFIG (default <content>/site.yaml), CT_CURRICULUM_FILE. Needs no
 * database, cluster or secret. `apps/web/scripts/build-site.mjs` calls it.
 */

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

// `pnpm --filter` runs in services/gateway; relative paths in the environment are relative to the repository root, like the gateway's.
const fromRoot = (p: string) => path.resolve(repoRoot, p);
const out = arg('out');
if (!out) {
  console.error('usage: site:export --out <dir> [--pricing] [--app-url <origin>]');
  process.exit(2);
}
const contentDir = fromRoot(process.env.CT_CONTENT_DIR ?? 'content');
const content = await loadContent(contentDir, []);
const site = await loadSiteConfig(process.env.CT_SITE_CONFIG ? fromRoot(process.env.CT_SITE_CONFIG) : path.join(contentDir, 'site.yaml'));
const exams = await loadExamCatalog(content, contentDir, process.env.CT_CURRICULUM_FILE ? fromRoot(process.env.CT_CURRICULUM_FILE) : path.join(contentDir, 'curriculum.yaml'), []);
const files = staticSiteFiles(content, site, exams, { pricing: process.argv.includes('--pricing'), ...(arg('app-url') ? { appUrl: arg('app-url')! } : {}) });
for (const f of files) {
  const dest = path.join(path.resolve(out), f.path);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, f.body);
}
console.log(`wrote ${files.length} files to ${path.resolve(out)}/data`);
