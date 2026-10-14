/**
 * DAST target for CI only (.github/workflows/dast.yml); never a deployment mode.
 *
 * The real gateway app (routes, permission hook, authz, Postgres with row-level
 * security, the seeded fictional dev data) with the test FakeCluster and
 * FakeCompiler, listening on CT_HOST:CT_PORT (default 127.0.0.1:8787). Like
 * DevAuthenticator it is refused with NODE_ENV=production.
 *
 * Identity: the seeded user id in the `x-test-user` header (optionally
 * `x-test-org`), else DAST_USER (default Priya Raman, org_admin of Quillmoor),
 * so ZAP reaches the authenticated surface. DAST_USER=none leaves requests
 * without the header unauthenticated (401). Needs CT_TEST_DATABASE_URL (owner
 * connection, roles from deploy/dev/postgres/init.sql).
 *
 *   pnpm --filter @cloudtrain/gateway exec tsx test/dast-server.ts
 */
import type { FastifyRequest } from 'fastify';
import type { Authenticator } from '../src/auth.js';
import { HeaderAuthenticator, harness, Q } from './harness.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('test/dast-server.ts is a CI test target and refuses to run with NODE_ENV=production');
}

const fallback = process.env.DAST_USER ?? Q.priya;

class DastAuthenticator implements Authenticator {
  readonly csrf = false;
  constructor(private readonly inner: HeaderAuthenticator) {}
  authenticate(req: FastifyRequest) {
    if (req.headers['x-test-user'] === undefined && fallback !== 'none') req.headers['x-test-user'] = fallback;
    return this.inner.authenticate(req);
  }
}

const h = await harness({ auth: (t) => new DastAuthenticator(new HeaderAuthenticator(t)) });
const host = process.env.CT_HOST ?? '127.0.0.1';
const port = Number(process.env.CT_PORT ?? 8787);
await h.app.listen({ host, port });
console.log(`dast-server: http://${host}:${port}/api (default user ${fallback})`);

const stop = async () => {
  await h.close();
  process.exit(0);
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
