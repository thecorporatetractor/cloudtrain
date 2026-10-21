/**
 * Entitlements: which premium features an organisation or person has, and the
 * self-hosted license behind them (docs/licensing-keys.md).
 *
 * - Hosted (`CT_EDITION=hosted`): features come from the plan (content/site.yaml
 *   `plans.items[].features`), compute is metered and billed.
 * - Self-hosted (`CT_EDITION=selfhosted`, the default): features come from an
 *   offline license key; without one it is the community edition (every lab,
 *   no premium features, no billing unless explicitly enabled).
 */

export type Edition = 'hosted' | 'selfhosted';

/** Premium features. Everything else is community and always available. */
export type Feature = 'sso' | 'scim' | 'audit_export' | 'advanced_analytics' | 'exam_certificates' | 'custom_branding' | 'multi_org';

export interface FeatureInfo {
  id: Feature;
  name: string;
  /** Where it is decided: the organisation, the person, or the deployment. */
  scope: 'org' | 'user' | 'instance';
  /** `reserved`: the flag exists, the feature is not built yet. */
  status: 'available' | 'reserved';
  description: string;
}

/** Where the effective features come from. */
export type EntitlementSource = 'plan' | 'license' | 'dev_license' | 'community' | 'operator';

/** `Me.entitlements`: what the UI locks or unlocks for the signed-in person in the active org. */
export interface EntitlementsView {
  edition: Edition;
  features: Feature[];
  /** The source that granted the most (a plan, the license, or none: community). */
  source: EntitlementSource;
  /** Hosted: the plan granting the features. */
  plan?: { id: string; name: string };
  /** Self-hosted, for platform and org admins only: license state worth a banner. */
  license?: LicenseNotice;
  /** Hosted plans that include each feature (upsell). */
  upgrade?: Partial<Record<Feature, { id: string; name: string }[]>>;
}

export type LicenseState =
  /** No license installed: community edition. */
  | 'none'
  | 'valid'
  /** Valid, expires within the warning window (30 days). */
  | 'expiring'
  /** Past `expiresAt`, inside the grace period (14 days): features still on. */
  | 'grace'
  /** Past the grace period: premium features off, data kept. */
  | 'expired'
  | 'not_yet_valid'
  /** Unreadable, tampered, unknown or retired signing key. */
  | 'invalid'
  /** Installed but not used: the hosted edition takes features from plans. */
  | 'ignored';

export interface LicenseNotice {
  state: LicenseState;
  /** Days until `expiresAt` (negative once past it). */
  daysLeft?: number;
  expiresAt?: string;
  graceEndsAt?: string;
  seatsOver?: boolean;
  message: string;
}

export interface LicenseInfo {
  licenseId: string;
  licensee: { name: string; email?: string };
  edition: string;
  /** As signed, including names this gateway does not know. */
  features: string[];
  seats: number;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  /** Signing key id. */
  kid: string;
}

/** `GET /api/platform/license` (platform admins). */
export interface LicenseStatus {
  edition: Edition;
  state: LicenseState;
  /** Where the license was read from. `dev`: CT_DEV_LICENSE (development only). */
  source: 'env' | 'file' | 'upload' | 'dev' | 'none';
  license?: LicenseInfo;
  /** Why the license is invalid. */
  error?: string;
  daysLeft?: number;
  graceEndsAt?: string;
  warnDays: number;
  graceDays: number;
  /** Premium features in force now (empty when expired, invalid or none). */
  activeFeatures: Feature[];
  /** `used`: active members of active organisations on this instance. `licensed` 0 = unlimited. */
  seats: { licensed: number; used: number; over: boolean };
  /** Signing keys this gateway accepts (rotation). */
  keys: { kid: string; label?: string; retiredAt?: string }[];
  /** False when CT_LICENSE_KEY / CT_LICENSE_FILE / CT_DEV_LICENSE set it (the environment wins). */
  uploadAllowed: boolean;
  installedAt?: string;
  installedBy?: string;
  catalog: FeatureInfo[];
  message: string;
}

/** `PUT /api/platform/license`. */
export interface InstallLicenseRequest {
  /** The license token or the whole license file. */
  license: string;
}

/** `details` of a 402 `feature_required`. */
export interface FeatureRequiredDetails {
  feature: Feature;
  featureName: string;
  edition: Edition;
  /** `upgrade`: a hosted plan includes it; `license`: a self-hosted license key is needed (or renewed); `contact_admin`: someone else can fix it. */
  action: 'upgrade' | 'license' | 'contact_admin';
  /** Why it is off: not in the plan, no license, or the license expired / is invalid. */
  reason: 'not_in_plan' | 'no_license' | 'license_expired' | 'license_invalid';
  href: string;
  /** Hosted plans that include the feature. */
  plans?: { id: string; name: string }[];
}

/** `details` of a 402 `seats_exceeded`. */
export interface SeatsExceededDetails {
  licensed: number;
  used: number;
  href: string;
}
