/**
 * Data-subject rights (services/gateway/src/gdpr, docs/gdpr.md).
 */

/** What a visitor without an account may ask for. */
export type PublicPrivacyRequestType = 'erasure' | 'withdrawal' | 'export';

export interface PublicPrivacyRequest {
  email: string;
  type: PublicPrivacyRequestType;
  /** Honeypot: hidden from people. */
  website?: string;
}

/** The one answer to POST /api/public/privacy/requests, for every address. */
export interface PrivacyAccepted {
  status: 'accepted';
  message: string;
}

export interface PrivacyConfirmRequest {
  token: string;
}

export interface PrivacyExportedWaitlistEntry {
  email: string;
  organisation: string | null;
  role: string | null;
  interest: string | null;
  consentAt: string;
  createdAt: string;
}

export interface PrivacyConfirmResponse {
  /** `pending` (HTTP 202): not finished yet; a mail follows. Never read it as done. */
  status: 'completed' | 'pending';
  type: PublicPrivacyRequestType;
  /** Rows removed (only with `completed`). */
  removed?: number;
  /** Only for `export`. */
  data?: { waitlist: PrivacyExportedWaitlistEntry[] };
}

export type PrivacyBlockerCode = 'sole_org_admin' | 'last_platform_admin' | 'subscription' | 'open_balance' | 'unbilled_usage' | 'billing_unavailable' | 'identity_unavailable' | 'impersonated';

export interface PrivacyBlocker {
  code: PrivacyBlockerCode;
  message: string;
  orgs?: string[];
}

export interface PrivacyRetainedNotice {
  category: string;
  explanation: string;
}

export interface AccountPrivacySummary {
  email: string;
  name: string;
  /** Art. 18: when processing was restricted; null when it is not. */
  restrictedAt: string | null;
  /** Art. 16: where name and address are corrected. */
  rectification: { managedBy: 'identity_account'; url?: string } | { managedBy: 'organisation'; organisation?: string };
  /** Days from closing an account to its deletion; 0: it stays until someone asks. */
  closureDays: number;
  /** The inbox for anything these pages do not cover. */
  contact: string;
  /** False: download, deletion and closure answer `reauth_required` until the person signs in again. */
  recentSignIn: boolean;
  /** The address is on the early-access waitlist: the one thing here that rests on consent. */
  waitlistEntry: boolean;
  /** Empty: the account can be deleted now. */
  blockers: PrivacyBlocker[];
  retained: PrivacyRetainedNotice[];
}

export interface AccountDeleteRequest {
  confirmEmail: string;
}

export interface AccountDeleteResponse {
  /** `pending` (HTTP 202): access has ended and erasure carries on; a mail follows. */
  status: 'completed' | 'pending';
  requestId: string;
  retained: PrivacyRetainedNotice[];
}

export interface AccountCloseResponse {
  status: 'closed';
  /** When deletion becomes due; null when closed accounts are kept until someone asks. */
  deleteAfter: string | null;
}

export interface AccountRestrictionResponse {
  restrictedAt: string | null;
  /** Running labs ended by this request. */
  endedLabs: number;
}

/** What rests on legitimate interest. */
export type ObjectionProcessing = 'security_log' | 'progress_reporting' | 'observation' | 'other';

export interface ObjectionRequest {
  processing: ObjectionProcessing;
  note?: string;
}

export interface ObjectionResponse {
  status: 'raised';
  requestId: string;
  contact: string;
}

export interface WithdrawResponse {
  status: 'completed' | 'pending';
  removed: number;
}

export interface LedgerRequestView {
  requestId: string;
  seq: number;
  type: string;
  scope: string;
  actor: string;
  requestedAt: string;
  completedAt: string;
  reason?: string;
  outcomes: { system: string; action: string; rows: number }[];
}

/** Platform admins: completed requests with no subject key, plus the state of the hash chain. */
export interface LedgerView {
  requests: LedgerRequestView[];
  chain: { ok: boolean; count: number; headSeq: number; headHash: string; problems: number };
}
