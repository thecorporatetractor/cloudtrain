import { describe, expect, it } from 'vitest';
import type { EntitlementsView, Me } from '@/api/types';
import { hasFeature, unlockHint } from './entitlements';

const me = (e: EntitlementsView | undefined, over: Partial<Me> = {}) => ({ permissions: [], platformAdmin: false, entitlements: e, ...over }) as unknown as Me;

describe('entitlements in the UI', () => {
  it('an older gateway without entitlements locks nothing', () => {
    expect(hasFeature(me(undefined), 'sso')).toBe(true);
  });

  it('follows the feature list', () => {
    const m = me({ edition: 'selfhosted', features: ['sso'], source: 'license' });
    expect(hasFeature(m, 'sso')).toBe(true);
    expect(hasFeature(m, 'audit_export')).toBe(false);
  });

  it('self-hosted: platform admins are sent to the license page, others to their administrator', () => {
    const e: EntitlementsView = { edition: 'selfhosted', features: [], source: 'community' };
    expect(unlockHint(me(e, { platformAdmin: true }), 'sso')).toMatchObject({ to: '/platform/license', cta: 'Install a license' });
    expect(unlockHint(me(e), 'sso').to).toBeUndefined();
    expect(unlockHint(me(e), 'sso').text).toMatch(/platform administrator/);
    const expired: EntitlementsView = { ...e, license: { state: 'expired', message: '' } };
    expect(unlockHint(me(expired, { platformAdmin: true }), 'sso')).toMatchObject({ cta: 'Renew the license' });
  });

  it('hosted: billing admins see the plans that include it', () => {
    const e: EntitlementsView = { edition: 'hosted', features: [], source: 'plan', upgrade: { sso: [{ id: 'team', name: 'Team' }] } };
    const admin = unlockHint(me(e, { permissions: ['billing.manage'] }), 'sso');
    expect(admin).toMatchObject({ to: '/admin/billing', cta: 'See plans' });
    expect(admin.text).toMatch(/included in Team/);
    expect(unlockHint(me(e), 'sso').text).toMatch(/Ask an organisation admin/);
  });
});
