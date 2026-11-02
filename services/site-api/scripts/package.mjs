// Builds the two deployables of the website's backend (docs/deploy-site-vm.md):
//
//   pnpm --filter @cloudtrain/site-api package [--out <dir>]
//
// out/public and out/worker each hold what a Flex Consumption zip needs: host.json, a package.json
// that names the entry, and one bundled file. The site's `waitlist` configuration goes into the
// public bundle at this point, so the form and the endpoint agree: change content/site.yaml, and
// package and deploy this again.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const repo = path.resolve(pkg, '../..');
const i = process.argv.indexOf('--out');
const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(pkg, 'out'));

const site = parse(await readFile(path.join(repo, 'content/site.yaml'), 'utf8'));
if (!site.waitlist) throw new Error('content/site.yaml has no waitlist section');
const updated = site.legal?.privacy?.updated;
if (!updated || !site.waitlist.consentLabel) throw new Error('content/site.yaml needs waitlist.consentLabel and legal.privacy.updated: they are the consent evidence');
// YAML reads an unquoted date as a Date.
const noticeDate = updated instanceof Date ? updated.toISOString().slice(0, 10) : String(updated);
const consent = { labelHash: createHash('sha256').update(site.waitlist.consentLabel).digest('hex'), noticeUpdated: noticeDate, source: 'site-waitlist-form' };

await rm(out, { recursive: true, force: true });
for (const app of ['public', 'worker']) {
  const dir = path.join(out, app);
  await mkdir(dir, { recursive: true });
  const r = await build({
    entryPoints: [path.join(pkg, `src/${app}/index.ts`)],
    outfile: path.join(dir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    // CommonJS: the Azure SDKs have dynamic requires an ES module bundle cannot serve.
    format: 'cjs',
    // The Functions host provides this one at run time.
    external: ['@azure/functions-core'],
    define: { __WAITLIST_CONFIG__: app === 'public' ? JSON.stringify(site.waitlist) : 'null', __CONSENT_EVIDENCE__: app === 'public' ? JSON.stringify(consent) : 'null' },
    legalComments: 'none',
    minifySyntax: true,
    metafile: true,
  });
  await cp(path.join(pkg, `hosts/${app}.host.json`), path.join(dir, 'host.json'));
  await writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: `cloudtrain-site-${app}`, version: '0.1.0', private: true, main: 'index.js' }, null, 2)}\n`);
  const size = Object.values(r.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(`${app}: ${(size / 1024 / 1024).toFixed(1)} MiB in ${path.relative(process.cwd(), dir)}`);
}
