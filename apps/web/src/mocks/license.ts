import { delay, http, HttpResponse } from 'msw';
import type { EntitlementsView, Feature, FeatureInfo, LicenseNotice, LicenseStatus, Me } from '@/api/types';
import { currentMe } from './platformHandlers';

/*
 * Mock license and entitlements (services/gateway/src/license, src/entitlements).
 * Mock mode plays a self-hosted deployment. Its license state lives in
 * localStorage (`ct.mock.license`) so screenshots can show each one:
 *   licensed (default, every premium feature), community (none), expiring,
 *   grace, expired.
 * "Installing" any text that contains a dot turns it into `licensed`;
 * text with "invalid" in it is refused like a tampered key.
 */

const KEY = 'ct.mock.license';
type MockState = 'licensed' | 'community' | 'expiring' | 'grace' | 'expired';
const DAY = 86_400_000;

export const FEATURE_CATALOG: FeatureInfo[] = [
  { id: 'sso', name: 'Single sign-on', scope: 'org', status: 'available', description: 'Organisation identity providers (OIDC, SAML) with group-to-role mapping and enforced SSO. Local accounts always work.' },
  { id: 'scim', name: 'SCIM provisioning', scope: 'org', status: 'reserved', description: 'User and group provisioning over SCIM 2.0. Reserved: not built yet.' },
  { id: 'audit_export', name: 'Audit log export', scope: 'org', status: 'available', description: 'CSV export of the organisation audit log. Browsing and filtering it in the admin area stays free.' },
  { id: 'advanced_analytics', name: 'Advanced analytics', scope: 'org', status: 'available', description: 'Framework readiness per team and member, the eight-week practice trend and team exam readiness. The team heatmap, totals, at-risk list, assignments and progress CSV stay free.' },
  { id: 'exam_certificates', name: 'Exam certificates', scope: 'user', status: 'reserved', description: 'Certificates of completion for passed exam simulations. Reserved: not built yet; exam simulations and their reports stay free.' },
  { id: 'custom_branding', name: 'Custom branding', scope: 'org', status: 'available', description: 'The organisation logo and accent colour in the app. Saved values are kept when the feature lapses, just not shown.' },
  { id: 'multi_org', name: 'Multiple organisations', scope: 'instance', status: 'available', description: 'More than one organisation on a self-hosted instance. Existing organisations keep working when the feature lapses; only creating another is refused.' },
];
const ALL: Feature[] = FEATURE_CATALOG.map((f) => f.id);

function readState(): { state: MockState; installedAt: string } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as { state?: MockState; installedAt?: string };
      if (v.state) return { state: v.state, installedAt: v.installedAt ?? new Date(Date.now() - 40 * DAY).toISOString() };
    }
  } catch {
    /* ignore */
  }
  return { state: 'licensed', installedAt: new Date(Date.now() - 40 * DAY).toISOString() };
}

function writeState(state: MockState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, installedAt: new Date().toISOString() }));
  } catch {
    /* ignore */
  }
}

const day0 = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

/** Expiry per state: 10 months out, 18 days out, 5 days ago, 30 days ago. */
function expiresAt(state: MockState): Date {
  const offset = { licensed: 300, community: 0, expiring: 18, grace: -5, expired: -30 }[state];
  return new Date(day0() + offset * DAY);
}

const SEATS = 250;
const USED = 41;

function active(state: MockState): boolean {
  return state === 'licensed' || state === 'expiring' || state === 'grace';
}

function notice(state: MockState): LicenseNotice | undefined {
  const exp = expiresAt(state);
  const grace = new Date(exp.getTime() + 14 * DAY);
  const daysLeft = Math.floor((exp.getTime() - Date.now()) / DAY);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  if (state === 'expiring') return { state, daysLeft, expiresAt: exp.toISOString(), graceEndsAt: grace.toISOString(), message: `The CloudTrain license expires in ${daysLeft} days (${d(exp)}). Renew it to keep the premium features.` };
  if (state === 'grace') return { state, daysLeft, expiresAt: exp.toISOString(), graceEndsAt: grace.toISOString(), message: `The CloudTrain license expired on ${d(exp)}. Premium features stay on until ${d(grace)}; install a renewed license before then.` };
  if (state === 'expired') return { state, daysLeft, expiresAt: exp.toISOString(), graceEndsAt: grace.toISOString(), message: `The CloudTrain license expired on ${d(exp)} and its grace period has ended: premium features are off. Nothing was deleted; installing a renewed license turns them back on.` };
  return undefined;
}

/** `Me.entitlements` for a mock principal. */
export function mockEntitlements(me: Pick<Me, 'platformAdmin' | 'permissions'>): EntitlementsView {
  const { state } = readState();
  const on = active(state);
  const admin = me.platformAdmin || me.permissions.includes('settings.manage');
  const n = admin ? notice(state) : undefined;
  return { edition: 'selfhosted', features: on ? ALL : [], source: on ? 'license' : 'community', ...(n ? { license: n } : {}) };
}

function status(): LicenseStatus {
  const { state, installedAt } = readState();
  const exp = expiresAt(state);
  const on = active(state);
  const daysLeft = Math.floor((exp.getTime() - Date.now()) / DAY);
  const licensed = state !== 'community';
  const nb = new Date(exp.getTime() - 365 * DAY);
  return {
    edition: 'selfhosted',
    state: state === 'licensed' ? 'valid' : state === 'community' ? 'none' : state,
    source: licensed ? 'upload' : 'none',
    ...(licensed
      ? {
          license: { licenseId: 'lic_20251216_8f3a2c91d0', licensee: { name: 'Quillmoor Logistics Ltd', email: 'it-licensing@quillmoor.example' }, edition: 'enterprise', features: ALL, seats: SEATS, issuedAt: nb.toISOString(), notBefore: nb.toISOString(), expiresAt: exp.toISOString(), kid: 'ct-2026-10' },
          daysLeft,
          graceEndsAt: new Date(exp.getTime() + 14 * DAY).toISOString(),
          installedAt,
          installedBy: 'Elin Marsh',
        }
      : {}),
    warnDays: 30,
    graceDays: 14,
    activeFeatures: on ? ALL : [],
    seats: { licensed: on ? SEATS : 0, used: USED, over: false },
    keys: [{ kid: 'ct-2026-10', label: 'CloudTrain license signing key (2026-10-21)' }],
    uploadAllowed: true,
    catalog: FEATURE_CATALOG,
    message: notice(state)?.message ?? (licensed ? `Licensed to Quillmoor Logistics Ltd until ${exp.toISOString().slice(0, 10)}.` : 'Community edition: every lab, no premium features. Install a license key to unlock them.'),
  };
}

const forbidden = () => HttpResponse.json({ error: 'Missing permission org.manage', code: 'forbidden', permission: 'org.manage' }, { status: 403 });

function guard() {
  const m = currentMe();
  if (!m) return HttpResponse.json({ error: 'Not signed in', code: 'unauthenticated' }, { status: 401 });
  if (!m.platformAdmin) return forbidden();
  return undefined;
}

export const licenseHandlers = [
  http.get('/api/platform/license', async () => {
    await delay(200);
    return guard() ?? HttpResponse.json(status() as unknown as Record<string, unknown>);
  }),
  http.put('/api/platform/license', async ({ request }) => {
    await delay(400);
    const g = guard();
    if (g) return g;
    const body = (await request.json().catch(() => ({}))) as { license?: string };
    const text = body.license?.trim() ?? '';
    if (!text) return HttpResponse.json({ error: 'license is required', code: 'invalid', details: { license: 'required' } }, { status: 422 });
    if (/invalid/i.test(text) || !text.includes('.')) return HttpResponse.json({ error: 'License signature does not verify: the key was altered or not issued by CloudTrain', code: 'invalid', details: { license: 'bad_signature' } }, { status: 422 });
    writeState('licensed');
    return HttpResponse.json(status() as unknown as Record<string, unknown>);
  }),
  http.delete('/api/platform/license', async () => {
    await delay(300);
    const g = guard();
    if (g) return g;
    writeState('community');
    return HttpResponse.json(status() as unknown as Record<string, unknown>);
  }),
];

/** Whether the mock deployment has `f` now (like Entitlements.has on the gateway). */
export function mockHas(f: Feature): boolean {
  return active(readState().state) && ALL.includes(f);
}

/** The gateway's 402 `feature_required` for `f`, or undefined when the mock has it. */
export function featureRequired(f: Feature, me: Pick<Me, 'platformAdmin'> | undefined) {
  if (mockHas(f)) return undefined;
  const info = FEATURE_CATALOG.find((x) => x.id === f)!;
  const expired = readState().state === 'expired';
  return HttpResponse.json(
    {
      error: expired ? `${info.name} needs a current CloudTrain license; the installed one has expired.` : `${info.name} is a premium feature: it needs a CloudTrain license on a self-hosted deployment.`,
      code: 'feature_required',
      details: { feature: f, featureName: info.name, edition: 'selfhosted', reason: expired ? 'license_expired' : 'no_license', action: me?.platformAdmin ? 'license' : 'contact_admin', href: '/platform/license' },
    },
    { status: 402 },
  );
}
