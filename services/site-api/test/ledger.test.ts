import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { filterOf } from '../src/azure/tables.js';
import { AzureTableLedger, buildEntry, canonicalJson, checkChain, checkpointValid, GENESIS_HASH, LedgerWithCopy, MemoryLedger, signCheckpoint, type LedgerRecordInput } from '../src/ledger.js';
import { subjectKey, tokenHash } from '../src/subject.js';
import { FakeLedgerClient, MemoryBlobs } from './fakes.js';

const HMAC = 'golden-test-key';

/** Produced by services/gateway/src/gdpr/ledger.ts and subject.ts on feat/gdpr-rights (93f08f3a). The two must stay equal. */
const GOLDEN = {
  key: 'cd98b553ef1df57f0574b8acb2c5e7ebc5fa1e99f67b9486395ade52ad34c4ef',
  hash: '26f387b1a0cc5b052cd84b2af40819ee83d56eabb88f56ae287c27e766038f3e',
  signature: 'ccd38f447806f5c772054eb19747e333f61cb74625764f58a1682d0a0c8335a2',
  tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  canonical:
    '{"actor":"self","completedAt":"2026-11-01T10:05:01.000Z","dataCategories":["waitlist","backups"],"hash":"26f387b1a0cc5b052cd84b2af40819ee83d56eabb88f56ae287c27e766038f3e","outcomes":[{"action":"deleted","category":"waitlist","rows":1,"system":"waitlist"},{"action":"expires","category":"backups","legalBasis":"x","rows":0,"system":"backups"}],"prevHash":"0000000000000000000000000000000000000000000000000000000000000000","requestId":"11111111-2222-4333-8444-555555555555","requestedAt":"2026-11-01T10:00:00.000Z","scope":"waitlist","seq":1,"subjectKey":"cd98b553ef1df57f0574b8acb2c5e7ebc5fa1e99f67b9486395ade52ad34c4ef","type":"erasure","verifiedAt":"2026-11-01T10:05:00.000Z","version":1}',
};

const input = (over: Partial<LedgerRecordInput> = {}): LedgerRecordInput => ({
  requestId: '11111111-2222-4333-8444-555555555555',
  type: 'erasure',
  scope: 'waitlist',
  subjectKey: GOLDEN.key,
  dataCategories: ['waitlist', 'backups'],
  outcomes: [
    { system: 'waitlist', category: 'waitlist', action: 'deleted', rows: 1 },
    { system: 'backups', category: 'backups', action: 'expires', rows: 0, legalBasis: 'x' },
  ],
  requestedAt: '2026-11-01T10:00:00.000Z',
  verifiedAt: '2026-11-01T10:05:00.000Z',
  completedAt: '2026-11-01T10:05:01.000Z',
  actor: 'self',
  ...over,
});

describe('the same evidence as the gateway', () => {
  it('the subject key: normalised, under the same key', () => {
    expect(subjectKey('  Person@Example.COM ', HMAC)).toBe(GOLDEN.key);
    expect(tokenHash('abc')).toBe(GOLDEN.tokenHash);
  });

  it('a record: byte for byte', () => {
    const e = buildEntry(input(), 1, GENESIS_HASH);
    expect(e.hash).toBe(GOLDEN.hash);
    expect(canonicalJson(e)).toBe(GOLDEN.canonical);
  });

  it('a checkpoint: the same signature', () => {
    const cp = signCheckpoint({ version: 1, throughSeq: 1, throughHash: GOLDEN.hash, prunedTotal: 1, prunedAt: '2029-11-02T00:00:00.000Z', newestCompletedAt: '2026-11-01T10:05:01.000Z' }, HMAC);
    expect(cp.signature).toBe(GOLDEN.signature);
    expect(checkpointValid(cp, HMAC)).toBe(true);
    expect(checkpointValid(cp, 'other')).toBe(false);
  });
});

/** The vectors services/gateway/test/gdpr-ledger.test.ts also checks, from the file both read. */
describe('the ledger format shared with the gateway', () => {
  const golden = JSON.parse(readFileSync(new URL('../../gateway/test/ledger-golden.json', import.meta.url), 'utf8')) as {
    hmacKey: string;
    email: string;
    subjectKey: string;
    token: string;
    tokenHash: string;
    records: { input: LedgerRecordInput; hash: string; canonical: string }[];
    checkpoint: Parameters<typeof signCheckpoint>[0] & { signature: string };
  };

  it('the subject key and the token hash', () => {
    expect(subjectKey(golden.email, golden.hmacKey)).toBe(golden.subjectKey);
    expect(tokenHash(golden.token)).toBe(golden.tokenHash);
  });

  it('every record, byte for byte: erasure, objection, restricted, lifted, requested', () => {
    let prev = GENESIS_HASH;
    golden.records.forEach((r, i) => {
      const e = buildEntry(r.input, i + 1, prev);
      expect(e.hash).toBe(r.hash);
      expect(canonicalJson(e)).toBe(r.canonical);
      prev = e.hash;
    });
  });

  it('a checkpoint: the same signature', () => {
    const { signature, ...cp } = golden.checkpoint;
    expect(signCheckpoint(cp, golden.hmacKey).signature).toBe(signature);
  });
});

describe('a record refuses', () => {
  it('an email address anywhere, and a subject key that is not a keyed hash', () => {
    expect(() => buildEntry(input({ reason: 'person@example.com' }), 1, GENESIS_HASH)).toThrow(/email/);
    expect(() => buildEntry(input({ outcomes: [{ system: 'a@b.c', category: 'x', action: 'none', rows: 0 }] }), 1, GENESIS_HASH)).toThrow(/email/);
    expect(() => buildEntry(input({ subjectKey: 'person' }), 1, GENESIS_HASH)).toThrow(/HMAC/);
  });
});

describe('chain verification', () => {
  let l: MemoryLedger;
  beforeEach(async () => {
    l = new MemoryLedger(HMAC);
    for (const id of ['a', 'b', 'c']) await l.append(input({ requestId: id }));
  });

  it('a sound chain verifies; a repeated request id answers the record it wrote', async () => {
    expect(await l.verifyChain()).toMatchObject({ ok: true, count: 3 });
    const again = await l.append(input({ requestId: 'b' }));
    expect(again.seq).toBe(2);
    expect(l.rows).toHaveLength(3);
  });

  it('sees a changed, removed and reordered record, and a cut-off head', async () => {
    const changed = l.rows.map((r) => ({ ...r }));
    changed[1]!.subjectKey = 'b'.repeat(64);
    expect(checkChain(changed).problems.map((p) => p.kind)).toContain('hash_mismatch');
    expect(checkChain([l.rows[0]!, l.rows[2]!]).problems.map((p) => p.kind)).toContain('sequence_gap');
    expect(checkChain([l.rows[1]!, l.rows[0]!, l.rows[2]!]).ok).toBe(false);
    const { head } = await l.verifyChain();
    expect(checkChain(l.rows.slice(0, 2), { expect: head }).problems.map((p) => p.kind)).toContain('head_mismatch');
  });

  it('a forged checkpoint is refused', async () => {
    await l.prune(new Date('2030-01-01'), 1);
    l.cp = { ...l.cp!, prunedTotal: 0 };
    expect((await l.verifyChain()).problems.map((p) => p.kind)).toContain('checkpoint_invalid');
  });
});

describe('records only the gateway produces', () => {
  it('an objection and a restriction, with the newer actions, chain and verify here', async () => {
    const l = new MemoryLedger(HMAC);
    await l.append(input({ requestId: 'o', type: 'objection', outcomes: [{ system: 'audit', category: 'security', action: 'requested', rows: 0 }] }));
    await l.append(input({ requestId: 'r', type: 'restriction', outcomes: [{ system: 'waitlist', category: 'waitlist', action: 'restricted', rows: 1 }] }));
    await l.append(input({ requestId: 'x', type: 'restriction', outcomes: [{ system: 'waitlist', category: 'waitlist', action: 'lifted', rows: 1 }] }));
    expect(await l.verifyChain()).toMatchObject({ ok: true, count: 3 });
  });

  it('reapply ignores them: they erase nothing', async () => {
    const { reapplyErasures } = await import('../src/worker/retention.js');
    const { MemoryTable } = await import('./fakes.js');
    const l = new MemoryLedger(HMAC);
    await l.append(input({ requestId: 'o', type: 'objection' }));
    const table = new MemoryTable<never>();
    await expect(reapplyErasures({ waitlistTable: table, ledger: l, now: () => new Date() })).resolves.toMatchObject({ subjects: 0, erased: 0 });
  });
});

describe('the Azure layout', () => {
  let client: FakeLedgerClient;
  let l: AzureTableLedger;
  beforeEach(() => {
    client = new FakeLedgerClient();
    l = new AzureTableLedger(client, HMAC, 6, 0);
  });

  it('partition chain, r<12 digits> with the canonical record, q<request id>, head', async () => {
    const e = await l.append(input());
    expect(e.hash).toBe(GOLDEN.hash);
    const r = client.rows.get('chain/r000000000001')!;
    expect(r.record).toBe(GOLDEN.canonical);
    expect(client.rows.get(`chain/q${e.requestId}`)).toMatchObject({ seq: 1 });
    expect(client.rows.get('chain/head')).toMatchObject({ seq: 1, hash: GOLDEN.hash });
  });

  it('idempotent by request id, chained, verified', async () => {
    await l.append(input({ requestId: 'a' }));
    await l.append(input({ requestId: 'b' }));
    await l.append(input({ requestId: 'a' }));
    expect(client.transactions).toBe(2);
    expect(await l.verifyChain()).toMatchObject({ ok: true, count: 2, head: { seq: 2 } });
  });

  it('a lost race re-reads the head and extends it', async () => {
    await l.append(input({ requestId: 'a' }));
    const submit = client.submitTransaction.bind(client);
    let raced = false;
    client.submitTransaction = async (actions) => {
      if (!raced) {
        raced = true;
        await new AzureTableLedger({ getEntity: client.getEntity.bind(client), listEntities: client.listEntities.bind(client), submitTransaction: submit }, HMAC).append(input({ requestId: 'other' }));
      }
      return submit(actions);
    };
    const e = await l.append(input({ requestId: 'b' }));
    expect(e.seq).toBe(3);
    client.submitTransaction = submit;
    expect((await l.verifyChain()).ok).toBe(true);
  });

  it('sees a record cut off the end through the head entity', async () => {
    await l.append(input({ requestId: 'a' }));
    await l.append(input({ requestId: 'b' }));
    client.rows.delete('chain/r000000000002');
    expect((await l.verifyChain()).problems.map((p) => p.kind)).toContain('head_mismatch');
  });

  it('prunes under a signed checkpoint and carries on from the head', async () => {
    await l.append(input({ requestId: 'a' }));
    await l.append(input({ requestId: 'b', completedAt: '2030-01-01T00:00:00.000Z' }));
    expect(await l.prune(new Date('2028-01-01'), 45)).toBe(1);
    expect(client.rows.has('chain/r000000000001')).toBe(false);
    expect(client.rows.has('chain/qa')).toBe(false);
    expect(await l.verifyChain()).toMatchObject({ ok: true, count: 1, checkpoint: { throughSeq: 1, prunedTotal: 1 } });
    expect((await l.append(input({ requestId: 'c' }))).seq).toBe(3);
    expect((await l.verifyChain()).ok).toBe(true);
  });
});

describe('the immutable copy', () => {
  it('writes each record once under its position, including on a retry', async () => {
    const blobs = new MemoryBlobs();
    const l = new LedgerWithCopy(new MemoryLedger(HMAC), blobs);
    const e = await l.append(input());
    await l.append(input());
    expect([...blobs.files.keys()]).toEqual(['ledger/000000000001.json']);
    expect(blobs.files.get('ledger/000000000001.json')).toBe(canonicalJson(e));
  });

  it('a failed copy fails the append, so the queue retries it', async () => {
    const l = new LedgerWithCopy(new MemoryLedger(HMAC), {
      putNew: async () => {
        throw new Error('down');
      },
    });
    await expect(l.append(input())).rejects.toThrow('down');
  });
});

describe('table filters', () => {
  it('quote values, including a quote inside one, and refuse a strange property', () => {
    expect(filterOf({ equals: { subjectKey: "a'b" }, partitionFrom: '2026-11-02' })).toBe("subjectKey eq 'a''b' and PartitionKey ge '2026-11-02'");
    expect(filterOf({ before: { prop: 'expiresAt', at: '2026-11-02T00:00:00.000Z' } })).toBe("expiresAt lt '2026-11-02T00:00:00.000Z'");
    expect(filterOf(undefined)).toBeUndefined();
    expect(() => filterOf({ equals: { 'a or 1 eq 1': 'x' } })).toThrow();
  });
});
