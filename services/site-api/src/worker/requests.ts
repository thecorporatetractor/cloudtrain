import { isEmail } from '@cloudtrain/waitlist-rules';
import type { ErasureLedger, LedgerRecordInput, SystemOutcome } from '../ledger.js';
import type { Mailer } from '../mailer.js';
import type { IntakeRow, Log, QueueMessage, StateRow, Table, TableEntity, WaitlistRow } from '../model.js';
import { statusOf } from '../model.js';
import { dayOf, issueLeaveToken, issueToken, newLeaveNonce, privacyLink, REQUEST_TYPES, sameHash, subjectKey, tokenHash, verifyLeaveToken, verifyToken, waitlistShard } from '../subject.js';
import { renderPrivacyConfirm, renderWaitlistLeft, renderWaitlistWelcome, type RenderedEmail } from './email-templates.js';
import { monthsAfter, WAITLIST_MONTHS } from './retention.js';

/*
 * The worker's half of a privacy request. The public app's rows are untrusted input: its identity
 * can add anything to the intake table, so nothing in there decides anything but where a mail goes.
 *
 * Only this worker issues the link, keeps its hash in its own table and sends it to the row's
 * address, so a breached public app cannot confirm a request it did not receive by mail: it sees no
 * token and can forge no state. The worst it can do is make us send a capped number of mails.
 *
 * Every step resumes: a retry of a message, or the sweep, continues from what is saved. Nothing is
 * reported done before the ledger holds the evidence.
 */

export const BACKUP_LEGAL_BASIS = 'Waitlist backups expire after 14 days; a restore is followed by a re-application of erasures.';
const MAIL_CAP_PARTITION = 'mail-cap';
const CLOCK_SLACK_MS = 3_600_000;
/** A leave link outlives the longest a row can stay. */
const LEAVE_MARGIN_MONTHS = 1;
/** A verified request still unfinished after this is picked up by the sweep. */
const STUCK_MS = 10 * 60_000;

export interface RequestDeps {
  hmacKey: string;
  waitlistTable: Table<WaitlistRow>;
  intakeTable: Table<IntakeRow>;
  stateTable: Table<StateRow>;
  capTable: Table<TableEntity & { count: number }>;
  ledger: ErasureLedger;
  mailer: Mailer;
  /** The site's origin: where /legal/privacy-request is served. */
  siteUrl: string;
  requestTtlMs: number;
  /** Confirmation mails to one address per hour (default 3, as the gateway). */
  perSubjectPerHour: number;
  /** Confirmation mails a day, in total: what a breached VM or public app can cost in mail. */
  dailyMailCap: number;
  now: () => Date;
  log: Log;
  brand?: string;
}

/** The queue trigger gets a parsed object or a string, depending on the message. Anything unreadable is dropped: it cannot get better. */
export function parseMessage(raw: unknown): QueueMessage | null {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.kind === 'send-confirmation' && typeof o.requestId === 'string' && typeof o.partition === 'string') return { v: 1, kind: 'send-confirmation', requestId: o.requestId, partition: o.partition };
  if (o.kind === 'confirm' && typeof o.token === 'string') return { v: 1, kind: 'confirm', token: o.token };
  if (o.kind === 'welcome' && typeof o.subjectKey === 'string') return { v: 1, kind: 'welcome', subjectKey: o.subjectKey };
  if (o.kind === 'leave' && typeof o.token === 'string') return { v: 1, kind: 'leave', token: o.token };
  return null;
}

export async function handleMessage(raw: unknown, d: RequestDeps): Promise<void> {
  const m = parseMessage(raw);
  if (!m) {
    d.log.warn({}, 'privacy queue: unreadable message dropped');
    return;
  }
  switch (m.kind) {
    case 'send-confirmation':
      return sendConfirmation(m.requestId, m.partition, d);
    case 'confirm':
      return confirm(m.token, d);
    case 'welcome':
      return sendWelcome(m.subjectKey, d);
    case 'leave':
      return leave(m.token, d);
  }
}

/* -------------------------------------------------------- the link mail */

function intakeProblem(row: IntakeRow, d: RequestDeps): string | null {
  const now = d.now().getTime();
  const expires = Date.parse(row.expiresAt);
  if (typeof row.email !== 'string' || !isEmail(row.email)) return 'address';
  if (!REQUEST_TYPES.includes(row.type)) return 'type';
  if (!Number.isFinite(expires) || expires <= now) return 'expired';
  if (expires > now + d.requestTtlMs + CLOCK_SLACK_MS) return 'expiry too far ahead';
  if (dayOf(expires) !== row.partitionKey) return 'partition';
  return null;
}

async function takeMailBudget(d: RequestDeps): Promise<boolean> {
  const day = dayOf(d.now().getTime());
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await d.capTable.get(MAIL_CAP_PARTITION, day);
    if (!row) {
      if (await d.capTable.add({ partitionKey: MAIL_CAP_PARTITION, rowKey: day, count: 1 })) return true;
      continue;
    }
    if (row.count >= d.dailyMailCap) return false;
    try {
      await d.capTable.update({ partitionKey: MAIL_CAP_PARTITION, rowKey: day, count: row.count + 1 }, row.etag ?? '*');
      return true;
    } catch (e) {
      if (statusOf(e) !== 412) throw e;
    }
  }
  return false;
}

async function recentMails(key: string, d: RequestDeps): Promise<number> {
  const since = d.now().getTime() - 3_600_000;
  let n = 0;
  // A row's partition is its expiry day, and rows expire within a day: today's on covers the last hour.
  for await (const r of d.stateTable.list({ equals: { subjectKey: key }, partitionFrom: dayOf(since) })) {
    if (r.mailSentAt && Date.parse(r.mailSentAt) > since) n++;
  }
  return n;
}

export async function sendConfirmation(requestId: string, partition: string, d: RequestDeps): Promise<void> {
  const row = await d.intakeTable.get(partition, requestId);
  if (!row) return;
  const problem = intakeProblem(row, d);
  if (problem) {
    d.log.warn({ problem }, 'privacy request refused');
    await d.intakeTable.remove(partition, requestId);
    return;
  }
  const key = subjectKey(row.email, d.hmacKey);
  const existing = await d.stateTable.get(partition, requestId);
  if (existing?.mailSentAt || (existing && existing.state !== 'awaiting')) return; // a redelivery

  if ((await recentMails(key, d)) >= d.perSubjectPerHour) {
    d.log.info({ reason: 'per_subject' }, 'privacy request: no mail sent');
    await d.intakeTable.remove(partition, requestId);
    return;
  }
  if (!(await takeMailBudget(d))) {
    d.log.warn({ reason: 'daily_cap', cap: d.dailyMailCap }, 'privacy request: no mail sent');
    await d.intakeTable.remove(partition, requestId);
    return;
  }

  const expiresAt = new Date(row.expiresAt);
  const token = issueToken(requestId, expiresAt, row.type, d.hmacKey);
  const state: StateRow = { partitionKey: partition, rowKey: requestId, state: 'awaiting', type: row.type, subjectKey: key, tokenHash: tokenHash(token), requestedAt: row.requestedAt, expiresAt: row.expiresAt };
  if (existing) await d.stateTable.update(state, existing.etag ?? '*');
  else if (!(await d.stateTable.add({ ...state }))) throw Object.assign(new Error('privacy state: concurrent delivery'), { statusCode: 409 });

  const siteUrl = d.siteUrl.replace(/\/$/, '');
  await d.mailer.send({ to: row.email, ...renderPrivacyConfirm({ siteUrl, confirmUrl: privacyLink(siteUrl, token), type: row.type }) });

  const saved = await d.stateTable.get(partition, requestId);
  if (saved) await d.stateTable.update({ partitionKey: partition, rowKey: requestId, mailSentAt: d.now().toISOString() }, saved.etag ?? '*');
}

/* --------------------------------------------------------------- confirm */

export async function confirm(token: string, d: RequestDeps): Promise<void> {
  const v = verifyToken(token, d.now().getTime(), d.hmacKey);
  if (!v) return;
  const partition = dayOf(v.expiresAtMs);
  const state = await d.stateTable.get(partition, v.requestId);
  // A used, an unknown or a forged link: nothing to do and nothing to say.
  if (!state || state.state === 'done' || !state.tokenHash || !sameHash(state.tokenHash, tokenHash(token))) return;
  if (state.state === 'awaiting') {
    // The claim is what makes the link single-use: a concurrent click loses on the ETag and comes back as a retry.
    await d.stateTable.update({ partitionKey: partition, rowKey: v.requestId, state: 'processing', verifiedAt: d.now().toISOString() }, state.etag ?? '*');
  }
  await perform(partition, v.requestId, d);
}

function completionMail(type: StateRow['type'], rows: number, entry: WaitlistRow | null, siteUrl: string, brand: string): RenderedEmail {
  const plain = (subject: string, text: string): RenderedEmail => ({ subject, text });
  if (type === 'export') {
    if (!entry) return plain(`Your ${brand} data`, 'We hold no waitlist entry for this address, so there is nothing to send you.\n\nIf you also have an account, you can download its data under Privacy in your account.\n');
    const data = { waitlist: [{ email: entry.email, organisation: entry.organisation ?? null, role: entry.role ?? null, interest: entry.interest ?? null, consentAt: entry.consentAt, consentWordingHash: entry.consentLabelHash ?? null, privacyNoticeDate: entry.privacyNoticeUpdated ?? null, formSource: entry.formSource ?? null, welcomeSentAt: entry.welcomeSentAt ?? null, createdAt: entry.createdAt }] };
    return plain(`Your ${brand} data`, `This is everything the waitlist holds under this address:\n\n${JSON.stringify(data, null, 2)}\n`);
  }
  if (!rows) return plain(`Your ${brand} privacy request is complete`, 'We hold no waitlist entry for this address, so there was nothing to remove. We have recorded that your request was handled.\n');
  if (type === 'withdrawal') return renderWaitlistLeft({ siteUrl });
  return plain(`Your ${brand} privacy request is complete`, 'Your waitlist entry is erased. It can remain in encrypted backups for up to 14 days and is removed with them. We kept a record that this was done, which does not contain your email address.\n');
}

/** Carries out a verified request. Safe to run again at any point. */
export async function perform(partition: string, requestId: string, d: RequestDeps): Promise<void> {
  const state = await d.stateTable.get(partition, requestId);
  if (!state || state.state !== 'processing') return;
  const intake = await d.intakeTable.get(partition, requestId);
  if (!intake) {
    // The address is gone, so the work was finished and only this last write was lost.
    await d.stateTable.update({ partitionKey: partition, rowKey: requestId, state: 'done', tokenHash: '', outcomes: '' }, state.etag ?? '*');
    return;
  }
  if (subjectKey(intake.email, d.hmacKey) !== state.subjectKey) throw new Error('privacy request: the intake row does not match its state');

  const key = state.subjectKey;
  const shard = waitlistShard(key);
  let outcomes: SystemOutcome[];
  let entry: WaitlistRow | null = null;
  if (state.type === 'export') {
    entry = await d.waitlistTable.get(shard, key);
    outcomes = [{ system: 'waitlist', category: 'waitlist', action: entry ? 'exported' : 'none', rows: entry ? 1 : 0 }];
  } else if (state.outcomes) {
    outcomes = JSON.parse(state.outcomes) as SystemOutcome[];
  } else {
    const removed = await d.waitlistTable.remove(shard, key);
    outcomes = [
      { system: 'waitlist', category: 'waitlist', action: removed ? 'deleted' : 'none', rows: removed ? 1 : 0 },
      { system: 'backups', category: 'backups', action: 'expires', rows: 0, legalBasis: BACKUP_LEGAL_BASIS },
    ];
    // Saved at once: a retry after this point must not report 0 rows removed.
    const fresh = await d.stateTable.get(partition, requestId);
    await d.stateTable.update({ partitionKey: partition, rowKey: requestId, outcomes: JSON.stringify(outcomes) }, fresh?.etag ?? '*');
  }

  const categories = state.type === 'export' ? ['waitlist'] : [...new Set(outcomes.filter((o) => o.rows > 0 || o.action === 'retained' || o.action === 'expires').map((o) => o.category))];
  const verifiedAt = state.verifiedAt ?? d.now().toISOString();
  const record: LedgerRecordInput = { requestId, type: state.type, scope: 'waitlist', subjectKey: key, dataCategories: categories, outcomes, requestedAt: state.requestedAt, verifiedAt, completedAt: d.now().toISOString(), actor: 'self' };
  // No evidence, no data and no "done": a failure here leaves the request open for the retry and the sweep.
  const appended = await d.ledger.append(record);
  // Anchors the chain outside the store: no identifiers, only position and hash.
  d.log.info({ seq: appended.seq, hash: appended.hash, type: appended.type }, 'gdpr ledger append');

  const removedRows = outcomes.filter((o) => o.action === 'deleted').reduce((n, o) => n + o.rows, 0);
  const mail = completionMail(state.type, removedRows, entry, d.siteUrl, d.brand ?? 'CloudTrain');
  await d.mailer.send({ to: intake.email, ...mail });

  await d.intakeTable.remove(partition, requestId);
  const last = await d.stateTable.get(partition, requestId);
  await d.stateTable.update({ partitionKey: partition, rowKey: requestId, state: 'done', tokenHash: '', outcomes: '' }, last?.etag ?? '*');
}

/* -------------------------------------------------------- waitlist mail */

/**
 * The one way a mail about a waitlist place goes out: the row must still exist at send time, since
 * a message can outlive an erasure, and the mail always carries the row's leave link. No address
 * is kept anywhere but on the row; there is no outbox. A later status mail goes through here too.
 */
export async function sendWaitlistMail(key: string, render: (ctx: { siteUrl: string; leaveUrl: string }) => RenderedEmail, d: RequestDeps): Promise<boolean> {
  const row = await d.waitlistTable.get(waitlistShard(key), key);
  if (!row) return false;
  const created = Date.parse(row.createdAt);
  if (!Number.isFinite(created) || !isEmail(String(row.email))) return false;
  // Always a fresh nonce on the first mail: a row added by a breached public app cannot bring its own.
  let nonce = row.welcomeSentAt ? row.leaveNonce : undefined;
  if (!nonce) {
    nonce = newLeaveNonce();
    await d.waitlistTable.update({ partitionKey: row.partitionKey, rowKey: row.rowKey, leaveNonce: nonce }, row.etag ?? '*');
  }
  const expires = monthsAfter(new Date(created), WAITLIST_MONTHS + LEAVE_MARGIN_MONTHS);
  const siteUrl = d.siteUrl.replace(/\/$/, '');
  const leaveUrl = privacyLink(siteUrl, issueLeaveToken(key, expires, nonce, d.hmacKey));
  await d.mailer.send({ to: row.email, ...render({ siteUrl, leaveUrl }) });
  return true;
}

export async function sendWelcome(key: string, d: RequestDeps): Promise<void> {
  const row = await d.waitlistTable.get(waitlistShard(key), key);
  if (!row || row.welcomeSentAt) return; // erased since, or a redelivery
  if (!(await takeMailBudget(d))) {
    d.log.warn({ reason: 'daily_cap', cap: d.dailyMailCap }, 'welcome: no mail sent');
    return;
  }
  if (!(await sendWaitlistMail(key, renderWaitlistWelcome, d))) return;
  const saved = await d.waitlistTable.get(waitlistShard(key), key);
  if (saved) await d.waitlistTable.update({ partitionKey: saved.partitionKey, rowKey: saved.rowKey, welcomeSentAt: d.now().toISOString() }, saved.etag ?? '*');
}

/**
 * The leave link, confirmed on the page. It acts on the token's subject and nothing else, and only
 * while the row holds that nonce: after removal, or a later signup of the same address, it is dead.
 * The record goes first: without it the row stays and the retry finds both.
 */
export async function leave(token: string, d: RequestDeps): Promise<void> {
  const v = verifyLeaveToken(token, d.now().getTime(), d.hmacKey);
  if (!v) return;
  const shard = waitlistShard(v.subjectKey);
  const row = await d.waitlistTable.get(shard, v.subjectKey);
  if (!row?.leaveNonce || !sameHash(row.leaveNonce, v.nonce)) return;
  const at = d.now().toISOString();
  const outcomes: SystemOutcome[] = [
    { system: 'waitlist', category: 'waitlist', action: 'deleted', rows: 1 },
    { system: 'backups', category: 'backups', action: 'expires', rows: 0, legalBasis: BACKUP_LEGAL_BASIS },
  ];
  // Derived from the token, so a redelivery finds the record it already wrote.
  const requestId = tokenHash(token).slice(0, 32);
  const appended = await d.ledger.append({ requestId, type: 'withdrawal', scope: 'waitlist', subjectKey: v.subjectKey, dataCategories: ['waitlist', 'backups'], outcomes, requestedAt: at, verifiedAt: at, completedAt: at, actor: 'self' });
  d.log.info({ seq: appended.seq, hash: appended.hash, type: appended.type }, 'gdpr ledger append');
  await d.waitlistTable.remove(shard, v.subjectKey);
  // One brief notice with no links, and it is not worth failing over: the person has already left.
  await d.mailer.send({ to: row.email, ...renderWaitlistLeft({ siteUrl: d.siteUrl.replace(/\/$/, '') }) }).catch((e: unknown) => d.log.warn({ status: statusOf(e) }, 'leave: the notice could not be sent'));
}

/* ----------------------------------------------------------------- sweep */

export interface SweepResult {
  resumed: number;
  stuck: number;
  expiredIntake: number;
  expiredState: number;
}

/**
 * Finishes verified requests whose queue message ran out of retries, and removes what has expired.
 * A verified request is never dropped: it stays until it is done, and its address with it.
 */
export async function sweepRequests(d: RequestDeps): Promise<SweepResult> {
  const nowMs = d.now().getTime();
  const at = new Date(nowMs).toISOString();
  const result: SweepResult = { resumed: 0, stuck: 0, expiredIntake: 0, expiredState: 0 };

  const stuckBefore = new Date(nowMs - STUCK_MS).toISOString();
  const stuck: StateRow[] = [];
  for await (const r of d.stateTable.list({ equals: { state: 'processing' }, before: { prop: 'verifiedAt', at: stuckBefore } })) stuck.push(r);
  for (const r of stuck) {
    try {
      await perform(r.partitionKey, r.rowKey, d);
      result.resumed++;
    } catch (e) {
      result.stuck++;
      d.log.warn({ status: statusOf(e) }, 'privacy request: still unfinished');
    }
  }

  const expired: StateRow[] = [];
  for await (const r of d.stateTable.list({ before: { prop: 'expiresAt', at } })) expired.push(r);
  const open = new Set<string>();
  for (const r of expired) {
    if (r.state === 'processing') {
      open.add(r.rowKey);
      continue;
    }
    if (await d.stateTable.remove(r.partitionKey, r.rowKey)) result.expiredState++;
  }
  const intake: IntakeRow[] = [];
  for await (const r of d.intakeTable.list({ before: { prop: 'expiresAt', at } })) intake.push(r);
  for (const r of intake) {
    if (open.has(r.rowKey)) continue;
    if (await d.intakeTable.remove(r.partitionKey, r.rowKey)) result.expiredIntake++;
  }

  // The mail counters of past days.
  const keepFrom = dayOf(nowMs - 7 * 86_400_000);
  const caps: TableEntity[] = [];
  for await (const r of d.capTable.list({ equals: { PartitionKey: MAIL_CAP_PARTITION } })) if (r.rowKey < keepFrom) caps.push(r);
  for (const r of caps) await d.capTable.remove(r.partitionKey, r.rowKey);
  return result;
}
