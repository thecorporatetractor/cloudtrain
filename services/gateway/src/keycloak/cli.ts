import { loadConfig } from '../config.js';
import { loadContent } from '../content/load.js';
import { createDb } from '../db/index.js';
import { MemoryMailer } from '../mail.js';
import { PlatformService } from '../platform/service.js';
import { KeycloakAdmin } from './admin.js';
import { ENTRA_ENV_FILE, syncKeycloak } from './sync.js';

/** `tsx src/keycloak/cli.ts sync`: Keycloak organizations/IdP links from the database (idempotent). */
async function main() {
  const config = loadConfig();
  const db = createDb(config.databaseUrl, 2);
  const kc = new KeycloakAdmin({ baseUrl: config.keycloak.baseUrl, realm: config.keycloak.realm, clientId: config.keycloak.adminClientId, clientSecret: config.keycloak.adminClientSecret });
  const content = await loadContent(config.contentDir, config.extraLabDirs);
  const ps = new PlatformService({
    db,
    content,
    cluster: { listSessions: async () => [] } as never,
    mailer: new MemoryMailer(),
    kc,
    config: { webUrl: config.webUrl, publicUrl: config.publicUrl, oidcClientId: config.oidc.clientId, platformIdps: config.platformIdps, devDomainVerifyBypass: config.devDomainVerifyBypass, kubeContext: config.kubeContext, namespace: config.namespace },
  });
  try {
    const r = await syncKeycloak(ps, kc, db);
    console.log(`keycloak: organizations ${r.orgs.join(', ') || 'none'}; linked IdPs ${r.linkedIdps.join(', ') || 'none'}; ${r.members} local members`);
    if (r.entra === 'absent') console.log(`entra: ${ENTRA_ENV_FILE} not found; skipping the azarguard-entra IdP (see docs/dev-environment.md)`);
    else if (r.entra === 'incomplete') console.log(`entra: ${ENTRA_ENV_FILE} lacks tenant id, client id or client secret; skipping (values not shown)`);
    else console.log('entra: azarguard-entra IdP configured (values not shown)');
  } finally {
    await db.destroy();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
