import { authorize } from '../authz.js';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AccountCloseResponse, AccountDeleteResponse, AccountPrivacySummary, AccountRestrictionResponse, LedgerRequestView, LedgerView, ObjectionProcessing, ObjectionResponse, PrivacyBlocker, PrivacyConfirmResponse, PublicPrivacyRequestType } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { withTenant, type Db, type Tx } from '../db/index.js';
import type { GdprRequestStateJson, GdprRequestsTable } from '../db/schema.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';
import { monthsBefore } from './retention.js';
import type { ExamCluster } from '../exams/kube.js';
import type { KeycloakAdmin } from '../keycloak/admin.js';
import { LABEL_LEARNER } from '../kube/types.js';
import type { LabCluster } from '../kube/cluster.js';
import type { Mailer } from '../mail.js';
import type { Sealer, SessionStore } from '../oidc/sessions.js';
import { labelValue } from '../sessions/service.js';
import type { WaitlistStore } from '../waitlist/store.js';
import { BACKUP_LEGAL_BASIS, INVOICE_LEGAL_BASIS, eraseAccountRows, scrubAuditByAddress } from './erase.js';
import { collectAccountExport, type AccountExport } from './export.js';
import { newRequestId, type ErasureLedger, type LedgerRecordInput, type LedgerRequestType, type LedgerScope, type SystemOutcome } from './ledger.js';
import { issueToken, normaliseEmail, subjectKey, tokenHash, userKey, verifyToken } from './subject.js';
import type { Selectable } from 'kysely';

/*
 * Data-subject rights (docs/gdpr.md). Three rules run through this file:
 *
 * - Nothing is reported done before the ledger holds the evidence. A request whose ledger
 *   write fails stays open; the sweep retries it and then tells the person by mail.
 * - Every step of an erasure is idempotent and its progress is committed, so a crash or an
 *   outage in Keycloak, Stripe or the cluster resumes where it stopped.
 * - Public answers are the same for every address. Only the holder of the mailbox learns
 *   what, if anything, was held.
 */

export interface GdprDeps {
  db: Db;
  ledger: ErasureLedger;
  /** CT_GDPR_HMAC_KEY */
  hmacKey: string;
  /** CT_GDPR_HMAC_KEY_PREVIOUS: keys being rotated out (docs/gdpr.md). New records never use them; matching does. */
  previousHmacKeys?: string[];
  /** Seals the address on an open request. */
  sealer: Sealer;
  mailer: Mailer;
  /** Links in mails: where /legal/privacy-request is served. */
  webUrl: string;
  /** Behind an interface: the waitlist may move off Postgres. */
  waitlist: WaitlistStore;
  brand?: string;
  /** Account erasure needs these; a public-only deployment (site VM) has none. */
  cluster?: LabCluster;
  exams?: Pick<ExamCluster, 'deleteExamSession'>;
  kc?: Pick<KeycloakAdmin, 'deleteUser' | 'logoutUser' | 'setUserEnabled' | 'getUser'> | null;
  stripe?: { customers: { del(id: string): Promise<unknown> } };
  billing?: { meterEnd(orgId: string, sessionName: string): Promise<void>; flushOutbox(): Promise<unknown> };
  store?: Pick<SessionStore, 'revokeUser'>;
  log?: { info(o: object, m: string): void; warn(o: object, m: string): void };
  now?: () => Date;
  /** Confirmation links expire after this (default 24 hours). */
  tokenTtlMs?: number;
  /** Days from closure to deletion (default 90); 0: closed accounts stay until someone asks. */
  closureDays?: number;
  /** CT_GDPR_CONTACT: the inbox objections and restrictions go to. */
  contact?: string;
  /** Where a person with a local account corrects their name and address (Keycloak's account console). */
  identityAccountUrl?: string;
  /** How recent a real sign-in must be for download, deletion and closure (default 15 minutes). */
  recentSignInMs?: number;
  /** Open confirmation requests one subject may have per hour; beyond it nothing is sent, the answer is the same (default 3). */
  perSubjectPerHour?: number;
}

type RequestRow = Selectable<GdprRequestsTable>;
const LEASE_MS = 5 * 60_000;
const RECENT_SIGN_IN_MS = 15 * 60_000;
const DAY = 86_400_000;
const ORG_ADMIN_LOCK = 7_316_002;
const STOPPED_SUBSCRIPTIONS = ['canceled', 'incomplete_expired'];

/** A request that cannot finish yet; the person is told it is still open. */
class StepError extends Error {
  constructor(
    public readonly step: string,
    public readonly status?: number,
  ) {
    super(`gdpr step ${step} did not finish`);
  }
}

const statusOf = (e: unknown): number | undefined => (e as { status?: number; statusCode?: number }).status ?? (e as { statusCode?: number }).statusCode;

/** What rests on legitimate interest (docs/gdpr.md): what someone can object to. */
export const OBJECTABLE: { value: ObjectionProcessing; label: string }[] = [
  { value: 'security_log', label: 'The security and audit log of my activity' },
  { value: 'progress_reporting', label: 'Reports of my progress to managers and instructors' },
  { value: 'observation', label: 'Instructors observing my lab terminal' },
  { value: 'other', label: 'Something else' },
];

const RETAINED_NOTICE = [
  { category: 'invoices', explanation: 'Invoices stay with our payment provider Stripe for as long as tax and accounting law requires. They hold the billing name and address on the invoice.' },
  { category: 'usage', explanation: 'Usage behind issued invoices stays without your name or any link to you.' },
  { category: 'audit', explanation: "Your organisation's security log keeps what happened, with your name, email address and IP address removed." },
  { category: 'backups', explanation: 'Database backups expire within 14 days. If one is ever restored, your erasure is applied again.' },
];

export class GdprService {
  private readonly mails = new Set<Promise<unknown>>();
  constructor(private readonly d: GdprDeps) {}

  private now() {
    return this.d.now?.() ?? new Date();
  }
  private get brand() {
    return this.d.brand ?? 'CloudTrain';
  }
  private get allKeys(): string[] {
    return [this.d.hmacKey, ...(this.d.previousHmacKeys ?? [])];
  }
  private keysFor(email: string, userId?: string) {
    return { subject_key: subjectKey(email, this.d.hmacKey), user_key: userId ? userKey(userId, this.d.hmacKey) : null };
  }

  /* ------------------------------------------------- public: request link */

  /** Always resolves the same way, whether the address is known or not. The mail goes in the background: its timing says nothing. */
  async requestPublic(email: string, type: PublicPrivacyRequestType): Promise<void> {
    const now = this.now();
    const clean = normaliseEmail(email);
    const keys = this.keysFor(clean);
    const expiresAt = new Date(now.getTime() + (this.d.tokenTtlMs ?? DAY));
    const id = randomUUID();
    const token = issueToken(id, expiresAt, this.d.hmacKey);
    const inserted = await withTenant(this.d.db, { platform: true }, async (tx) => {
      const recent = await tx
        .selectFrom('gdpr_requests')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('subject_key', '=', keys.subject_key)
        .where('requested_at', '>', new Date(now.getTime() - 3_600_000))
        .executeTakeFirstOrThrow();
      if (Number(recent.n) >= (this.d.perSubjectPerHour ?? 3)) return false;
      await tx
        .insertInto('gdpr_requests')
        .values({ id, type, scope: 'waitlist', ...keys, token_hash: tokenHash(token), email_sealed: this.d.sealer.seal(clean), status: 'awaiting_confirmation', requested_at: now, expires_at: expiresAt, state: JSON.stringify({}), verified_at: null, completed_at: null, lease_until: null, user_id: null, last_error: null, ledger_seq: null })
        .execute();
      return true;
    });
    if (!inserted) return;
    const link = `${this.d.webUrl}/legal/privacy-request#token=${encodeURIComponent(token)}`;
    const what = type === 'export' ? 'send you a copy of the waitlist data we hold under this address' : type === 'withdrawal' ? 'withdraw your consent, which removes your waitlist entry' : 'erase your waitlist entry';
    this.background(
      this.d.mailer.send({
        to: clean,
        subject: `Confirm your ${this.brand} privacy request`,
        text: `Someone asked us to ${what}.\n\nIf that was you, open this link and confirm. It works once and expires on ${expiresAt.toUTCString()}:\n\n${link}\n\nIf it was not you, ignore this email and nothing happens.\n`,
      }),
    );
  }

  private background(p: Promise<unknown>) {
    const tracked = p
      .catch((e: unknown) => this.d.log?.warn({ status: statusOf(e) }, 'gdpr: a mail could not be sent'))
      .finally(() => {
        this.mails.delete(tracked);
      });
    this.mails.add(tracked);
  }

  /** Mails still on their way (tests, shutdown). */
  async settled(): Promise<void> {
    await Promise.all([...this.mails]);
  }

  /* ------------------------------------------------- public: confirm link */

  private invalidLink() {
    return new HttpError(410, 'This link is invalid, has expired or was already used. You can send a new request.', { code: 'invalid' });
  }

  /** Performs the confirmed request. One answer for invalid, expired and used links. */
  async confirmPublic(token: unknown): Promise<{ pending: boolean; body: PrivacyConfirmResponse }> {
    const now = this.now();
    // A link mailed just before a rotation still works until it expires.
    if (!this.allKeys.some((k) => verifyToken(token, now.getTime(), k))) throw this.invalidLink();
    const hash = tokenHash(token as string);
    // The atomic claim is what makes the link single-use, under concurrent clicks too.
    const row = await withTenant(this.d.db, { platform: true }, (tx) =>
      tx.updateTable('gdpr_requests').set({ status: 'processing', verified_at: now }).where('token_hash', '=', hash).where('status', '=', 'awaiting_confirmation').where('expires_at', '>', now).returningAll().executeTakeFirst(),
    );
    if (!row) throw this.invalidLink();
    if (row.type === 'export') return { pending: false, body: await this.publicExport(row) };
    const status = await this.process(row.id);
    if (status !== 'completed') {
      await this.setNotify(row.id);
      return { pending: true, body: { status: 'pending', type: row.type as PublicPrivacyRequestType } };
    }
    const rows = await this.lastOutcomeRows(row.id);
    return { pending: false, body: { status: 'completed', type: row.type as PublicPrivacyRequestType, removed: rows } };
  }

  private async publicExport(row: RequestRow): Promise<PrivacyConfirmResponse> {
    const email = row.email_sealed ? this.d.sealer.open(row.email_sealed) : null;
    if (!email) throw this.invalidLink();
    const entry = await this.d.waitlist.find(email);
    const outcomes: SystemOutcome[] = [{ system: 'waitlist', category: 'waitlist', action: entry ? 'exported' : 'none', rows: entry ? 1 : 0 }];
    try {
      await this.appendLedger(row, { type: 'export', scope: 'waitlist', outcomes, categories: ['waitlist'] }, row.verified_at ?? this.now());
    } catch {
      // No evidence, no data. The same link can be used again once the ledger is back.
      await withTenant(this.d.db, { platform: true }, (tx) => tx.updateTable('gdpr_requests').set({ status: 'awaiting_confirmation', last_error: 'ledger_unavailable' }).where('id', '=', row.id).execute());
      throw new HttpError(503, 'We could not complete this just now. Please open the link again in a few minutes.', { code: 'upstream' });
    }
    await this.close(row.id);
    return { status: 'completed', type: 'export', removed: 0, data: { waitlist: entry ? [{ email: entry.email, organisation: entry.organisation, role: entry.role, interest: entry.interest, consentAt: entry.consentAt, createdAt: entry.createdAt }] : [] } };
  }

  private async lastOutcomeRows(id: string): Promise<number> {
    const r = await this.d.ledger.entries();
    const e = r.find((x) => x.requestId === id);
    return (e?.outcomes ?? []).filter((o) => o.action === 'deleted').reduce((n, o) => n + o.rows, 0);
  }

  private get contact() {
    return this.d.contact ?? 'gdpr@cloudtrain.app';
  }

  private async setNotify(id: string) {
    await withTenant(this.d.db, { platform: true }, (tx) => tx.updateTable('gdpr_requests').set({ state: sql`state || '{"notify":true}'::jsonb` }).where('id', '=', id).where('status', '<>', 'completed').execute());
  }

  /* ------------------------------------------------------------ signed in */

  private async blockersIn(tx: Tx, p: { sub: string; platformAdmin: boolean }): Promise<PrivacyBlocker[]> {
    const out: PrivacyBlocker[] = [];
    const orgs = await sql<{ name: string }>`
      SELECT o.name FROM memberships m JOIN orgs o ON o.id = m.org_id
      WHERE m.user_id = ${p.sub} AND m.status = 'active' AND 'org_admin' = ANY (m.roles)
        AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.org_id = m.org_id AND x.user_id <> m.user_id AND x.status = 'active' AND 'org_admin' = ANY (x.roles))
      ORDER BY o.name`.execute(tx);
    if (orgs.rows.length) {
      const names = orgs.rows.map((o) => o.name);
      out.push({ code: 'sole_org_admin', message: `You are the only administrator of ${names.join(', ')}. Make another member an administrator first, or ask us to close the organisation.`, orgs: names });
    }
    if (p.platformAdmin) {
      const others = await tx.selectFrom('users').select((eb) => eb.fn.countAll<number>().as('n')).where(sql<boolean>`'platform_admin' = ANY (platform_roles)`).where('id', '<>', p.sub).executeTakeFirstOrThrow();
      if (Number(others.n) === 0) out.push({ code: 'last_platform_admin', message: 'You are the last platform administrator. Appoint another one first.' });
    }
    const customers = await tx.selectFrom('billing_customers').select(['id', 'stripe_customer_id', 'delinquent_since', 'invoice_failed_at']).where('user_id', '=', p.sub).execute();
    if (customers.length) {
      if (!this.d.stripe) out.push({ code: 'billing_unavailable', message: 'Your billing account cannot be closed on this deployment right now. Please contact us.' });
      const subs = await tx.selectFrom('billing_subscriptions').select(['kind', 'status', 'current_period_end', 'plan_id']).where('user_id', '=', p.sub).where('status', 'not in', STOPPED_SUBSCRIPTIONS).execute();
      if (subs.some((s) => s.kind === 'plan')) out.push({ code: 'subscription', message: 'You have a running subscription. Cancel it under Plan and billing; you can delete your account once it has ended.' });
      if (customers.some((c) => c.delinquent_since || c.invoice_failed_at)) out.push({ code: 'open_balance', message: 'A payment is still open. Settle it under Plan and billing first.' });
      const compute = subs.find((s) => s.kind === 'compute');
      const since = compute?.current_period_end ? new Date(compute.current_period_end.getTime() - 31 * DAY) : new Date(this.now().getTime() - 31 * DAY);
      const unbilled = await tx
        .selectFrom('billing_usage')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('payer_key', '=', p.sub)
        .where('billable', '=', true)
        .where((eb) => eb.or([eb('ended_at', 'is', null), eb('ended_at', '>', since)]))
        .executeTakeFirstOrThrow();
      if (Number(unbilled.n) > 0) {
        const when = compute?.current_period_end ? ` on ${compute.current_period_end.toISOString().slice(0, 10)}` : ' at the end of the billing period';
        out.push({ code: 'unbilled_usage', message: `Compute you used has not been invoiced yet. It is billed${when}; you can delete your account after that.` });
      }
    }
    return out;
  }

  private configBlockers(p: Principal): PrivacyBlocker[] {
    if (p.session?.impersonated) return [{ code: 'impersonated', message: 'A support or development session cannot do this. The person must sign in themselves.' }];
    if (!this.d.kc && !p.sub.startsWith('pending-')) return [{ code: 'identity_unavailable', message: 'Account deletion is not available on this deployment right now. Please contact us.' }];
    return [];
  }

  async summary(p: Principal): Promise<AccountPrivacySummary> {
    const blockers = [...this.configBlockers(p), ...(await withTenant(this.d.db, { platform: true, userId: p.sub }, (tx) => this.blockersIn(tx, p)))];
    const state = await withTenant(this.d.db, { platform: true, userId: p.sub }, (tx) => tx.selectFrom('users').select(['restricted_at', 'name']).where('id', '=', p.sub).executeTakeFirst());
    const local = !p.session?.idp || p.session.idp === 'local';
    return {
      email: p.email,
      name: state?.name ?? p.name,
      recentSignIn: this.signedInRecently(p),
      waitlistEntry: !!(await this.d.waitlist.find(p.email)),
      blockers,
      retained: RETAINED_NOTICE,
      restrictedAt: state?.restricted_at?.toISOString() ?? null,
      rectification: local ? { managedBy: 'identity_account', ...(this.d.identityAccountUrl ? { url: this.d.identityAccountUrl } : {}) } : { managedBy: 'organisation', ...(p.orgName ? { organisation: p.orgName } : {}) },
      contact: this.contact,
      closureDays: this.closureDays,
    };
  }

  /**
   * A stolen or forgotten session must not be enough to take or destroy someone's data. Sessions
   * without a server-side record exist only in tests and dev (DevAuthenticator refuses production).
   */
  private signedInRecently(p: Principal): boolean {
    if (!p.session) return true;
    const at = p.session.authenticatedAt ? Date.parse(p.session.authenticatedAt) : NaN;
    return !Number.isNaN(at) && this.now().getTime() - at <= (this.d.recentSignInMs ?? RECENT_SIGN_IN_MS);
  }

  private assertRecentSignIn(p: Principal) {
    if (!this.signedInRecently(p)) throw new HttpError(403, 'Please sign in again to continue. We ask for this before a download or a deletion.', { code: 'reauth_required' });
  }

  /** The evidence goes first: no record, no download. */
  async exportAccount(p: Principal): Promise<AccountExport> {
    if (p.session?.impersonated) throw new HttpError(403, 'A support or development session cannot download personal data.', { code: 'forbidden' });
    this.assertRecentSignIn(p);
    const now = this.now();
    const { data, outcomes } = await withTenant(this.d.db, { platform: true, userId: p.sub }, (tx) => collectAccountExport(tx, p.sub, p.email, now));
    const entry = await this.d.waitlist.find(p.email);
    data.sections.waitlist = entry ? [{ email: entry.email, organisation: entry.organisation, role: entry.role, interest: entry.interest, consentAt: entry.consentAt, createdAt: entry.createdAt }] : [];
    outcomes.push({ system: 'waitlist', category: 'waitlist', action: entry ? 'exported' : 'none', rows: entry ? 1 : 0 });
    if (this.d.kc && !p.sub.startsWith('pending-')) {
      try {
        const u = await this.d.kc.getUser(p.sub);
        data.sections.identityProvider = u ? [{ username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName, emailVerified: u.emailVerified, attributes: u.attributes }] : [];
        outcomes.push({ system: 'keycloak', category: 'identity', action: u ? 'exported' : 'none', rows: u ? 1 : 0 });
      } catch (e) {
        this.d.log?.warn({ status: statusOf(e) }, 'gdpr: identity provider not reachable for an export');
        throw new HttpError(503, 'Your identity provider data could not be read just now, so the download would be incomplete. Please try again in a few minutes.', { code: 'upstream' });
      }
    }
    const requestId = newRequestId();
    try {
      await this.d.ledger.append(this.record({ requestId, type: 'export', scope: 'account', ...this.keyFields(p.email, p.sub), outcomes, categories: ['account'], requestedAt: now, verifiedAt: now, actor: 'self' }));
    } catch (e) {
      this.d.log?.warn({ status: statusOf(e), requestId }, 'gdpr: ledger write failed');
      throw new HttpError(503, 'We could not record this request just now, so the download was not started. Please try again in a few minutes.', { code: 'upstream' });
    }
    return data;
  }

  /**
   * Art. 18. Applied at once and in full by the app (docs/gdpr.md says exactly what it stops), then
   * told to the inbox, since a person handles what the app cannot see. No evidence, no restriction.
   */
  async setRestriction(p: Principal, on: boolean): Promise<AccountRestrictionResponse> {
    if (p.session?.impersonated) throw new HttpError(403, 'A support or development session cannot do this.', { code: 'forbidden' });
    const now = this.now();
    if (on) {
      const running = await withTenant(this.d.db, { platform: true, userId: p.sub }, (tx) => tx.selectFrom('exam_attempts').select('id').where('user_id', '=', p.sub).where('phase', 'in', ['preparing', 'in-progress', 'grading']).executeTakeFirst());
      if (running) throw conflict('You have an exam running. Finish it first, or ask your organisation to void it, then restrict processing.');
    }
    const previous = await withTenant(this.d.db, { platform: true, userId: p.sub }, async (tx) => {
      const u = await tx.selectFrom('users').select('restricted_at').where('id', '=', p.sub).executeTakeFirstOrThrow();
      await tx.updateTable('users').set({ restricted_at: on ? (u.restricted_at ?? now) : null }).where('id', '=', p.sub).execute();
      return u.restricted_at;
    });
    if (!!previous === on) return { restrictedAt: previous?.toISOString() ?? null, endedLabs: 0 };
    try {
      await this.d.ledger.append(this.record({ requestId: newRequestId(), type: 'restriction', scope: 'account', ...this.keyFields(p.email, p.sub), outcomes: [{ system: 'postgres.users', category: 'processing', action: on ? 'restricted' : 'lifted', rows: 1 }], categories: ['processing'], requestedAt: now, verifiedAt: now, actor: 'self', reason: on ? 'restriction-applied' : 'restriction-lifted' }));
    } catch (e) {
      await withTenant(this.d.db, { platform: true, userId: p.sub }, (tx) => tx.updateTable('users').set({ restricted_at: previous }).where('id', '=', p.sub).execute());
      this.d.log?.warn({ status: statusOf(e) }, 'gdpr: ledger write failed; the restriction was not changed');
      throw new HttpError(503, 'We could not record this just now, so nothing changed. Please try again in a few minutes.', { code: 'upstream' });
    }
    let endedLabs = 0;
    if (on && this.d.cluster) {
      try {
        for (const ls of (await this.d.cluster.listSessions(`${LABEL_LEARNER}=${labelValue(p.sub)}`)).filter((s) => s.spec.learner.id === p.sub)) {
          await this.d.cluster.deleteSession(ls.metadata.name);
          await this.d.billing?.meterEnd(ls.spec.learner.org ?? '', ls.metadata.name).catch(() => undefined);
          endedLabs++;
        }
      } catch (e) {
        this.d.log?.warn({ status: statusOf(e) }, 'gdpr: a running lab could not be ended for a restriction');
      }
    }
    this.background(this.d.mailer.send({ to: this.contact, subject: on ? 'Processing restricted by a user (Art. 18)' : 'Restriction lifted by a user (Art. 18)', text: `${p.email} has ${on ? 'restricted processing of' : 'lifted the restriction on'} their account in the app.\n\nThe app has applied this (docs/gdpr.md). Check whether anything outside the app needs the same, and answer the person within a month. Their organisation: ${p.orgName || 'none'}.\n` }));
    return { restrictedAt: on ? now.toISOString() : null, endedLabs };
  }

  /**
   * Art. 21. An objection needs a person to weigh it, so this raises it: the inbox first, because a
   * request nobody received helps no one, then the record. The note goes only to the inbox: it is free text.
   */
  async object(p: Principal, body: { processing?: unknown; note?: unknown } | undefined): Promise<ObjectionResponse> {
    if (p.session?.impersonated) throw new HttpError(403, 'A support or development session cannot do this.', { code: 'forbidden' });
    const processing = OBJECTABLE.find((o) => o.value === body?.processing);
    if (!processing) throw badRequest('Choose what you object to', { fields: { processing: 'Choose what you object to' } });
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : '';
    const now = this.now();
    const requestId = newRequestId();
    try {
      await this.d.mailer.send({ to: this.contact, subject: `Objection to processing (Art. 21): ${processing.label}`, text: `From: ${p.name} <${p.email}>\nOrganisation: ${p.orgName || 'none'}\nReference: ${requestId}\nObjects to: ${processing.label}\n\n${note || '(no reason given)'}\n\nAnswer within a month. The ledger records only that this was raised.\n` });
    } catch (e) {
      this.d.log?.warn({ status: statusOf(e), requestId }, 'gdpr: an objection could not be delivered');
      throw new HttpError(503, `We could not send this just now. Please try again in a few minutes, or write to ${this.contact}.`, { code: 'upstream' });
    }
    try {
      await this.d.ledger.append(this.record({ requestId, type: 'objection', scope: 'account', ...this.keyFields(p.email, p.sub), outcomes: [{ system: 'gdpr-inbox', category: processing.value, action: 'requested', rows: 1 }], categories: [processing.value], requestedAt: now, verifiedAt: now, actor: 'self', reason: 'objection-raised' }));
    } catch (e) {
      this.d.log?.warn({ status: statusOf(e), requestId }, 'gdpr: ledger write failed for an objection that was delivered');
      throw new HttpError(503, 'Your objection reached us, but we could not record it. We will still answer it.', { code: 'upstream' });
    }
    this.background(this.d.mailer.send({ to: p.email, subject: `We received your objection (${requestId.slice(0, 8)})`, text: `We received your objection to: ${processing.label}.\n\nWe will answer within a month. Until then, nothing changes automatically.\n` }));
    return { status: 'raised', requestId, contact: this.contact };
  }

  /** The first-sign-in notice was shown. It records that it was shown, nothing more: it is not a consent. */
  async acknowledgeNotice(p: Principal, version: unknown): Promise<void> {
    if (typeof version !== 'string' || version.length > 32) throw badRequest('version is required', { version: 'required' });
    if (p.session?.impersonated) return;
    await withTenant(this.d.db, { platform: true, userId: p.sub }, (tx) => tx.updateTable('users').set({ privacy_notice_version: version, privacy_notice_at: this.now() }).where('id', '=', p.sub).execute());
  }

  /** Withdrawal: consent is the only basis of a waitlist entry, so withdrawing removes it. */
  async withdrawConsent(p: Principal): Promise<{ status: 'completed' | 'pending'; removed: number }> {
    if (p.session?.impersonated) throw new HttpError(403, 'A support or development session cannot do this.', { code: 'forbidden' });
    const now = this.now();
    const id = randomUUID();
    await withTenant(this.d.db, { platform: true }, (tx) =>
      tx
        .insertInto('gdpr_requests')
        .values({ id, type: 'withdrawal', scope: 'waitlist', ...this.keysFor(p.email, p.sub), token_hash: null, email_sealed: this.d.sealer.seal(normaliseEmail(p.email)), status: 'processing', requested_at: now, verified_at: now, expires_at: null, state: JSON.stringify({}), completed_at: null, lease_until: null, user_id: null, last_error: null, ledger_seq: null })
        .execute(),
    );
    const status = await this.process(id);
    if (status !== 'completed') {
      await this.setNotify(id);
      return { status: 'pending', removed: 0 };
    }
    return { status: 'completed', removed: await this.lastOutcomeRows(id) };
  }

  /**
   * Starts erasure of one person. The checks and the start are one transaction under one lock:
   * two admins of an org deleting themselves at once cannot both pass "another admin remains".
   */
  private async startErasure(s: { sub: string; email: string; platformAdmin: boolean }, o: { actor: 'self' | 'admin'; reason?: string; notify?: boolean }): Promise<{ id?: string; blockers?: PrivacyBlocker[] }> {
    const now = this.now();
    const started = await withTenant(this.d.db, { platform: true, userId: s.sub }, async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${ORG_ADMIN_LOCK})`.execute(tx);
      const open = await tx.selectFrom('gdpr_requests').select('id').where('user_id', '=', s.sub).where('scope', '=', 'account').where('status', '<>', 'completed').executeTakeFirst();
      if (open) return { id: open.id };
      const blockers = await this.blockersIn(tx, s);
      if (blockers.length) return { blockers };
      const customers = await tx.selectFrom('billing_customers').select('stripe_customer_id').where('user_id', '=', s.sub).execute();
      const orgs = await tx.selectFrom('memberships').select('org_id').where('user_id', '=', s.sub).execute();
      const id = randomUUID();
      const state: GdprRequestStateJson = { steps: {}, outcomes: [], stripeCustomerIds: customers.map((c) => c.stripe_customer_id), ...(o.reason ? { reason: o.reason } : {}), ...(o.notify ? { notify: true } : {}) };
      await tx
        .insertInto('gdpr_requests')
        .values({ id, type: 'erasure', scope: 'account', actor: o.actor, ...this.keysFor(s.email, s.sub), token_hash: null, email_sealed: this.d.sealer.seal(normaliseEmail(s.email)), user_id: s.sub, status: 'processing', requested_at: now, verified_at: now, expires_at: null, state: JSON.stringify(state), completed_at: null, lease_until: null, last_error: null, ledger_seq: null })
        .execute();
      // From here the person has no access, and no longer counts as the org's other admin.
      await tx.updateTable('memberships').set({ status: 'deactivated', updated_at: now }).where('user_id', '=', s.sub).execute();
      for (const org of orgs) await sql`INSERT INTO audit_log (org_id, actor_name, action, target_type, target_id, details) VALUES (${org.org_id}, 'System', 'gdpr.erasure', 'user', '[erased]', ${JSON.stringify({ requestId: id })}::jsonb)`.execute(tx);
      return { id };
    });
    if (started.id) await this.d.store?.revokeUser(s.sub);
    return started;
  }

  private assertConfirmed(typed: unknown, email: string) {
    if (typeof typed !== 'string' || normaliseEmail(typed) !== normaliseEmail(email)) throw badRequest('Type the email address to confirm', { fields: { confirmEmail: 'Type the email address to confirm' } });
  }

  private blocked(blockers: PrivacyBlocker[]) {
    return new HttpError(409, blockers[0]!.message, { code: 'conflict', details: { blockers } });
  }

  /** Erases the signed-in person now. */
  async deleteAccount(p: Principal, confirmEmail: unknown): Promise<AccountDeleteResponse> {
    if (!p.session?.impersonated) this.assertRecentSignIn(p);
    this.assertConfirmed(confirmEmail, p.email);
    const config = this.configBlockers(p);
    if (config.length) throw this.blocked(config);
    const started = await this.startErasure({ sub: p.sub, email: p.email, platformAdmin: p.platformAdmin }, { actor: 'self' });
    if (started.blockers) throw this.blocked(started.blockers);
    return this.runErasure(started.id!);
  }

  private async runErasure(id: string): Promise<AccountDeleteResponse> {
    const status = await this.process(id);
    if (status !== 'completed') {
      await this.setNotify(id);
      return { status: 'pending', requestId: id, retained: RETAINED_NOTICE };
    }
    return { status: 'completed', requestId: id, retained: RETAINED_NOTICE };
  }

  /* -------------------------------------------------------------- closure */

  private get closureDays() {
    return this.d.closureDays ?? 90;
  }

  /**
   * Closure: access ends now, erasure follows after the grace period, and until then a platform admin can
   * reopen the account on request. The same blockers as deletion, because deletion is where this ends.
   */
  async closeAccount(p: Principal, confirmEmail: unknown): Promise<AccountCloseResponse> {
    if (p.session?.impersonated) throw new HttpError(403, 'A support or development session cannot do this.', { code: 'forbidden' });
    this.assertRecentSignIn(p);
    this.assertConfirmed(confirmEmail, p.email);
    const config = this.configBlockers(p);
    if (config.length) throw this.blocked(config);
    const now = this.now();
    const blockers = await withTenant(this.d.db, { platform: true, userId: p.sub }, async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${ORG_ADMIN_LOCK})`.execute(tx);
      const found = await this.blockersIn(tx, p);
      if (found.length) return found;
      const active = await tx.selectFrom('memberships').select('org_id').where('user_id', '=', p.sub).where('status', '=', 'active').execute();
      await tx.updateTable('users').set({ closed_at: now, closed_orgs: active.map((m) => m.org_id) }).where('id', '=', p.sub).execute();
      await tx.updateTable('memberships').set({ status: 'deactivated', updated_at: now }).where('user_id', '=', p.sub).execute();
      return [];
    });
    if (blockers.length) throw this.blocked(blockers);
    await this.d.store?.revokeUser(p.sub);
    try {
      if (this.d.kc && !p.sub.startsWith('pending-')) {
        await this.d.kc.logoutUser(p.sub);
        await this.d.kc.setUserEnabled(p.sub, false);
      }
      if (this.d.cluster) {
        for (const ls of (await this.d.cluster.listSessions(`${LABEL_LEARNER}=${labelValue(p.sub)}`)).filter((s) => s.spec.learner.id === p.sub)) {
          await this.d.cluster.deleteSession(ls.metadata.name);
          await this.d.billing?.meterEnd(ls.spec.learner.org ?? '', ls.metadata.name).catch(() => undefined);
        }
      }
    } catch (e) {
      // The gateway refuses a closed account by itself; these only tidy up.
      this.d.log?.warn({ status: statusOf(e) }, 'gdpr: tidying up after a closure did not finish');
    }
    const deleteAfter = this.closureDays ? new Date(now.getTime() + this.closureDays * DAY).toISOString() : null;
    this.background(this.d.mailer.send({ to: p.email, subject: `Your ${this.brand} account is closed`, text: `Your account is closed and you can no longer sign in.\n\n${deleteAfter ? `We will delete your data on or after ${deleteAfter.slice(0, 10)}.` : 'Its data stays until you ask us to delete it.'} Changed your mind? Write to ${this.contact} before then and we can reopen it.\n` }));
    return { status: 'closed', deleteAfter };
  }

  private async userByEmail(email: unknown) {
    if (typeof email !== 'string' || !email.trim()) throw badRequest('Enter the email address', { fields: { email: 'Enter the email address' } });
    const u = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('users').select(['id', 'email', 'platform_roles', 'closed_at', 'closed_orgs']).where(sql`lower(email)`, '=', normaliseEmail(email)).executeTakeFirst());
    if (!u) throw notFound('User');
    return u;
  }

  /** Platform admin, on the person's request: gives back what the closure took. */
  async reopenAccount(admin: Principal, email: unknown): Promise<{ status: 'reopened' }> {
    authorize(admin, 'org.manage', { kind: 'platform' });
    if (admin.session?.impersonated) throw new HttpError(403, 'A support or development session cannot do this.', { code: 'forbidden' });
    const u = await this.userByEmail(email);
    if (!u.closed_at) throw conflict('This account is not closed.');
    const now = this.now();
    await withTenant(this.d.db, { platform: true }, async (tx) => {
      if (u.closed_orgs.length) await tx.updateTable('memberships').set({ status: 'active', updated_at: now }).where('user_id', '=', u.id).where('org_id', 'in', u.closed_orgs).execute();
      await tx.updateTable('users').set({ closed_at: null, closed_orgs: [] }).where('id', '=', u.id).execute();
    });
    if (this.d.kc && !u.id.startsWith('pending-')) await this.d.kc.setUserEnabled(u.id, true);
    return { status: 'reopened' };
  }

  /* -------------------------------------------------- admin-initiated erasure */

  /**
   * Platform admin, for someone who cannot do it themselves: a deactivated user who wrote in. Only for
   * someone with no active membership: anyone else can erase themselves, and an admin must not be able to erase
   * a working user by mistake. The address is typed twice. Recorded as `actor: admin`.
   */
  async adminErase(admin: Principal, body: { email?: unknown; confirmEmail?: unknown } | undefined): Promise<AccountDeleteResponse> {
    authorize(admin, 'org.manage', { kind: 'platform' });
    if (admin.session?.impersonated) throw new HttpError(403, 'A support or development session cannot do this.', { code: 'forbidden' });
    this.assertRecentSignIn(admin);
    const u = await this.userByEmail(body?.email);
    this.assertConfirmed(body?.confirmEmail, u.email);
    if (u.id === admin.sub) throw conflict('Erase your own account under Privacy in your account.');
    if (!this.d.kc && !u.id.startsWith('pending-')) throw conflict('Account erasure is not available on this deployment: no identity provider admin is configured.');
    const active = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('memberships').select('org_id').where('user_id', '=', u.id).where('status', '=', 'active').execute());
    if (active.length) throw new HttpError(409, `This person still has ${active.length} active membership${active.length === 1 ? '' : 's'}. They can erase their account themselves; otherwise have each organisation deactivate them first.`, { code: 'conflict' });
    const started = await this.startErasure({ sub: u.id, email: u.email, platformAdmin: u.platform_roles.includes('platform_admin') }, { actor: 'admin', reason: 'admin-request', notify: true });
    if (started.blockers) throw this.blocked(started.blockers);
    return this.runErasure(started.id!);
  }

  /* ---------------------------------------------------- automatic deletion */

  /**
   * Closed accounts past their grace period, and accounts inactive past the limit after a warning.
   * Not touched: platform admins, restricted accounts (Art. 18 means keep the data), and
   * anyone a blocker holds (sole admin, billing still open), who are counted in `skipped`.
   */
  async sweepAccounts(cfg: { closedDays: number; inactiveMonths: number; warningDays: number }, limit = 100): Promise<{ closed: number | null; warned: number | null; inactive: number | null; skipped: number; failed: number }> {
    const now = this.now();
    const out = { closed: cfg.closedDays ? 0 : null, warned: cfg.inactiveMonths ? 0 : null, inactive: cfg.inactiveMonths ? 0 : null, skipped: 0, failed: 0 } as { closed: number | null; warned: number | null; inactive: number | null; skipped: number; failed: number };
    const open = sql<boolean>`NOT EXISTS (SELECT 1 FROM gdpr_requests r WHERE r.user_id = users.id AND r.status <> 'completed')`;
    const erase = async (u: { id: string; email: string; platform_roles: string[] }, o: { actor: 'self' | 'admin'; reason: string }) => {
      if (!this.d.kc && !u.id.startsWith('pending-')) return false;
      const started = await this.startErasure({ sub: u.id, email: u.email, platformAdmin: u.platform_roles.includes('platform_admin') }, { ...o, notify: true });
      if (started.blockers) return false;
      await this.process(started.id!);
      return true;
    };
    if (cfg.closedDays) {
      const cutoff = new Date(now.getTime() - cfg.closedDays * DAY);
      const rows = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('users').select(['id', 'email', 'platform_roles']).where('closed_at', '<', cutoff).where(open).limit(limit).execute());
      for (const u of rows) {
        if (await erase(u, { actor: 'self', reason: 'closure-period-ended' })) out.closed!++;
        else out.skipped++;
      }
    }
    if (cfg.inactiveMonths) {
      const cutoff = monthsBefore(now, cfg.inactiveMonths);
      const rows = await withTenant(this.d.db, { platform: true }, (tx) =>
        tx
          .selectFrom('users')
          .select(['id', 'email', 'platform_roles', 'inactivity_warned_at', 'closed_at'])
          .where(sql<boolean>`greatest(coalesce(last_login_at, created_at), created_at) < ${cutoff}`)
          .where('closed_at', 'is', null)
          .where('restricted_at', 'is', null)
          .where(sql<boolean>`NOT ('platform_admin' = ANY (platform_roles))`)
          .where(open)
          .limit(limit)
          .execute(),
      );
      for (const u of rows) {
        if (u.inactivity_warned_at) {
          if (u.inactivity_warned_at.getTime() >= now.getTime() - cfg.warningDays * DAY) continue;
          if (await erase(u, { actor: 'admin', reason: 'inactivity' })) out.inactive!++;
          else out.skipped++;
          continue;
        }
        const blockers = await withTenant(this.d.db, { platform: true }, (tx) => this.blockersIn(tx, { sub: u.id, platformAdmin: false }));
        if (blockers.length) {
          out.skipped++;
          continue;
        }
        const deadline = new Date(now.getTime() + cfg.warningDays * DAY).toISOString().slice(0, 10);
        try {
          await this.d.mailer.send({ to: u.email, subject: `Your ${this.brand} account will be deleted`, text: `You have not signed in for a long time, so we will delete your account and its data on or after ${deadline}.\n\nTo keep it, sign in before then. Nothing else is needed. Questions: ${this.contact}.\n` });
        } catch (e) {
          // No warning, no deletion: this one comes round again at the next sweep.
          this.d.log?.warn({ status: statusOf(e) }, 'gdpr: an inactivity warning could not be sent');
          out.failed++;
          continue;
        }
        await withTenant(this.d.db, { platform: true }, (tx) => tx.updateTable('users').set({ inactivity_warned_at: now }).where('id', '=', u.id).execute());
        out.warned!++;
      }
    }
    return out;
  }

  /* ----------------------------------------------------------- the worker */

  private keyFields(email: string, userId?: string) {
    return { subjectKey: subjectKey(email, this.d.hmacKey), ...(userId ? { userKey: userKey(userId, this.d.hmacKey) } : {}) };
  }

  private record(r: { requestId: string; type: LedgerRequestType; scope: LedgerScope; subjectKey: string; userKey?: string; outcomes: SystemOutcome[]; categories: string[]; requestedAt: Date; verifiedAt: Date; actor: 'self' | 'admin'; reason?: string }): LedgerRecordInput {
    return {
      requestId: r.requestId,
      type: r.type,
      scope: r.scope,
      subjectKey: r.subjectKey,
      ...(r.userKey ? { userKey: r.userKey } : {}),
      dataCategories: r.categories,
      outcomes: r.outcomes,
      requestedAt: r.requestedAt.toISOString(),
      verifiedAt: r.verifiedAt.toISOString(),
      completedAt: this.now().toISOString(),
      actor: r.actor,
      ...(r.reason ? { reason: r.reason } : {}),
    };
  }

  private async appendLedger(row: RequestRow, p: { type: LedgerRequestType; scope: LedgerScope; outcomes: SystemOutcome[]; categories: string[]; reason?: string }, verifiedAt: Date) {
    const entry = await this.d.ledger.append(
      this.record({ requestId: row.id, type: p.type, scope: p.scope, subjectKey: row.subject_key, ...(row.user_key ? { userKey: row.user_key } : {}), outcomes: p.outcomes, categories: p.categories, requestedAt: row.requested_at as Date, verifiedAt, actor: row.actor, ...(p.reason ? { reason: p.reason } : {}) }),
    );
    // Anchors the chain outside the store: no identifiers, only position and hash.
    this.d.log?.info({ seq: entry.seq, hash: entry.hash, type: entry.type }, 'gdpr ledger append');
    return entry;
  }

  private async close(id: string) {
    await withTenant(this.d.db, { platform: true }, (tx) => tx.updateTable('gdpr_requests').set({ status: 'completed', completed_at: this.now(), email_sealed: null, user_id: null, token_hash: null, state: JSON.stringify({}), lease_until: null, last_error: null }).where('id', '=', id).execute());
  }

  private async claim(id: string): Promise<RequestRow | undefined> {
    const now = this.now();
    return withTenant(this.d.db, { platform: true }, (tx) =>
      tx
        .updateTable('gdpr_requests')
        .set({ lease_until: new Date(now.getTime() + LEASE_MS), attempts: sql`attempts + 1` })
        .where('id', '=', id)
        .where('status', 'in', ['processing', 'evidence_pending'])
        .where((eb) => eb.or([eb('lease_until', 'is', null), eb('lease_until', '<', now)]))
        .returningAll()
        .executeTakeFirst(),
    );
  }

  private async saveState(id: string, state: GdprRequestStateJson, db: Db | Tx = this.d.db) {
    const run = (tx: Db | Tx) => tx.updateTable('gdpr_requests').set({ state: JSON.stringify(state) }).where('id', '=', id).execute();
    if (db !== this.d.db) await run(db);
    else await withTenant(this.d.db, { platform: true }, run);
  }

  /** Runs what is left of a request; 'pending' when something still has to happen. */
  async process(id: string): Promise<'completed' | 'pending'> {
    const row = await this.claim(id);
    if (!row) return 'pending';
    const state: GdprRequestStateJson = { steps: {}, outcomes: [], ...(row.state as GdprRequestStateJson) };
    const release = (patch: { status?: RequestRow['status']; last_error: string }) => withTenant(this.d.db, { platform: true }, (tx) => tx.updateTable('gdpr_requests').set({ lease_until: null, ...patch }).where('id', '=', id).execute());
    const email = row.email_sealed ? this.d.sealer.open(row.email_sealed) : null;
    try {
      if (row.status === 'processing') {
        if (row.scope === 'account') await this.eraseAccountSteps(row, state, email);
        else await this.eraseWaitlistSteps(row, state, email);
      }
    } catch (e) {
      const step = e instanceof StepError ? e.step : 'unknown';
      this.d.log?.warn({ requestId: id, step, status: e instanceof StepError ? e.status : statusOf(e) }, 'gdpr: a step did not finish; it will be retried');
      await release({ last_error: `${step}_failed` });
      return 'pending';
    }
    const outcomes = state.outcomes as SystemOutcome[];
    const categories = [...new Set(outcomes.filter((o) => o.rows > 0 || o.action === 'retained' || o.action === 'expires').map((o) => o.category))];
    try {
      const entry = await this.appendLedger(row, { type: row.type, scope: row.scope, outcomes, categories, ...(state.reason ? { reason: state.reason } : {}) }, (row.verified_at ?? row.requested_at) as Date);
      await withTenant(this.d.db, { platform: true }, (tx) => tx.updateTable('gdpr_requests').set({ ledger_seq: entry.seq }).where('id', '=', id).execute());
    } catch (e) {
      this.d.log?.warn({ requestId: id, status: statusOf(e) }, 'gdpr: ledger write failed; the request stays open');
      await release({ status: 'evidence_pending', last_error: 'ledger_unavailable' });
      return 'pending';
    }
    // The person was told it was still open: tell them now. Best effort, and the address goes either way.
    if (state.notify && email) this.background(this.d.mailer.send(this.doneMail(email, state.reason)));
    await this.close(id);
    return 'completed';
  }

  private doneMail(to: string, reason?: string) {
    const record = 'We kept a record of this that does not contain your email address.';
    if (reason === 'inactivity') return { to, subject: `Your ${this.brand} account has been deleted`, text: `As we warned you, your account has been deleted because it was not used for a long time. ${record}\n` };
    if (reason === 'closure-period-ended') return { to, subject: `Your ${this.brand} account has been deleted`, text: `The account you closed has now been deleted. ${record}\n` };
    if (reason === 'admin-request') return { to, subject: `Your ${this.brand} account has been deleted`, text: `Your account has been deleted as requested. ${record}\n` };
    return { to, subject: `Your ${this.brand} privacy request is complete`, text: `The request you confirmed has now been completed. ${record}\n` };
  }

  private async eraseWaitlistSteps(row: RequestRow, state: GdprRequestStateJson, email: string | null) {
    if (!email) throw new StepError('sealed_address');
    const steps = (state.steps ??= {});
    const outcomes = (state.outcomes ??= []);
    if (!steps.waitlist) {
      const rows = await this.d.waitlist.remove(email).catch((e: unknown) => {
        throw new StepError('waitlist', statusOf(e));
      });
      outcomes.push({ system: 'waitlist', category: 'waitlist', action: rows ? 'deleted' : 'none', rows });
      steps.waitlist = true;
      await this.saveState(row.id, state);
    }
    // Erasure, not just withdrawal, of an address without an account: its traces in the audit log (a refused login). An account holder erases through the account.
    if (!steps.data && row.type === 'erasure') {
      await withTenant(this.d.db, { platform: true }, async (tx) => {
        const account = await tx.selectFrom('users').select('id').where(sql`lower(email)`, '=', email).executeTakeFirst();
        if (!account) outcomes.push(await scrubAuditByAddress(tx, email));
        steps.data = true;
        await this.saveState(row.id, state, tx);
      });
    }
    if (!outcomes.some((o) => o.system === 'backups')) outcomes.push({ system: 'backups', category: 'backups', action: 'expires', rows: 0, legalBasis: BACKUP_LEGAL_BASIS });
  }

  private async eraseAccountSteps(row: RequestRow, state: GdprRequestStateJson, email: string | null) {
    const userId = row.user_id!;
    if (!email) throw new StepError('sealed_address');
    const steps = (state.steps ??= {});
    const outcomes = (state.outcomes ??= []);
    const customers = state.stripeCustomerIds ?? [];

    if (!steps.cluster) {
      try {
        let labs = 0;
        if (this.d.cluster) {
          const live = (await this.d.cluster.listSessions(`${LABEL_LEARNER}=${labelValue(userId)}`)).filter((ls) => ls.spec.learner.id === userId);
          for (const ls of live) {
            await this.d.cluster.deleteSession(ls.metadata.name);
            await this.d.billing?.meterEnd(ls.spec.learner.org ?? '', ls.metadata.name).catch(() => undefined);
            labs++;
          }
        }
        const attempts = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('exam_attempts').select('id').where('user_id', '=', userId).execute());
        for (const a of attempts) await this.d.exams?.deleteExamSession(a.id);
        outcomes.push({ system: 'cluster.lab_sessions', category: 'learning', action: labs ? 'deleted' : 'none', rows: labs });
        outcomes.push({ system: 'cluster.exam_sessions', category: 'exams', action: this.d.exams && attempts.length ? 'deleted' : 'none', rows: this.d.exams ? attempts.length : 0 });
      } catch (e) {
        throw new StepError('cluster', statusOf(e));
      }
      steps.cluster = true;
      await this.saveState(row.id, state);
    }

    if (!steps.keycloak) {
      try {
        let rows = 0;
        if (this.d.kc && !userId.startsWith('pending-')) {
          await this.d.kc.logoutUser(userId);
          rows = (await this.d.kc.deleteUser(userId)) ? 1 : 0;
        }
        outcomes.push({ system: 'keycloak', category: 'identity', action: rows ? 'deleted' : 'none', rows });
      } catch (e) {
        throw new StepError('keycloak', statusOf(e));
      }
      steps.keycloak = true;
      await this.saveState(row.id, state);
    }

    if (!steps.billing) {
      if (customers.length) {
        if (!this.d.stripe) throw new StepError('billing');
        try {
          await this.d.billing?.flushOutbox();
        } catch (e) {
          throw new StepError('billing', statusOf(e));
        }
        // Metering still on its way to Stripe would die with the customer: wait for it.
        const waiting = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('billing_meter_outbox').select((eb) => eb.fn.countAll<number>().as('n')).where('stripe_customer_id', 'in', customers).where('status', '=', 'pending').executeTakeFirstOrThrow());
        if (Number(waiting.n) > 0) throw new StepError('billing');
        let rows = 0;
        for (const c of customers) {
          try {
            await this.d.stripe.customers.del(c);
            rows++;
          } catch (e) {
            if (statusOf(e) !== 404) throw new StepError('billing', statusOf(e));
          }
        }
        outcomes.push({ system: 'stripe.customer', category: 'billing', action: rows ? 'deleted' : 'none', rows });
        outcomes.push({ system: 'stripe.invoices', category: 'invoices', action: 'retained', rows: 0, legalBasis: INVOICE_LEGAL_BASIS });
      }
      steps.billing = true;
      await this.saveState(row.id, state);
    }

    if (!steps.waitlist) {
      const rows = await this.d.waitlist.remove(email).catch((e: unknown) => {
        throw new StepError('waitlist', statusOf(e));
      });
      outcomes.push({ system: 'waitlist', category: 'waitlist', action: rows ? 'deleted' : 'none', rows });
      steps.waitlist = true;
      await this.saveState(row.id, state);
    }

    if (!steps.data) {
      try {
        // One transaction: the rows go and the progress is recorded together, or neither.
        await withTenant(this.d.db, { platform: true }, async (tx) => {
          const user = await tx.selectFrom('users').select(['email', 'name']).where('id', '=', userId).executeTakeFirst();
          if (user) outcomes.push(...(await eraseAccountRows(tx, { userId, email: user.email, name: user.name, stripeCustomerIds: customers })));
          steps.data = true;
          if (!outcomes.some((o) => o.system === 'backups')) outcomes.push({ system: 'backups', category: 'backups', action: 'expires', rows: 0, legalBasis: BACKUP_LEGAL_BASIS });
          await this.saveState(row.id, state, tx);
        });
      } catch (e) {
        // The outcomes of a rolled-back transaction must not survive in memory; the next attempt starts from what was saved.
        throw new StepError('data', statusOf(e));
      }
    }
  }

  /** Retries open requests; a crashed public export goes back to waiting for its link. */
  async sweep(limit = 20): Promise<{ completed: number; pending: number }> {
    const now = this.now();
    const rows = await withTenant(this.d.db, { platform: true }, async (tx) => {
      await tx.updateTable('gdpr_requests').set({ status: 'awaiting_confirmation' }).where('type', '=', 'export').where('status', '=', 'processing').where('expires_at', '>', now).execute();
      return tx
        .selectFrom('gdpr_requests')
        .select('id')
        .where('status', 'in', ['processing', 'evidence_pending'])
        .where('type', '<>', 'export')
        .where((eb) => eb.or([eb('lease_until', 'is', null), eb('lease_until', '<', now)]))
        .orderBy('requested_at')
        .limit(limit)
        .execute();
    });
    const out = { completed: 0, pending: 0 };
    for (const r of rows) (await this.process(r.id)) === 'completed' ? out.completed++ : out.pending++;
    return out;
  }

  /* --------------------------------------------------------------- admin */

  /** For an auditor or a request by mail: the ledger's records for one address, under every key still held. */
  async recordsFor(email: string): Promise<{ seq: number; type: string; scope: string; completedAt: string }[]> {
    const keys = new Set(this.allKeys.map((k) => subjectKey(email, k)));
    return (await this.d.ledger.entries()).filter((e) => keys.has(e.subjectKey)).map((e) => ({ seq: e.seq, type: e.type, scope: e.scope, completedAt: e.completedAt }));
  }

  /** Completed requests from the ledger: no subject keys, nothing that identifies anyone. */
  async ledgerView(admin: Principal, limit = 100): Promise<LedgerView> {
    authorize(admin, 'org.manage', { kind: 'platform' });
    const [entries, chain] = await Promise.all([this.d.ledger.entries(), this.d.ledger.verifyChain()]);
    const requests: LedgerRequestView[] = entries
      .slice(-limit)
      .reverse()
      .map((e) => ({ requestId: e.requestId, seq: e.seq, type: e.type, scope: e.scope, actor: e.actor, requestedAt: e.requestedAt, completedAt: e.completedAt, ...(e.reason ? { reason: e.reason } : {}), outcomes: e.outcomes.filter((o) => o.rows > 0 || o.action === 'retained').map((o) => ({ system: o.system, action: o.action, rows: o.rows })) }));
    return { requests, chain: { ok: chain.ok, count: chain.count, headSeq: chain.head.seq, headHash: chain.head.hash, problems: chain.problems.length } };
  }

  /* --------------------------------------------------- post-restore reapply */

  /**
   * After a restore: finds rows that reappeared for subjects the ledger says were erased, by
   * keyed hash (the ledger has no addresses), and erases them again within the scope that was
   * asked for. A row created after the erasure is left alone: that person came back of their own accord.
   */
  async reapply(opts: { dryRun?: boolean } = {}): Promise<{ waitlist: number; accounts: number; audit: number; records: number }> {
    const now = this.now();
    const newest = new Map<string, { scope: LedgerScope; type: LedgerRequestType; completedAt: number }[]>();
    for (const e of await this.d.ledger.entries()) {
      if (e.type !== 'erasure' && e.type !== 'withdrawal') continue;
      for (const k of [e.subjectKey, e.userKey]) {
        if (!k) continue;
        const list = newest.get(k) ?? [];
        list.push({ scope: e.scope, type: e.type, completedAt: Date.parse(e.completedAt) });
        newest.set(k, list);
      }
    }
    const erasedAfter = (keys: (string | null)[], createdAt: Date, scope?: LedgerScope) => keys.some((k) => k && (newest.get(k) ?? []).some((x) => x.completedAt > createdAt.getTime() && (!scope || x.scope === scope)));
    const result = { waitlist: 0, accounts: 0, audit: 0, records: 0 };
    const record = async (email: string, userId: string | null, outcomes: SystemOutcome[], tx: Tx) => {
      const id = randomUUID();
      const state: GdprRequestStateJson = { outcomes, reason: 'post-restore-reapply' };
      await tx
        .insertInto('gdpr_requests')
        .values({ id, type: 'erasure', scope: userId ? 'account' : 'waitlist', actor: 'admin', ...this.keysFor(email, userId ?? undefined), token_hash: null, email_sealed: null, user_id: null, status: 'evidence_pending', requested_at: now, verified_at: now, expires_at: null, state: JSON.stringify(state), completed_at: null, lease_until: null, last_error: null, ledger_seq: null })
        .execute();
      result.records++;
      return id;
    };
    const ids: string[] = [];

    const { entries } = await this.d.waitlist.list(1_000_000);
    for (const w of entries) {
      if (!erasedAfter(this.allKeys.map((k) => subjectKey(w.email, k)), new Date(w.createdAt))) continue;
      result.waitlist++;
      if (opts.dryRun) continue;
      const rows = await this.d.waitlist.remove(w.email);
      ids.push(await withTenant(this.d.db, { platform: true }, (tx) => record(w.email, null, [{ system: 'waitlist', category: 'waitlist', action: 'deleted', rows }], tx)));
    }

    const users = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('users').select(['id', 'email', 'name', 'created_at']).execute());
    for (const u of users) {
      if (!erasedAfter(this.allKeys.flatMap((k) => [subjectKey(u.email, k), userKey(u.id, k)]), u.created_at as Date, 'account')) continue;
      result.accounts++;
      if (opts.dryRun) continue;
      const outcomes: SystemOutcome[] = [];
      const customers = (await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('billing_customers').select('stripe_customer_id').where('user_id', '=', u.id).execute())).map((c) => c.stripe_customer_id);
      if (this.d.kc && !u.id.startsWith('pending-')) {
        const gone = await this.d.kc.deleteUser(u.id);
        outcomes.push({ system: 'keycloak', category: 'identity', action: gone ? 'deleted' : 'none', rows: gone ? 1 : 0 });
      }
      for (const c of customers) await this.d.stripe?.customers.del(c).catch((e: unknown) => { if (statusOf(e) !== 404) throw e; });
      ids.push(
        await withTenant(this.d.db, { platform: true }, async (tx) => {
          outcomes.push(...(await eraseAccountRows(tx, { userId: u.id, email: u.email, name: u.name, stripeCustomerIds: customers })));
          return record(u.email, u.id, outcomes, tx);
        }),
      );
    }

    // Audit rows naming an address that has no account (a refused login), brought back with the dump.
    const named = await withTenant(this.d.db, { platform: true }, (tx) => sql<{ email: string; at: Date }>`SELECT lower(x) AS email, min(at) AS at FROM (SELECT actor_name AS x, at FROM audit_log WHERE actor_name LIKE '%@%' UNION ALL SELECT target_label, at FROM audit_log WHERE target_label LIKE '%@%') s GROUP BY 1`.execute(tx));
    const accountAddresses = new Set((await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('users').select('email').execute())).map((u) => u.email.toLowerCase()));
    for (const row of named.rows) {
      // A withdrawal only ever touched the waitlist; a person with a live account erases through it.
      const asked = this.allKeys.flatMap((k) => newest.get(subjectKey(row.email, k)) ?? []);
      if (accountAddresses.has(row.email) || !asked.some((x) => x.type === 'erasure' && x.completedAt > row.at.getTime())) continue;
      result.audit++;
      if (opts.dryRun) continue;
      ids.push(
        await withTenant(this.d.db, { platform: true }, async (tx) => {
          const o = await scrubAuditByAddress(tx, row.email);
          return record(row.email, null, [o], tx);
        }),
      );
    }

    for (const id of ids) await this.process(id);
    return result;
  }
}
