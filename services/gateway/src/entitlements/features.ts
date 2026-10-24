import type { Feature, FeatureInfo } from '@cloudtrain/api-types';

/*
 * The premium features of CloudTrain (docs/licensing-keys.md, docs/licensing.md).
 * Everything not listed here is part of the community edition and always on:
 * every lab, local accounts, teams, assignments, cohorts, the basic manager
 * dashboard, the audit log in the UI, exam simulations, billing when enabled.
 *
 * Scope says where a feature is decided:
 *   org       the organisation's plan (hosted) or the instance license (self-hosted)
 *   user      the person's own plan, their organisation's plan when they hold a seat,
 *             or the instance license
 *   instance  the deployment as a whole (the license; always on for the hosted operator)
 */

export const FEATURES = ['sso', 'scim', 'audit_export', 'advanced_analytics', 'exam_certificates', 'custom_branding', 'multi_org'] as const satisfies readonly Feature[];

export const FEATURE_INFO: Record<Feature, FeatureInfo> = {
  sso: {
    id: 'sso',
    name: 'Single sign-on',
    scope: 'org',
    status: 'available',
    description: 'Organisation identity providers (OIDC, SAML) with group-to-role mapping and enforced SSO. Local accounts always work.',
  },
  scim: {
    id: 'scim',
    name: 'SCIM provisioning',
    scope: 'org',
    status: 'reserved',
    description: 'User and group provisioning over SCIM 2.0. Reserved: not built yet.',
  },
  audit_export: {
    id: 'audit_export',
    name: 'Audit log export',
    scope: 'org',
    status: 'available',
    description: 'CSV export of the organisation audit log. Browsing and filtering it in the admin area stays free.',
  },
  advanced_analytics: {
    id: 'advanced_analytics',
    name: 'Advanced analytics',
    scope: 'org',
    status: 'available',
    description: 'Framework readiness per team and member, the eight-week practice trend and team exam readiness. The team heatmap, totals, at-risk list, assignments and progress CSV stay free.',
  },
  exam_certificates: {
    id: 'exam_certificates',
    name: 'Exam certificates',
    scope: 'user',
    status: 'reserved',
    description: 'Certificates of completion for passed exam simulations. Reserved: not built yet; exam simulations and their reports stay free.',
  },
  custom_branding: {
    id: 'custom_branding',
    name: 'Custom branding',
    scope: 'org',
    status: 'available',
    description: 'The organisation logo and accent colour in the app. Saved values are kept when the feature lapses, just not shown.',
  },
  multi_org: {
    id: 'multi_org',
    name: 'Multiple organisations',
    scope: 'instance',
    status: 'available',
    description: 'More than one organisation on a self-hosted instance. Existing organisations keep working when the feature lapses; only creating another is refused.',
  },
};

export function isFeature(v: unknown): v is Feature {
  return typeof v === 'string' && (FEATURES as readonly string[]).includes(v);
}

/** Known feature names out of any list (plans, licenses), in catalog order, without duplicates. */
export function featuresOf(list: readonly string[] | undefined): Feature[] {
  const set = new Set(list ?? []);
  return FEATURES.filter((f) => set.has(f));
}
