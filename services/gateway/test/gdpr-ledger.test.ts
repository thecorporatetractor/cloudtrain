import { describe, expect, it, vi } from 'vitest';
import { AzureTableLedger, canonicalJson, checkChain, createLedger, GENESIS_HASH, hashRecord, MemoryLedger, nextCheckpoint, signCheckpoint, type LedgerRecordInput, type TableClientLike } from '../src/gdpr/ledger.js';
import { issueToken, normaliseEmail, subjectKey, tokenHash, userKey, verifyToken } from '../src/gdpr/subject.js';
import { DEFAULT_RETENTION, monthsBefore, retentionConfig } from '../src/gdpr/retention.js';
import { loadConfig } from '../src/config.js';

const KEY = 'unit-test-key-0123456789abcdef';
const rec = (n: number, over: Partial<LedgerRecordInput> = {}): LedgerRecordInput => ({
  requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  type: 'erasure',
  scope: 'waitlist',
  subjectKey: subjectKey(`p${n}@example.org`, KEY),
  dataCategories: ['waitlist'],
  outcomes: [{ system: 'waitlist', category: 'waitlist', action: 'deleted', rows: 1 }],
  requestedAt: '2026-01-01T00:00:00.000Z',
  verifiedAt: '2026-01-01T00:01:00.000Z',
  completedAt: '2026-01-01T00:02:00.000Z',
  actor: 'self',
  ...over,
});

describe('subject keys and links', () => {
  it('keys the normalised address: case and spaces do not matter, the key does', () => {
    expect(subjectKey(' Ada@Example.COM ', KEY)).toBe(subjectKey('ada@example.com', KEY));
    expect(subjectKey('ada@example.com', KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(subjectKey('ada@example.com', 'another-key-0123456789abcdef')).not.toBe(subjectKey('ada@example.com', KEY));
    expect(normaliseEmail(' A@B.io ')).toBe('a@b.io');
    expect(userKey('u1', KEY)).not.toBe(subjectKey('u1', KEY));
  });

  it('accepts its own link until it expires; refuses a forged, altered or foreign one', () => {
    const exp = new Date(Date.parse('2026-06-01T00:00:00Z'));
    const t = issueToken('req-1', exp, KEY);
    expect(verifyToken(t, exp.getTime() - 1, KEY)).toEqual({ requestId: 'req-1' });
    expect(verifyToken(t, exp.getTime(), KEY)).toBeNull();
    expect(verifyToken(t, exp.getTime() - 1, 'other-key-0123456789abcdef')).toBeNull();
    const parts = t.split('.');
    parts[2] = String(exp.getTime() + 1e9);
    expect(verifyToken(parts.join('.'), exp.getTime() - 1, KEY)).toBeNull();
    expect(verifyToken(undefined, 0, KEY)).toBeNull();
    expect(verifyToken('v1.x', 0, KEY)).toBeNull();
    expect(tokenHash(t)).not.toContain(parts[3]);
  });
});

describe('the hash chain', () => {
  it('canonical JSON does not depend on key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }));
  });

  it('links each record to the one before, starting at the genesis', async () => {
    const l = new MemoryLedger();
    const a = await l.append(rec(1));
    const b = await l.append(rec(2));
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.hash);
    expect(b.seq).toBe(2);
    expect(await l.verifyChain()).toMatchObject({ ok: true, count: 2, head: { seq: 2, hash: b.hash } });
  });

  it('answers a repeated request id with the record it has: a retry cannot double the evidence', async () => {
    const l = new MemoryLedger();
    const a = await l.append(rec(1));
    expect(await l.append(rec(1))).toEqual(a);
    expect(l.rows).toHaveLength(1);
  });

  it('detects a changed record', async () => {
    const l = new MemoryLedger();
    for (const n of [1, 2, 3]) await l.append(rec(n));
    l.rows[1] = { ...l.rows[1]!, outcomes: [{ system: 'waitlist', category: 'waitlist', action: 'deleted', rows: 99 }] };
    const r = await l.verifyChain();
    expect(r.ok).toBe(false);
    expect(r.problems).toContainEqual({ seq: 2, kind: 'hash_mismatch' });
  });

  it('detects a removed record, a rewritten record and reordering', async () => {
    const l = new MemoryLedger();
    for (const n of [1, 2, 3]) await l.append(rec(n));
    const all = [...l.rows];
    expect(checkChain([all[0]!, all[2]!]).problems.map((p) => p.kind)).toEqual(expect.arrayContaining(['sequence_gap', 'prev_hash_mismatch']));
    expect(checkChain([all[1]!, all[0]!, all[2]!]).ok).toBe(false);
    const forged = { ...all[1]!, subjectKey: subjectKey('other@example.org', KEY) };
    forged.hash = hashRecord(forged); // recomputed, but the next record still points at the old one
    expect(checkChain([all[0]!, forged, all[2]!]).problems).toContainEqual({ seq: 3, kind: 'prev_hash_mismatch' });
  });

  it('sees the newest records cut off only against a head noted elsewhere: the limit is stated in docs/gdpr.md', async () => {
    const l = new MemoryLedger();
    for (const n of [1, 2, 3]) await l.append(rec(n));
    const head = { seq: 3, hash: l.rows[2]!.hash };
    const cut = l.rows.slice(0, 2);
    expect(checkChain(cut).ok).toBe(true);
    expect(checkChain(cut, { expect: head }).problems).toContainEqual({ seq: 3, kind: 'head_mismatch' });
  });

  it('refuses a record with an address or a key that is not a keyed hash', async () => {
    const l = new MemoryLedger();
    await expect(l.append(rec(1, { reason: 'ada@example.org' }))).rejects.toThrow(/email/);
    await expect(l.append(rec(1, { subjectKey: 'ada@example.org' }))).rejects.toThrow(/HMAC/);
    await expect(l.append(rec(1, { outcomes: [{ system: 'x@y.io', category: 'c', action: 'none', rows: 0 }] }))).rejects.toThrow(/email/);
  });
});

describe('pruning under a signed checkpoint', () => {
  const old = (n: number) => rec(n, { completedAt: '2020-01-01T00:00:00.000Z' });

  it('keeps verification whole after pruning, and the chain carries on', async () => {
    const l = new MemoryLedger(KEY);
    for (const n of [1, 2, 3]) await l.append(old(n));
    await l.append(rec(4, { completedAt: '2026-01-01T00:00:00.000Z' }));
    expect(await l.prune(new Date('2023-01-01'), 100)).toBe(3);
    const r = await l.verifyChain();
    expect(r).toMatchObject({ ok: true, count: 1, checkpoint: { throughSeq: 3, prunedTotal: 3 }, head: { seq: 4 } });
    const next = await l.append(rec(5));
    expect(next.prevHash).toBe(l.rows[0]!.hash);
    expect((await l.verifyChain()).ok).toBe(true);
    expect(await l.prune(new Date('2023-01-01'), 100)).toBe(0);
  });

  it('carries on from the checkpoint even when every record was pruned', async () => {
    const l = new MemoryLedger(KEY);
    const a = await l.append(old(1));
    await l.prune(new Date('2023-01-01'), 100);
    const b = await l.append(rec(2));
    expect(b).toMatchObject({ seq: 2, prevHash: a.hash });
    expect((await l.verifyChain()).ok).toBe(true);
  });

  it('prunes an unbroken prefix only, and only as many as asked', async () => {
    const l = new MemoryLedger(KEY);
    await l.append(old(1));
    await l.append(rec(2, { completedAt: '2026-01-01T00:00:00.000Z' }));
    await l.append(old(3));
    expect(await l.prune(new Date('2023-01-01'), 100)).toBe(1);
    expect(l.rows.map((e) => e.seq)).toEqual([2, 3]);
  });

  it('detects a removed or forged checkpoint', async () => {
    const l = new MemoryLedger(KEY);
    for (const n of [1, 2]) await l.append(old(n));
    await l.append(rec(3));
    await l.prune(new Date('2023-01-01'), 1);
    const cp = l.cp!;
    l.cp = null;
    expect((await l.verifyChain()).ok).toBe(false);
    l.cp = signCheckpoint({ ...cp, signature: undefined } as never, 'someone-elses-key-0123456789');
    expect((await l.verifyChain()).problems).toContainEqual({ seq: cp.throughSeq, kind: 'checkpoint_invalid' });
    l.cp = { ...cp, throughSeq: 0 };
    expect((await l.verifyChain()).ok).toBe(false);
  });

  it('a checkpoint signed by an older key verifies while that key is held', async () => {
    const l = new MemoryLedger(KEY);
    await l.append(old(1));
    await l.prune(new Date('2023-01-01'), 1);
    const rotated = new MemoryLedger(['new-key-0123456789abcdef0123456789', KEY]);
    rotated.cp = l.cp;
    expect((await rotated.verifyChain()).ok).toBe(true);
    const lost = new MemoryLedger('new-key-0123456789abcdef0123456789');
    lost.cp = l.cp;
    expect((await lost.verifyChain()).problems[0]).toMatchObject({ kind: 'checkpoint_invalid' });
  });

  it('a checkpoint signs its position', () => {
    const cp = nextCheckpoint([{ ...old(1), version: 1, seq: 1, prevHash: GENESIS_HASH, hash: 'a'.repeat(64) }], null, new Date('2026-01-01'), KEY);
    expect(cp).toMatchObject({ throughSeq: 1, prunedTotal: 1 });
    expect(cp.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

/* A TableClient over a map, with ETags and atomic transactions. Never talks to Azure. */
class FakeTable implements TableClientLike {
  rows = new Map<string, Record<string, unknown>>();
  etag = 0;
  txCount = 0;
  /** The next transaction loses a race, as if another gateway extended the head first. */
  conflictNext = 0;
  async getEntity<T extends object>(pk: string, rk: string) {
    const r = this.rows.get(`${pk}/${rk}`);
    if (!r) throw Object.assign(new Error('not found'), { statusCode: 404 });
    return { ...r } as T & { etag?: string };
  }
  async *listEntities<T extends object>() {
    for (const [k, v] of [...this.rows].sort(([a], [b]) => a.localeCompare(b))) {
      const rk = k.split('/')[1]!;
      if (rk >= 'r' && rk < 's') yield { ...v } as T & { etag?: string };
    }
  }
  async submitTransaction(actions: unknown[]) {
    this.txCount++;
    if (this.conflictNext > 0) {
      this.conflictNext--;
      throw Object.assign(new Error('precondition failed'), { statusCode: 412 });
    }
    const next = new Map(this.rows);
    for (const a of actions as [string, Record<string, unknown>, string?, { etag?: string }?][]) {
      const [kind, e, , opts] = a;
      const k = `${e.partitionKey as string}/${e.rowKey as string}`;
      if (kind === 'create' && next.has(k)) throw Object.assign(new Error('exists'), { statusCode: 409 });
      if (kind === 'update' && next.get(k)?.etag !== opts?.etag) throw Object.assign(new Error('etag'), { statusCode: 412 });
      if (kind === 'delete') next.delete(k);
      else next.set(k, { ...e, etag: `e${++this.etag}` });
    }
    this.rows = next;
  }
}

const sdk = vi.hoisted(() => ({ tableCtor: vi.fn(), credCtor: vi.fn() }));
vi.mock('@azure/data-tables', () => ({
  TableClient: class {
    constructor(...args: unknown[]) {
      sdk.tableCtor(...args);
    }
  },
}));
vi.mock('@azure/identity', () => ({
  ManagedIdentityCredential: class {
    constructor(...args: unknown[]) {
      sdk.credCtor(...args);
    }
  },
}));

describe('AzureTableLedger (the SDK is mocked: never run against real Azure here)', () => {
  it('connects with the managed identity: no key and no connection string', async () => {
    const l = await createLedger({ tableUrl: 'https://acct.table.core.windows.net', table: 'gdprledger', clientId: 'uami-client-id' }, null as never, KEY);
    expect(l).toBeInstanceOf(AzureTableLedger);
    expect(sdk.credCtor).toHaveBeenCalledWith({ clientId: 'uami-client-id' });
    const [url, table, cred] = sdk.tableCtor.mock.calls[0]!;
    expect(url).toBe('https://acct.table.core.windows.net');
    expect(table).toBe('gdprledger');
    expect(cred).toBeInstanceOf((await import('@azure/identity')).ManagedIdentityCredential);
  });

  it('refuses a half-made configuration rather than falling back to Postgres', async () => {
    await expect(createLedger({ tableUrl: 'https://a.table.core.windows.net' }, null as never)).rejects.toThrow(/CT_GDPR_LEDGER_TABLE/);
    await expect(createLedger({ tableUrl: 'https://a.table.core.windows.net', table: 't' }, null as never)).rejects.toThrow(/AZURE_CLIENT_ID/);
    await expect(createLedger({ tableUrl: 'http://a', table: 't', clientId: 'c' }, null as never)).rejects.toThrow(/https/);
  });

  it('appends in one transaction with the head, idempotently, and verifies', async () => {
    const t = new FakeTable();
    const l = new AzureTableLedger(t, 3, 1, KEY);
    const a = await l.append(rec(1));
    const b = await l.append(rec(2));
    expect(b.prevHash).toBe(a.hash);
    expect(t.txCount).toBe(2);
    expect(await l.append(rec(2))).toEqual(b);
    expect(t.txCount).toBe(2);
    expect(await l.verifyChain()).toMatchObject({ ok: true, count: 2, head: { seq: 2, hash: b.hash } });
  });

  it('retries when another writer won the head, and surfaces the failure when it never gets through', async () => {
    const t = new FakeTable();
    const l = new AzureTableLedger(t, 3, 1, KEY);
    await l.append(rec(1));
    t.conflictNext = 2;
    expect((await l.append(rec(2))).seq).toBe(2);
    t.conflictNext = 3;
    await expect(l.append(rec(3))).rejects.toMatchObject({ statusCode: 412 });
    expect((await l.verifyChain()).ok).toBe(true);
  });

  it('detects tampering: a changed record, a removed record, a record cut off the end', async () => {
    const make = async () => {
      const t = new FakeTable();
      const l = new AzureTableLedger(t, 3, 1, KEY);
      for (const n of [1, 2, 3]) await l.append(rec(n));
      return { t, l };
    };
    const a = await make();
    const row = a.t.rows.get('chain/r000000000002')!;
    a.t.rows.set('chain/r000000000002', { ...row, record: String(row.record).replace('"rows":1', '"rows":9') });
    expect((await a.l.verifyChain()).ok).toBe(false);
    const b = await make();
    b.t.rows.delete('chain/r000000000002');
    expect((await b.l.verifyChain()).ok).toBe(false);
    const c = await make();
    c.t.rows.delete('chain/r000000000003');
    expect((await c.l.verifyChain()).problems.map((p) => p.kind)).toContain('head_mismatch');
  });

  it('holds no address in any entity', async () => {
    const t = new FakeTable();
    await new AzureTableLedger(t, 3, 1, KEY).append(rec(1));
    expect(JSON.stringify([...t.rows.values()])).not.toContain('@');
  });

  it('prunes under a checkpoint, in one transaction per batch, and carries on', async () => {
    const t = new FakeTable();
    const l = new AzureTableLedger(t, 3, 1, KEY);
    for (const n of [1, 2]) await l.append(rec(n, { completedAt: '2020-01-01T00:00:00.000Z' }));
    await l.append(rec(3));
    expect(await l.prune(new Date('2023-01-01'), 100)).toBe(2);
    expect(t.rows.has('chain/r000000000001')).toBe(false);
    expect(t.rows.has(`chain/q${rec(1).requestId}`)).toBe(false);
    expect(await l.verifyChain()).toMatchObject({ ok: true, count: 1, checkpoint: { throughSeq: 2 } });
    expect((await l.append(rec(4))).seq).toBe(4);
    expect((await l.verifyChain()).ok).toBe(true);
    t.rows.delete('chain/checkpoint');
    expect((await l.verifyChain()).ok).toBe(false);
  });
});

describe('configuration', () => {
  it('has a dev key out of production and none in production: main.ts then refuses to start', () => {
    expect(loadConfig({}).gdpr.hmacKey).toMatch(/^dev-only/);
    const prod = { NODE_ENV: 'production' };
    expect(loadConfig(prod).gdpr.hmacKey).toBe('');
    expect(loadConfig({ ...prod, CT_GDPR_HMAC_KEY: 'k'.repeat(40) }).gdpr.hmacKey).toBe('k'.repeat(40));
  });

  it('reads the ledger settings', () => {
    expect(loadConfig({ CT_GDPR_LEDGER_TABLE_URL: 'https://a', CT_GDPR_LEDGER_TABLE: 't', AZURE_CLIENT_ID: 'c' }).gdpr.ledger).toEqual({ tableUrl: 'https://a', table: 't', clientId: 'c' });
    expect(loadConfig({}).gdpr.ledger).toEqual({});
  });

  it('retention defaults, overrides, 0 to turn off, and refusals', () => {
    expect(retentionConfig({})).toEqual(DEFAULT_RETENTION);
    expect(retentionConfig({ CT_RETENTION_WAITLIST_MONTHS: '6', CT_RETENTION_AUDIT_MONTHS: '0', CT_RETENTION_SWEEP_MS: '0' })).toMatchObject({ waitlistMonths: 6, auditMonths: 0, sweepMs: 0 });
    expect(() => retentionConfig({ CT_RETENTION_WAITLIST_MONTHS: 'soon' })).toThrow(/whole number/);
    expect(() => retentionConfig({ CT_RETENTION_LEDGER_MONTHS: '3' })).toThrow(/at least 12/);
    expect(retentionConfig({ CT_RETENTION_LEDGER_MONTHS: '0' }).ledgerMonths).toBe(0);
  });

  it('counts months by the calendar, clamped to shorter months', () => {
    expect(monthsBefore(new Date('2026-11-02T03:00:00Z'), 24).toISOString()).toBe('2024-11-02T03:00:00.000Z');
    expect(monthsBefore(new Date('2026-03-31T00:00:00Z'), 13).toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });
});
