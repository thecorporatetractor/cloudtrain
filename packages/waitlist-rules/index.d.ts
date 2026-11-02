import type { SiteWaitlist, WaitlistInterest } from '@cloudtrain/api-types';

export declare const HONEYPOT_FIELD: 'website';
export declare const EMAIL_MAX: 254;
export declare const ORGANISATION_MAX: 120;
export declare const ROLE_MAX: 80;

export interface WaitlistInput {
  email: string;
  organisation?: string;
  role?: string;
  interest?: WaitlistInterest;
}

export type FieldErrors = Partial<Record<'email' | 'organisation' | 'role' | 'interest' | 'consent', string>>;

export type WaitlistCheck = { ok: true; input: WaitlistInput } | { ok: false; message: string; fields: FieldErrors };

export declare function isEmail(v: string): boolean;
/** True when the honeypot field holds anything: a person never sees it. */
export declare function honeypotTripped(body: unknown): boolean;
/** Checks the request body against the waitlist configuration. */
export declare function checkWaitlist(body: unknown, cfg: SiteWaitlist): WaitlistCheck;
/** NFC, trimmed, lowercased: one address has one form. The input of the subject key. */
export declare function normaliseEmail(email: string): string;
