import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/*
 * The erasure evidence ledger, record for record the format of
 * services/gateway/src/gdpr/ledger.ts (version 1): the same canonical JSON, the same hash chain,
 * the same subject key, the same Azure table layout and the same checkpoint. test/ledger.test.ts
 * pins a record and a checkpoint produced by the gateway's code, so the two cannot drift silently.
 *
 * It is a matched copy rather than a shared package: the gateway's file also holds its Postgres
 * store and lives on another branch; moving it now would make that branch's merge hard. Only
 * the Memory and Azure stores are here.
 *
 * The table is mutable by anyone with write access to it: the chain makes a change visible, it
 * does not prevent one. See LedgerWithCopy for the immutable copy.
 */

/** The website only produces erasure, withdrawal and export. The rest are the gateway's, accepted so one verifier reads both. */
export type LedgerRequestType = 'erasure' | 'withdrawal' | 'export' | 'restriction' | 'objection';
export type LedgerActor = 'self' | 'admin';
export type LedgerScope = 'waitlist' | 'account';
export type OutcomeAction = 'deleted' | 'anonymised' | 'retained' | 'exported' | 'expires' | 'none' | 'restricted' | 'lifted' | 'requested';

export interface SystemOutcome {
  system: string;
  category: string;
  action: OutcomeAction;
  rows: number;
  legalBasis?: string;
}

export interface LedgerRecordInput {
  requestId: string;
  type: LedgerRequestType;
  scope: LedgerScope;
  subjectKey: string;
  userKey?: string;
  dataCategories: string[];
  outcomes: SystemOutcome[];
  requestedAt: string;
  verifiedAt: string;
  completedAt: string;
  actor: LedgerActor;
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
  checkpoint?: { throughSeq: number; prunedTotal: number };
  head: { seq: number; hash: string };
  problems: ChainProblem[];
}

export interface VerifyOptions {
  expect?: { seq: number; hash: string };
}

export interface ErasureLedger {
  append(input: LedgerRecordInput): Promise<LedgerEntry>;
  entries(): Promise<LedgerEntry[]>;
  verifyChain(opts?: VerifyOptions): Promise<ChainReport>;
  checkpoint(): Promise<LedgerCheckpoint | null>;
  prune(cutoff: Date, limit: number): Promise<number>;
}

export const GENESIS_HASH = '0'.repeat(64);

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

export function checkpointValid(cp: LedgerCheckpoint, hmacKey: string | undefined): boolean {
  if (!hmacKey) return false;
  const { signature, ...rest } = cp;
  const want = Buffer.from(signCheckpoint(rest, hmacKey).signature);
  const given = Buffer.from(String(signature));
  return want.length === given.length && timingSafeEqual(want, given);
}

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

export function checkChain(entries: LedgerEntry[], opts: VerifyOptions = {}, extra: ChainProblem[] = [], checkpoint?: { value: LedgerCheckpoint; hmacKey: string | undefined } | null): ChainReport {
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

/** Tests and the local host. `rows` is public so a test can tamper with it. */
export class MemoryLedger implements ErasureLedger {
  rows: LedgerEntry[] = [];
  failNext = 0;
  cp: LedgerCheckpoint | null = null;
  constructor(private readonly hmacKey?: string) {}

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
    if (!this.hmacKey) throw new Error('ledger: pruning needs the signing key');
    this.cp = nextCheckpoint(removed, this.cp, new Date(), this.hmacKey);
    this.rows = this.rows.slice(removed.length);
    return removed.length;
  }
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
export const AZURE_PRUNE_BATCH = 45;
const PARTITION = 'chain';
const HEAD_KEY = 'head';
const rowKeyOf = (seq: number) => `r${String(seq).padStart(12, '0')}`;
const statusOf = (e: unknown) => (e as { statusCode?: number }).statusCode;
const CONFLICT = new Set([409, 412]);

/**
 * One partition holds the chain, so each append is one entity-group transaction: the record, a
 * marker per request id (idempotence) and the head with an ETag condition (two workers cannot both
 * extend the same head; the loser re-reads and tries again).
 */
export class AzureTableLedger implements ErasureLedger {
  constructor(
    private readonly client: TableClientLike,
    private readonly hmacKey?: string,
    private readonly attempts = 6,
    private readonly backoffMs = 200,
  ) {}

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
    if (!this.hmacKey) throw new Error('ledger: pruning needs the signing key');
    const existing = await this.checkpointEntity();
    const previous = existing ? (JSON.parse(existing.record) as LedgerCheckpoint) : null;
    const cp = nextCheckpoint(removed, previous, new Date(), this.hmacKey);
    const entity = { partitionKey: PARTITION, rowKey: CHECKPOINT_KEY, record: canonicalJson(cp) };
    const actions: unknown[] = [existing ? ['update', entity, 'Replace', { etag: existing.etag }] : ['create', entity]];
    for (const e of removed) actions.push(['delete', { partitionKey: PARTITION, rowKey: rowKeyOf(e.seq) }], ['delete', { partitionKey: PARTITION, rowKey: `q${e.requestId}` }]);
    await this.client.submitTransaction(actions);
    return removed.length;
  }
}

/**
 * Also writes each record, once, to a blob container with an immutability policy (set in the
 * infrastructure): the table can be changed by whoever can write to it, the container cannot.
 * A failed copy fails the append; the queue retries it and the same request id finds its record.
 */
export class LedgerWithCopy implements ErasureLedger {
  constructor(
    private readonly inner: ErasureLedger,
    private readonly copy: { putNew(name: string, body: string): Promise<boolean> },
  ) {}

  async append(input: LedgerRecordInput): Promise<LedgerEntry> {
    const entry = await this.inner.append(input);
    await this.copy.putNew(`ledger/${String(entry.seq).padStart(12, '0')}.json`, canonicalJson(entry));
    return entry;
  }
  entries() {
    return this.inner.entries();
  }
  verifyChain(opts?: VerifyOptions) {
    return this.inner.verifyChain(opts);
  }
  checkpoint() {
    return this.inner.checkpoint();
  }
  prune(cutoff: Date, limit: number) {
    return this.inner.prune(cutoff, limit);
  }
}
