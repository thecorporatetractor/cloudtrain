import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { withTenant, type Db, type Tx } from '../db/index.js';

/*
 * The erasure evidence ledger (docs/gdpr.md). One hash-chained record per completed
 * data-subject request: what was asked, of which subject key, what each system did, and
 * when. A record never holds an address, a name or a user id; `append` refuses one that
 * looks like it does.
 *
 * Three stores: Azure Table Storage through a managed identity (production), an append-only
 * Postgres table (the default for self-hosters and dev), memory (tests).
 *
 * Tamper evidence: `hash` covers the canonical record including `prevHash` and `seq`, so a
 * changed record, a removed record or a reordered record breaks the chain. The chain alone
 * cannot see the newest records being cut off, or the whole chain being rebuilt by someone who
 * can write the store: `verifyChain({ expect })` against a head noted elsewhere (the gateway logs
 * it on every append, and Sentinel keeps those writes) closes that.
 */

export type LedgerRequestType = 'erasure' | 'withdrawal' | 'export' | 'restriction' | 'objection';
export type LedgerActor = 'self' | 'admin';
/** What a request covers: only the waitlist entry, or the whole account. `gdpr:reapply` honours it. */
export type LedgerScope = 'waitlist' | 'account';
export type OutcomeAction = 'deleted' | 'anonymised' | 'retained' | 'exported' | 'expires' | 'none' | 'restricted' | 'lifted' | 'requested';

export interface SystemOutcome {
  /** e.g. `postgres.waitlist_entries`, `keycloak`, `stripe.customer`. */
  system: string;
  /** e.g. `waitlist`, `identity`, `invoices`. */
  category: string;
  action: OutcomeAction;
  rows: number;
  /** Why a retained category stays. */
  legalBasis?: string;
}

export interface LedgerRecordInput {
  requestId: string;
  type: LedgerRequestType;
  scope: LedgerScope;
  /** HMAC-SHA-256 of the normalised address (subject.ts). */
  subjectKey: string;
  /** The same keyed hash over the user id, when there is an account. */
  userKey?: string;
  dataCategories: string[];
  outcomes: SystemOutcome[];
  requestedAt: string;
  verifiedAt: string;
  completedAt: string;
  actor: LedgerActor;
  /** A fixed label only, e.g. `post-restore-reapply`. */
  reason?: string;
}

export interface LedgerEntry extends LedgerRecordInput {
  version: 1;
  seq: number;
  prevHash: string;
  hash: string;
}

export interface ChainProblem {
  seq: number;
  kind: 'hash_mismatch' | 'prev_hash_mismatch' | 'sequence_gap' | 'column_mismatch' | 'unreadable' | 'head_mismatch' | 'checkpoint_invalid';
}

/**
 * What retention pruned: the chain's position at the newest removed record, signed with a key
 * derived from CT_GDPR_HMAC_KEY. Verification continues from here; dropping the checkpoint, or
 * forging one without the key, fails verification.
 */
export interface LedgerCheckpoint {
  version: 1;
  throughSeq: number;
  throughHash: string;
  prunedTotal: number;
  prunedAt: string;
  newestCompletedAt: string;
  signature: string;
}

export interface ChainReport {
  ok: boolean;
  count: number;
  /** The checkpoint the walk started from, when older records were pruned. */
  checkpoint?: { throughSeq: number; prunedTotal: number };
  head: { seq: number; hash: string };
  problems: ChainProblem[];
}

export interface VerifyOptions {
  /** A head noted earlier (gateway log, Sentinel): the chain must still contain exactly this record at that sequence. */
  expect?: { seq: number; hash: string };
}

export interface ErasureLedger {
  /** Appends one record. The same request id again answers the record it already wrote. */
  append(input: LedgerRecordInput): Promise<LedgerEntry>;
  /** Every record, oldest first. */
  entries(): Promise<LedgerEntry[]>;
  verifyChain(opts?: VerifyOptions): Promise<ChainReport>;
  /** The newest retention checkpoint, or null when nothing was ever pruned. */
  checkpoint(): Promise<LedgerCheckpoint | null>;
  /**
   * Retention: removes the oldest records completed before `cutoff`, up to `limit`, leaving a
   * signed checkpoint, so the rest still verifies. Answers how many went.
   */
  prune(cutoff: Date, limit: number): Promise<number>;
}

export const GENESIS_HASH = '0'.repeat(64);

/** JSON with sorted keys and no whitespace: the same record always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashRecord(entry: Omit<LedgerEntry, 'hash'> & { hash?: string }): string {
  const { hash: _hash, ...rest } = entry;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

const HEX64 = /^[0-9a-f]{64}$/;

/** The last line of defence against a direct identifier reaching the evidence store. */
export function assertNoDirectIdentifiers(input: LedgerRecordInput): void {
  if (!HEX64.test(input.subjectKey) || (input.userKey !== undefined && !HEX64.test(input.userKey))) throw new Error('ledger: subject keys must be HMAC-SHA-256 hex');
  if (JSON.stringify(input).includes('@')) throw new Error('ledger: a record must not contain an email address');
}

export function buildEntry(input: LedgerRecordInput, seq: number, prevHash: string): LedgerEntry {
  assertNoDirectIdentifiers(input);
  const entry: Omit<LedgerEntry, 'hash'> = { ...input, version: 1, seq, prevHash };
  return { ...entry, hash: hashRecord(entry) };
}

const checkpointKey = (hmacKey: string) => createHmac('sha256', hmacKey).update('ledger-checkpoint-v1').digest();

export function signCheckpoint(cp: Omit<LedgerCheckpoint, 'signature'>, hmacKey: string): LedgerCheckpoint {
  return { ...cp, signature: createHmac('sha256', checkpointKey(hmacKey)).update(canonicalJson(cp)).digest('hex') };
}

/** The current key first, then those being rotated out: a checkpoint keeps verifying under the key that signed it. */
export type LedgerKeys = string | readonly string[] | undefined;
const keysOf = (k: LedgerKeys): readonly string[] => (typeof k === 'string' ? [k] : (k ?? []));

export function checkpointValid(cp: LedgerCheckpoint, hmacKey: LedgerKeys): boolean {
  const { signature, ...rest } = cp;
  const given = Buffer.from(String(signature));
  return keysOf(hmacKey).some((key) => {
    const want = Buffer.from(signCheckpoint(rest, key).signature);
    return want.length === given.length && timingSafeEqual(want, given);
  });
}

/** The oldest records completed before the cutoff: an unbroken prefix, since the chain only prunes from its start. */
export function prunablePrefix(entries: LedgerEntry[], cutoff: Date, limit: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const e of entries) {
    if (out.length >= limit || Date.parse(e.completedAt) >= cutoff.getTime()) break;
    out.push(e);
  }
  return out;
}

export function nextCheckpoint(removed: LedgerEntry[], previous: LedgerCheckpoint | null, now: Date, hmacKey: string): LedgerCheckpoint {
  const last = removed[removed.length - 1]!;
  return signCheckpoint({ version: 1, throughSeq: last.seq, throughHash: last.hash, prunedTotal: (previous?.prunedTotal ?? 0) + removed.length, prunedAt: now.toISOString(), newestCompletedAt: last.completedAt }, hmacKey);
}

/** Walks a chain from the genesis or the checkpoint: every problem found, not just the first. */
export function checkChain(entries: LedgerEntry[], opts: VerifyOptions = {}, extra: ChainProblem[] = [], checkpoint?: { value: LedgerCheckpoint; hmacKey: LedgerKeys } | null): ChainReport {
  const problems = [...extra];
  const cp = checkpoint?.value;
  if (cp && !checkpointValid(cp, checkpoint?.hmacKey)) problems.push({ seq: cp.throughSeq, kind: 'checkpoint_invalid' });
  let prev = cp?.throughHash ?? GENESIS_HASH;
  let expected = (cp?.throughSeq ?? 0) + 1;
  for (const e of entries) {
    if (e.seq !== expected) problems.push({ seq: e.seq, kind: 'sequence_gap' });
    if (e.prevHash !== prev) problems.push({ seq: e.seq, kind: 'prev_hash_mismatch' });
    if (hashRecord(e) !== e.hash) problems.push({ seq: e.seq, kind: 'hash_mismatch' });
    prev = e.hash;
    expected = e.seq + 1;
  }
  const last = entries[entries.length - 1];
  if (opts.expect && !(cp && opts.expect.seq <= cp.throughSeq)) {
    const at = entries.find((e) => e.seq === opts.expect!.seq);
    if (!at || at.hash !== opts.expect.hash) problems.push({ seq: opts.expect.seq, kind: 'head_mismatch' });
  }
  return {
    ok: problems.length === 0,
    count: entries.length,
    ...(cp ? { checkpoint: { throughSeq: cp.throughSeq, prunedTotal: cp.prunedTotal } } : {}),
    head: { seq: last?.seq ?? cp?.throughSeq ?? 0, hash: last?.hash ?? cp?.throughHash ?? GENESIS_HASH },
    problems,
  };
}

/* -------------------------------------------------------------- memory */

/** Tests: `rows` is public so a test can tamper with it; `failNext` makes appends fail. */
export class MemoryLedger implements ErasureLedger {
  rows: LedgerEntry[] = [];
  failNext = 0;
  cp: LedgerCheckpoint | null = null;
  constructor(private readonly hmacKey?: LedgerKeys) {}

  async append(input: LedgerRecordInput): Promise<LedgerEntry> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('ledger unavailable');
    }
    const found = this.rows.find((e) => e.requestId === input.requestId);
    if (found) return found;
    const last = this.rows[this.rows.length - 1];
    const entry = buildEntry(input, (last?.seq ?? this.cp?.throughSeq ?? 0) + 1, last?.hash ?? this.cp?.throughHash ?? GENESIS_HASH);
    this.rows.push(entry);
    return entry;
  }

  async entries(): Promise<LedgerEntry[]> {
    return [...this.rows];
  }

  async verifyChain(opts?: VerifyOptions): Promise<ChainReport> {
    return checkChain(this.rows, opts, [], this.cp ? { value: this.cp, hmacKey: this.hmacKey } : null);
  }

  async checkpoint() {
    return this.cp;
  }

  async prune(cutoff: Date, limit: number): Promise<number> {
    const removed = prunablePrefix(this.rows, cutoff, limit);
    if (!removed.length) return 0;
    const key = keysOf(this.hmacKey)[0];
    if (!key) throw new Error('ledger: pruning needs the signing key');
    this.cp = nextCheckpoint(removed, this.cp, new Date(), key);
    this.rows = this.rows.slice(removed.length);
    return removed.length;
  }
}

/* ------------------------------------------------------------ postgres */

const LEDGER_LOCK = 7_316_001; // pg_advisory_xact_lock: one append at a time over the whole chain.

/** The default store: table gdpr_ledger (migration 0010), append-only for every role through a trigger. */
export class PostgresLedger implements ErasureLedger {
  constructor(
    private readonly db: Db,
    private readonly hmacKey?: LedgerKeys,
  ) {}

  /** Where the chain stands: the newest record, else the newest checkpoint. */
  private async position(tx: Tx): Promise<{ seq: number; hash: string }> {
    const last = await tx.selectFrom('gdpr_ledger').select(['seq', 'hash']).orderBy('seq', 'desc').limit(1).executeTakeFirst();
    if (last) return { seq: Number(last.seq), hash: last.hash };
    const cp = await tx.selectFrom('gdpr_ledger_checkpoints').select('record').orderBy('through_seq', 'desc').limit(1).executeTakeFirst();
    if (!cp) return { seq: 0, hash: GENESIS_HASH };
    const c = JSON.parse(cp.record) as LedgerCheckpoint;
    return { seq: c.throughSeq, hash: c.throughHash };
  }

  async checkpoint(): Promise<LedgerCheckpoint | null> {
    const r = await withTenant(this.db, { platform: true }, (tx) => tx.selectFrom('gdpr_ledger_checkpoints').select('record').orderBy('through_seq', 'desc').limit(1).executeTakeFirst());
    return r ? (JSON.parse(r.record) as LedgerCheckpoint) : null;
  }

  async prune(cutoff: Date, limit: number): Promise<number> {
    const removed = prunablePrefix(await this.entries(), cutoff, limit);
    if (!removed.length) return 0;
    const key = keysOf(this.hmacKey)[0];
    if (!key) throw new Error('ledger: pruning needs the signing key');
    const cp = nextCheckpoint(removed, await this.checkpoint(), new Date(), key);
    const r = await withTenant(this.db, { platform: true }, async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK})`.execute(tx);
      return sql<{ n: number }>`SELECT sys_prune_gdpr_ledger(${cp.throughSeq}, ${cp.throughHash}, ${canonicalJson(cp)}) AS n`.execute(tx);
    });
    return r.rows[0]?.n ?? 0;
  }

  async append(input: LedgerRecordInput): Promise<LedgerEntry> {
    return withTenant(this.db, { platform: true }, async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK})`.execute(tx);
      const found = await tx.selectFrom('gdpr_ledger').select('record').where('request_id', '=', input.requestId).executeTakeFirst();
      if (found) return JSON.parse(found.record) as LedgerEntry;
      const at = await this.position(tx);
      const entry = buildEntry(input, at.seq + 1, at.hash);
      await tx.insertInto('gdpr_ledger').values({ seq: entry.seq, request_id: entry.requestId, type: entry.type, subject_key: entry.subjectKey, prev_hash: entry.prevHash, hash: entry.hash, record: canonicalJson(entry) }).execute();
      return entry;
    });
  }

  private rows() {
    return withTenant(this.db, { platform: true }, (tx) => tx.selectFrom('gdpr_ledger').selectAll().orderBy('seq').execute());
  }

  async entries(): Promise<LedgerEntry[]> {
    return (await this.rows()).map((r) => JSON.parse(r.record) as LedgerEntry);
  }

  async verifyChain(opts?: VerifyOptions): Promise<ChainReport> {
    const problems: ChainProblem[] = [];
    const entries: LedgerEntry[] = [];
    for (const r of await this.rows()) {
      let e: LedgerEntry;
      try {
        e = JSON.parse(r.record) as LedgerEntry;
      } catch {
        problems.push({ seq: Number(r.seq), kind: 'unreadable' });
        continue;
      }
      // The columns are what queries read; the record is what the hash covers. They must agree.
      if (Number(r.seq) !== e.seq || r.request_id !== e.requestId || r.subject_key !== e.subjectKey || r.type !== e.type || r.prev_hash !== e.prevHash || r.hash !== e.hash) problems.push({ seq: Number(r.seq), kind: 'column_mismatch' });
      entries.push(e);
    }
    const cp = await this.checkpoint();
    return checkChain(entries, opts, problems, cp ? { value: cp, hmacKey: this.hmacKey } : null);
  }

  /**
   * After a restore rolled the table back: re-adds the records a ledger export has beyond the
   * restored head, so the chain carries on instead of forking. Refuses an export that does not
   * continue this chain. Returns how many were added.
   */
  async importMissing(exported: LedgerEntry[], exportedCheckpoint: LedgerCheckpoint | null = null): Promise<number> {
    const whole = checkChain(exported, {}, [], exportedCheckpoint ? { value: exportedCheckpoint, hmacKey: this.hmacKey } : null);
    if (!whole.ok) throw new Error(`ledger export fails verification: ${whole.problems.map((p) => `${p.kind}@${p.seq}`).join(', ')}`);
    return withTenant(this.db, { platform: true }, async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK})`.execute(tx);
      const at = await this.position(tx);
      const first = exported[0];
      if (first && first.seq > at.seq + 1) throw new Error('ledger export starts after the restored head: records between them are gone');
      const joinedAt = exported.find((e) => e.seq === at.seq);
      if (at.seq > 0 && first && first.seq <= at.seq && joinedAt?.hash !== at.hash) throw new Error('ledger export does not continue the restored chain');
      if (first && first.seq === at.seq + 1 && first.prevHash !== at.hash) throw new Error('ledger export does not continue the restored chain');
      const missing = exported.filter((e) => e.seq > at.seq);
      for (const e of missing) await tx.insertInto('gdpr_ledger').values({ seq: e.seq, request_id: e.requestId, type: e.type, subject_key: e.subjectKey, prev_hash: e.prevHash, hash: e.hash, record: canonicalJson(e) }).execute();
      return missing.length;
    });
  }
}

/* --------------------------------------------------------------- azure */

export interface AzureLedgerConfig {
  /** CT_GDPR_LEDGER_TABLE_URL, e.g. https://<account>.table.core.windows.net */
  tableUrl: string;
  /** CT_GDPR_LEDGER_TABLE */
  table: string;
  /** AZURE_CLIENT_ID: the user-assigned managed identity. */
  clientId: string;
}

type AzureEntity = Record<string, unknown> & { partitionKey: string; rowKey: string; etag?: string };

/** The part of @azure/data-tables' TableClient the ledger uses. */
export interface TableClientLike {
  getEntity<T extends object>(partitionKey: string, rowKey: string): Promise<T & { etag?: string }>;
  listEntities<T extends object>(options?: { queryOptions?: { filter?: string } }): AsyncIterable<T & { etag?: string }>;
  submitTransaction(actions: unknown[]): Promise<unknown>;
}

const CHECKPOINT_KEY = 'checkpoint';
/** One entity-group transaction holds 100 operations: two per record, plus the checkpoint. */
const AZURE_PRUNE_BATCH = 45;
const PARTITION = 'chain';
const HEAD_KEY = 'head';
const rowKeyOf = (seq: number) => `r${String(seq).padStart(12, '0')}`;
const statusOf = (e: unknown) => (e as { statusCode?: number }).statusCode;
const CONFLICT = new Set([409, 412]);

/**
 * Azure Table Storage through ManagedIdentityCredential: no keys, no connection strings.
 * One partition holds the chain, so each append is one entity-group transaction: the record,
 * a marker per request id (idempotence), and the head with an ETag condition (two gateways cannot
 * both extend the same head; the loser re-reads and tries again).
 */
export class AzureTableLedger implements ErasureLedger {
  constructor(
    private readonly client: TableClientLike,
    private readonly attempts = 6,
    private readonly backoffMs = 200,
    private readonly hmacKey?: LedgerKeys,
  ) {}

  /** Imports the SDK on first use: the site VM runs in little memory and the default store needs none of it. */
  static async create(cfg: AzureLedgerConfig, hmacKey?: LedgerKeys): Promise<AzureTableLedger> {
    const [{ TableClient }, { ManagedIdentityCredential }] = await Promise.all([import('@azure/data-tables'), import('@azure/identity')]);
    const credential = new ManagedIdentityCredential({ clientId: cfg.clientId });
    return new AzureTableLedger(new TableClient(cfg.tableUrl, cfg.table, credential) as unknown as TableClientLike, undefined, undefined, hmacKey);
  }

  private async headEntity(): Promise<(AzureEntity & { seq: number; hash: string }) | null> {
    try {
      return await this.client.getEntity<AzureEntity & { seq: number; hash: string }>(PARTITION, HEAD_KEY);
    } catch (e) {
      if (statusOf(e) === 404) return null;
      throw e;
    }
  }

  private async existing(requestId: string): Promise<LedgerEntry | null> {
    try {
      const m = await this.client.getEntity<AzureEntity & { seq: number }>(PARTITION, `q${requestId}`);
      const r = await this.client.getEntity<AzureEntity & { record: string }>(PARTITION, rowKeyOf(Number(m.seq)));
      return JSON.parse(r.record) as LedgerEntry;
    } catch (e) {
      if (statusOf(e) === 404) return null;
      throw e;
    }
  }

  async append(input: LedgerRecordInput): Promise<LedgerEntry> {
    assertNoDirectIdentifiers(input);
    for (let attempt = 1; ; attempt++) {
      const found = await this.existing(input.requestId);
      if (found) return found;
      // The head outlives pruning, so the chain carries on from it even when every record was pruned.
      const head = await this.headEntity();
      const entry = buildEntry(input, Number(head?.seq ?? 0) + 1, head?.hash ?? GENESIS_HASH);
      const nextHead = { partitionKey: PARTITION, rowKey: HEAD_KEY, seq: entry.seq, hash: entry.hash };
      const actions: unknown[] = [
        ['create', { partitionKey: PARTITION, rowKey: rowKeyOf(entry.seq), seq: entry.seq, type: entry.type, hash: entry.hash, prevHash: entry.prevHash, requestId: entry.requestId, record: canonicalJson(entry) }],
        ['create', { partitionKey: PARTITION, rowKey: `q${entry.requestId}`, seq: entry.seq }],
        head ? ['update', nextHead, 'Replace', { etag: head.etag }] : ['create', nextHead],
      ];
      try {
        await this.client.submitTransaction(actions);
        return entry;
      } catch (e) {
        if (!CONFLICT.has(statusOf(e) ?? 0) || attempt >= this.attempts) throw e;
        await new Promise((r) => setTimeout(r, this.backoffMs * attempt));
      }
    }
  }

  private async read(): Promise<{ entries: LedgerEntry[]; problems: ChainProblem[] }> {
    const problems: ChainProblem[] = [];
    const entries: LedgerEntry[] = [];
    const filter = `PartitionKey eq '${PARTITION}' and RowKey ge 'r' and RowKey lt 's'`;
    for await (const r of this.client.listEntities<AzureEntity & { seq: number; hash: string; record: string }>({ queryOptions: { filter } })) {
      try {
        const e = JSON.parse(r.record) as LedgerEntry;
        if (Number(r.seq) !== e.seq || r.hash !== e.hash || r.rowKey !== rowKeyOf(e.seq)) problems.push({ seq: Number(r.seq), kind: 'column_mismatch' });
        entries.push(e);
      } catch {
        problems.push({ seq: Number(r.seq), kind: 'unreadable' });
      }
    }
    entries.sort((a, b) => a.seq - b.seq);
    return { entries, problems };
  }

  async entries(): Promise<LedgerEntry[]> {
    return (await this.read()).entries;
  }

  async verifyChain(opts?: VerifyOptions): Promise<ChainReport> {
    const { entries, problems } = await this.read();
    // The head entity is the store's own claim of the newest record: a record cut off the end disagrees with it.
    const head = await this.headEntity();
    const cp = await this.checkpoint();
    const last = entries[entries.length - 1];
    const newest = { seq: last?.seq ?? cp?.throughSeq ?? 0, hash: last?.hash ?? cp?.throughHash ?? GENESIS_HASH };
    if ((head?.hash ?? GENESIS_HASH) !== newest.hash || Number(head?.seq ?? 0) !== newest.seq) problems.push({ seq: Number(head?.seq ?? 0), kind: 'head_mismatch' });
    return checkChain(entries, opts, problems, cp ? { value: cp, hmacKey: this.hmacKey } : null);
  }

  private async checkpointEntity(): Promise<(AzureEntity & { record: string }) | null> {
    try {
      return await this.client.getEntity<AzureEntity & { record: string }>(PARTITION, CHECKPOINT_KEY);
    } catch (e) {
      if (statusOf(e) === 404) return null;
      throw e;
    }
  }

  async checkpoint(): Promise<LedgerCheckpoint | null> {
    const r = await this.checkpointEntity();
    return r ? (JSON.parse(r.record) as LedgerCheckpoint) : null;
  }

  async prune(cutoff: Date, limit: number): Promise<number> {
    const removed = prunablePrefix(await this.entries(), cutoff, Math.min(limit, AZURE_PRUNE_BATCH));
    if (!removed.length) return 0;
    const key = keysOf(this.hmacKey)[0];
    if (!key) throw new Error('ledger: pruning needs the signing key');
    const existing = await this.checkpointEntity();
    const previous = existing ? (JSON.parse(existing.record) as LedgerCheckpoint) : null;
    const cp = nextCheckpoint(removed, previous, new Date(), key);
    const entity = { partitionKey: PARTITION, rowKey: CHECKPOINT_KEY, record: canonicalJson(cp) };
    const actions: unknown[] = [existing ? ['update', entity, 'Replace', { etag: existing.etag }] : ['create', entity]];
    for (const e of removed) actions.push(['delete', { partitionKey: PARTITION, rowKey: rowKeyOf(e.seq) }], ['delete', { partitionKey: PARTITION, rowKey: `q${e.requestId}` }]);
    await this.client.submitTransaction(actions);
    return removed.length;
  }
}

/* ------------------------------------------------------------- factory */

export interface LedgerConfig {
  tableUrl?: string;
  table?: string;
  clientId?: string;
}

/** Azure when CT_GDPR_LEDGER_TABLE_URL is set (and then all of it must be); otherwise Postgres. */
export async function createLedger(cfg: LedgerConfig, db: Db, hmacKey?: LedgerKeys): Promise<ErasureLedger> {
  if (!cfg.tableUrl) return new PostgresLedger(db, hmacKey);
  if (!cfg.table) throw new Error('CT_GDPR_LEDGER_TABLE must be set with CT_GDPR_LEDGER_TABLE_URL');
  if (!cfg.clientId) throw new Error('AZURE_CLIENT_ID (the managed identity) must be set with CT_GDPR_LEDGER_TABLE_URL');
  if (!/^https:\/\//.test(cfg.tableUrl)) throw new Error('CT_GDPR_LEDGER_TABLE_URL must be an https URL');
  return AzureTableLedger.create({ tableUrl: cfg.tableUrl, table: cfg.table, clientId: cfg.clientId }, hmacKey);
}

export const newRequestId = (): string => randomUUID();
