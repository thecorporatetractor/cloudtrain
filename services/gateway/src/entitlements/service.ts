import type { Edition, EntitlementSource, EntitlementsView, Feature, FeatureRequiredDetails, LicenseStatus, SeatsExceededDetails, SitePlan } from '@cloudtrain/api-types';
import { sql } from 'kysely';
import type { Principal } from '../auth.js';
import { authorize, can } from '../authz.js';
import { withTenant, type Db } from '../db/index.js';
import { HttpError } from '../errors.js';
import type { LicenseManager } from '../license/manager.js';
import { FEATURE_INFO, FEATURES, featuresOf } from './features.js';

/*
 * One answer to "may this organisation (or person) use premium feature X?",
 * whatever the deployment (docs/licensing-keys.md):
 *
 *   hosted      (CT_EDITION=hosted)      the plan: the organisation's plan for
 *               organisation features, the person's own plan or their seated
 *               organisation plan for personal ones (site.yaml plans.items[].features);
 *               instance features (multi_org) belong to the operator and are on.
 *   self-hosted (CT_EDITION=selfhosted)  the license key, instance-wide; plans
 *               count too only when billing is explicitly enabled.
 *   neither                              community edition: no premium features.
 *
 * The gateway is authoritative (`assert` answers 402 `feature_required`); the web
 * reads `Me.entitlements` to show locks and upsells. Switching a feature off never
 * deletes data: gated writes are refused, saved settings are kept and ignored.
 */

/** Plans of an organisation and a person (the billing service on the hosted edition). */
export interface PlanSource {
  readonly plans: SitePlan[];
  plansOf(orgId: string, userId?: string): Promise<{ org?: SitePlan; user?: SitePlan; seated: boolean }>;
}

export interface EntitlementsDeps {
  edition: Edition;
  license: LicenseManager;
  /** Plans count on the hosted edition, and on self-hosted only with billing on. */
  plans?: PlanSource;
  /** Active-member count for license seats. */
  db?: Db;
}

export interface EntitlementContext {
  orgId?: string | null;
  userId?: string | null;
}

export interface Resolved {
  features: Set<Feature>;
  source: EntitlementSource;
  plan?: SitePlan;
}

export class Entitlements {
  readonly edition: Edition;
  private readonly all: boolean;

  constructor(
    private readonly d: EntitlementsDeps | null,
    all = false,
  ) {
    this.edition = d?.edition ?? 'selfhosted';
    this.all = all;
  }

  /** Every feature on: for tests and embedders that do not gate. Never used by main.ts. */
  static unrestricted(): Entitlements {
    return new Entitlements(null, true);
  }

  get license(): LicenseManager | undefined {
    return this.d?.license;
  }

  async resolve(ctx: EntitlementContext): Promise<Resolved> {
    if (this.all || !this.d) return { features: new Set(FEATURES), source: 'operator' };
    const d = this.d;
    await d.license.refresh();
    const lic = new Set(d.license.features());
    const out = new Set<Feature>(lic);
    let plan: SitePlan | undefined;
    if (d.plans && ctx.orgId) {
      const p = await d.plans.plansOf(ctx.orgId, ctx.userId ?? undefined);
      const orgF = featuresOf(p.org?.features);
      const userF = featuresOf(p.user?.features);
      for (const f of orgF) {
        const scope = FEATURE_INFO[f].scope;
        if (scope === 'org' || (scope === 'user' && (p.seated || !ctx.userId))) out.add(f);
      }
      for (const f of userF) if (FEATURE_INFO[f].scope === 'user') out.add(f);
      plan = orgF.length >= userF.length ? (p.org ?? p.user) : (p.user ?? p.org);
    }
    // The hosted operator runs many organisations by design.
    if (this.edition === 'hosted') out.add('multi_org');
    const fromPlan = [...out].some((f) => !lic.has(f) && f !== 'multi_org');
    const source: EntitlementSource = lic.size ? (d.license.isDev ? 'dev_license' : 'license') : fromPlan ? 'plan' : 'community';
    return { features: out, source, ...(plan && plan.kind !== 'free' ? { plan } : {}) };
  }

  async has(feature: Feature, ctx: EntitlementContext): Promise<boolean> {
    return (await this.resolve(ctx)).features.has(feature);
  }

  /** Hosted plans that include `feature` (for upsells). */
  plansWith(feature: Feature): { id: string; name: string }[] {
    return (this.d?.plans?.plans ?? []).filter((p) => p.features?.includes(feature)).map((p) => ({ id: p.id, name: p.name }));
  }

  /** Why `feature` is off, what fixes it and who can (the 402 body's details). */
  details(feature: Feature, p?: Principal): FeatureRequiredDetails {
    const info = FEATURE_INFO[feature];
    const base = { feature, featureName: info.name, edition: this.edition };
    if (this.edition === 'hosted' && info.scope !== 'instance') {
      const plans = this.plansWith(feature);
      const scopeOrg = info.scope === 'org';
      const self = !scopeOrg || (p ? can(p, 'billing.manage', { kind: 'org' }) : false);
      return { ...base, reason: 'not_in_plan', action: self ? 'upgrade' : 'contact_admin', href: scopeOrg ? '/admin/billing' : '/account/billing', ...(plans.length ? { plans } : {}) };
    }
    const reason = this.d?.license.offReason() ?? 'no_license';
    return { ...base, reason, action: p?.platformAdmin ? 'license' : 'contact_admin', href: '/platform/license' };
  }

  /** Refuses with 402 `feature_required` unless the org (or person) has `feature`. */
  async assert(feature: Feature, p: Principal, ctx?: EntitlementContext): Promise<void> {
    if (await this.has(feature, ctx ?? { orgId: p.orgId || null, userId: p.sub })) return;
    throw this.error(feature, p);
  }

  error(feature: Feature, p?: Principal): HttpError {
    const det = this.details(feature, p);
    const why =
      det.reason === 'not_in_plan'
        ? `${det.featureName} is not included in your ${FEATURE_INFO[feature].scope === 'org' ? "organisation's " : ''}plan${det.plans?.length ? ` (it is in ${det.plans.map((x) => x.name).join(', ')})` : ''}.`
        : det.reason === 'license_expired'
          ? `${det.featureName} needs a current CloudTrain license; the installed one has expired.`
          : det.reason === 'license_invalid'
            ? `${det.featureName} needs a valid CloudTrain license; the installed one is invalid.`
            : `${det.featureName} is a premium feature: it needs a CloudTrain license on a self-hosted deployment.`;
    return new HttpError(402, why, { code: 'feature_required', details: det as unknown as Record<string, unknown> });
  }

  /** Active members of active organisations on this instance (license seats). */
  async seatsUsed(): Promise<number> {
    if (!this.d?.db) return 0;
    const r = await withTenant(this.d.db, { platform: true }, (tx) =>
      tx
        .selectFrom('memberships as m')
        .innerJoin('orgs as o', 'o.id', 'm.org_id')
        .select(sql<number>`count(DISTINCT m.user_id)::int`.as('n'))
        .where('m.status', '=', 'active')
        .where('o.status', '=', 'active')
        .executeTakeFirstOrThrow(),
    );
    return Number(r.n);
  }

  /**
   * Soft seat limit of a self-hosted license: adding members past it (invitations,
   * reactivations) is refused with 402 `seats_exceeded`; nobody already active is
   * affected and sign-in never is.
   */
  async assertSeatAvailable(adding = 1): Promise<void> {
    if (this.all || !this.d) return;
    const licensed = this.d.license.seats();
    if (!licensed) return;
    const used = await this.seatsUsed();
    if (used + adding <= licensed) return;
    const details: SeatsExceededDetails = { licensed, used, href: '/platform/license' };
    throw new HttpError(402, `The CloudTrain license covers ${licensed} active members and ${used} are active. Deactivate members or extend the license to add more.`, { code: 'seats_exceeded', details: details as unknown as Record<string, unknown> });
  }

  /* --------------------------------------------- license (platform admins) */

  private licenseFor(p: Principal): LicenseManager {
    authorize(p, 'org.manage', { kind: 'platform' });
    if (!this.d?.license) throw new HttpError(404, 'This gateway has no license manager', { code: 'not_found' });
    return this.d.license;
  }

  /** `GET /api/platform/license`. */
  async licenseStatus(p: Principal): Promise<LicenseStatus> {
    return this.licenseFor(p).status(await this.seatsUsed());
  }

  /** `PUT /api/platform/license`: verifies and stores an uploaded license. */
  async installLicense(p: Principal, text: string): Promise<LicenseStatus> {
    await this.licenseFor(p).install(text, { id: p.sub, name: p.name });
    return this.licenseStatus(p);
  }

  /** `DELETE /api/platform/license`: back to the community edition. */
  async removeLicense(p: Principal): Promise<{ removed: boolean; status: LicenseStatus }> {
    const removed = await this.licenseFor(p).remove({ id: p.sub });
    return { removed, status: await this.licenseStatus(p) };
  }

  /** `Me.entitlements` for the principal in its active org. */
  async view(p: Principal): Promise<EntitlementsView> {
    const r = await this.resolve({ orgId: p.orgId || null, userId: p.sub });
    const admin = p.platformAdmin || can(p, 'settings.manage', { kind: 'org' });
    let license;
    if (admin && this.d && this.edition === 'selfhosted') {
      const lic = this.d.license;
      const seats = lic.seats() ? await this.seatsUsed() : undefined;
      license = lic.notice(seats);
    }
    const upgrade: EntitlementsView['upgrade'] = {};
    if (this.edition === 'hosted') for (const f of FEATURES) if (!r.features.has(f)) upgrade[f] = this.plansWith(f);
    return {
      edition: this.edition,
      features: FEATURES.filter((f) => r.features.has(f)),
      source: r.source,
      ...(r.plan ? { plan: { id: r.plan.id, name: r.plan.name } } : {}),
      ...(license ? { license } : {}),
      ...(Object.keys(upgrade).length ? { upgrade } : {}),
    };
  }
}
