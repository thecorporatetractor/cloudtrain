import type { FastifyInstance } from 'fastify';
import type { InstallLicenseRequest } from '@cloudtrain/api-types';
import type { Entitlements } from '../entitlements/service.js';

/*
 * `/api/platform/license` (platform admins; Entitlements authorizes): the license
 * status, installing an uploaded license, removing it. The history stays in
 * platform_licenses (installed_by / removed_by); the gateway log records every change.
 */
export function registerLicenseRoutes(app: FastifyInstance, ents: Entitlements): void {
  const platform = { config: { permission: 'org.manage' as const, anyOrg: true } };

  app.get('/api/platform/license', platform, async (req) => ents.licenseStatus(req.principal));

  app.put<{ Body: InstallLicenseRequest }>('/api/platform/license', platform, async (req) => {
    const s = await ents.installLicense(req.principal, req.body?.license ?? '');
    req.log.info({ actor: req.principal.sub, licenseId: s.license?.licenseId, state: s.state, features: s.activeFeatures }, 'license installed');
    return s;
  });

  app.delete('/api/platform/license', platform, async (req) => {
    const { removed, status } = await ents.removeLicense(req.principal);
    if (removed) req.log.info({ actor: req.principal.sub }, 'license removed: community edition');
    return status;
  });
}
