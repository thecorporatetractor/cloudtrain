// Builds the public marketing website as a static bundle (docs/deploy-website.md).
//
//   pnpm --filter web build:site -- [--out dist-site] [--api-base https://api.example.com]
//                                   [--app-url https://app.example.com] [--pricing]
//
//   --api-base  Origin of the gateway the waitlist form posts to (env CT_API_BASE).
//               Empty: same origin as the site (a reverse proxy routes /api).
//               The gateway must list the site's origin in CT_CORS_ORIGINS.
//   --app-url   Origin of the platform for "Sign in" (env CT_APP_URL). Empty: the
//               site has no sign-in button and /sign-in explains itself.
//   --pricing   Keep the pricing page (its plan buttons need the platform).
//
// Steps: export the public data (site.json, catalog, path and exam documents) from
// content/ with the gateway's own code, run `vite build` in static website mode
// (VITE_SITE_MODE=static, API mode real, so no mock service worker), then add the
// data, runtime-config.js and the host files (404.html, _redirects, _headers,
// staticwebapp.config.json, .nojekyll, robots.txt). No account, domain or host is
// needed; the output directory is plain files for any static host.
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFile, originOf, redirectsFile, robotsTxt, runtimeConfigJs, staticWebAppConfig } from './site-hosting.mjs';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const repo = path.resolve(web, '../..');
const out = path.resolve(process.cwd(), arg('out', 'dist-site'));
const pricing = process.argv.includes('--pricing');
const apiBase = originOf(arg('api-base', process.env.CT_API_BASE), 'api base');
const appUrl = originOf(arg('app-url', process.env.CT_APP_URL), 'app url');

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: repo, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`build-site: "${cmd} ${args.join(' ')}" failed (${r.status ?? r.signal})`);
    process.exit(r.status ?? 1);
  }
}

const data = await mkdtemp(path.join(os.tmpdir(), 'ct-site-data-'));
try {
  console.log('1/3 exporting the public data from content/');
  run('pnpm', ['--filter', '@cloudtrain/gateway', 'site:export', '--out', data, ...(pricing ? ['--pricing'] : []), ...(appUrl ? ['--app-url', appUrl] : [])]);

  console.log('2/3 building the static site');
  await rm(out, { recursive: true, force: true });
  run('pnpm', ['--filter', 'web', 'exec', 'vite', 'build', '--outDir', out, '--emptyOutDir'], { VITE_API_MODE: 'real', VITE_SITE_MODE: 'static', VITE_APP_URL: appUrl });

  console.log('3/3 adding data and host files');
  await cp(path.join(data, 'data'), path.join(out, 'data'), { recursive: true });
  await rm(path.join(out, 'mockServiceWorker.js'), { force: true });
  await writeFile(path.join(out, 'runtime-config.js'), runtimeConfigJs(apiBase));
  await copyFile(path.join(out, 'index.html'), path.join(out, '404.html')); // GitHub Pages serves this for unknown paths
  await writeFile(path.join(out, '_redirects'), redirectsFile);
  await writeFile(path.join(out, '_headers'), headersFile(apiBase));
  await writeFile(path.join(out, 'staticwebapp.config.json'), staticWebAppConfig(apiBase));
  await writeFile(path.join(out, '.nojekyll'), '');
  await writeFile(path.join(out, 'robots.txt'), robotsTxt);

  const index = await readFile(path.join(out, 'index.html'), 'utf8');
  if (!index.includes('runtime-config.js')) throw new Error('index.html does not load runtime-config.js');
  await stat(path.join(out, 'data', 'site.json'));
  console.log(`\nStatic site ready in ${out}`);
  console.log(`  API base for the waitlist form: ${apiBase || '(same origin as the site)'}`);
  console.log(`  Sign-in hands over to:          ${appUrl || '(nothing: no sign-in on this site)'}`);
  console.log(`  Preview: pnpm --filter web exec vite preview --outDir ${out}`);
} finally {
  await rm(data, { recursive: true, force: true });
}
