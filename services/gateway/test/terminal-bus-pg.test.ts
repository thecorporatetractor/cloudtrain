import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { isBusMessage, type BusMessage } from '../src/terminal/hub.js';
import {
  MAX_IN_FLIGHT,
  PgTerminalBus,
  REPLAY_WINDOW_MS,
  ReplayGuard,
  TERMINAL_CHANNEL,
  openBusMessage,
  openBusPayload,
  sealBusMessage,
  sealBusPayload,
} from '../src/terminal/pgbus.js';
import { OWNER_URL, pgAvailable } from './pg.js';

const available = await pgAvailable();
const opts = { secret: 'test-terminal-bus-secret' };

describe('terminal bus payloads', () => {
  it('are sealed: another key neither reads nor forges them', () => {
    const k1 = Buffer.alloc(32, 1);
    const k2 = Buffer.alloc(32, 2);
    const sealed = sealBusPayload(k1, '{"secret":"output"}');
    expect(sealed).not.toContain('output');
    expect(openBusPayload(k1, sealed)).toBe('{"secret":"output"}');
    expect(openBusPayload(k2, sealed)).toBeUndefined();
    expect(openBusPayload(k1, '{"k":"out","s":"x","d":"aGk=","from":"y"}')).toBeUndefined();
    const raw = Buffer.from(sealed, 'base64');
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 1, raw.length - 1);
    expect(openBusPayload(k1, raw.toString('base64'))).toBeUndefined();
  });

  it('are fresh: old, future and replayed messages are dropped', () => {
    const key = Buffer.alloc(32, 3);
    let now = 1_000_000;
    const guard = new ReplayGuard(REPLAY_WINDOW_MS, () => now);
    const notice: BusMessage = { k: 'notice', s: 's', n: { kind: 'observed', active: false } as never, from: 'a' };
    const sealed = sealBusMessage(key, notice, now);
    expect(openBusMessage(key, sealed, guard)).toEqual(notice);
    // A captured payload replayed within the window: seen already.
    expect(openBusMessage(key, sealed, guard)).toBeUndefined();
    // Sent too long ago, or too far ahead.
    expect(openBusMessage(key, sealBusMessage(key, notice, now - REPLAY_WINDOW_MS - 1), guard)).toBeUndefined();
    expect(openBusMessage(key, sealBusMessage(key, notice, now + REPLAY_WINDOW_MS + 1), guard)).toBeUndefined();
    expect(openBusMessage(key, sealBusMessage(key, notice, now - 1000), guard)).toEqual(notice);
    // Replayed after the window: too old, though its IV was forgotten.
    now += 3 * REPLAY_WINDOW_MS;
    expect(openBusMessage(key, sealed, guard)).toBeUndefined();
    expect(guard.size).toBe(0);
    // A sealed message without a send time (the old format) is refused.
    expect(openBusMessage(key, sealBusPayload(key, JSON.stringify(notice)), guard)).toBeUndefined();
  });

  it('are checked for shape', () => {
    expect(isBusMessage({ k: 'out', s: 's', d: 'aGk=', from: 'a' })).toBe(true);
    expect(isBusMessage({ k: 'back', s: 's', d: '', from: 'a', to: 'b', r: 'r', last: true })).toBe(true);
    expect(isBusMessage({ k: 'out', s: 's', from: 'a' })).toBe(false);
    expect(isBusMessage({ k: 'back', s: 's', d: '', from: 'a', to: 'b', r: 'r' })).toBe(false);
    expect(isBusMessage({ k: 'notice', s: 's', from: 'a' })).toBe(false);
    expect(isBusMessage({ k: 'nope', s: 's', from: 'a' })).toBe(false);
    expect(isBusMessage(null)).toBe(false);
    expect(isBusMessage('x')).toBe(false);
  });

  it('bounds the notifies in flight on a stalled connection: output is dropped, control messages still go', async () => {
    const bus = await PgTerminalBus.start('postgres://127.0.0.1:1/none', { ...opts, log: { warn: () => undefined } });
    let queued = 0;
    // A connection that never answers.
    (bus as unknown as { client: unknown }).client = { query: () => (queued++, new Promise(() => undefined)) };
    for (let i = 0; i < MAX_IN_FLIGHT * 4; i++) bus.publish({ k: 'out', s: 's', d: 'aGk=', from: bus.id });
    expect(queued).toBe(MAX_IN_FLIGHT);
    bus.publish({ k: 'notice', s: 's', n: { kind: 'observed', at: '', by: 'x' } as never, from: bus.id });
    expect(queued).toBe(MAX_IN_FLIGHT + 1);
    expect(bus.pending).toBe(MAX_IN_FLIGHT + 1);
    (bus as unknown as { client: unknown }).client = undefined;
    await bus.close();
  });
});

describe.skipIf(!available)('terminal bus over Postgres LISTEN/NOTIFY', () => {
  it('delivers a replica\'s messages to the others, not to itself', async () => {
    const a = await PgTerminalBus.start(OWNER_URL, opts);
    const b = await PgTerminalBus.start(OWNER_URL, opts);
    const atA: BusMessage[] = [];
    const atB: BusMessage[] = [];
    a.subscribe((m) => atA.push(m));
    b.subscribe((m) => atB.push(m));
    try {
      a.publish({ k: 'watch', s: 's1', from: a.id, r: 'r1' });
      a.publish({ k: 'out', s: 's1', d: Buffer.from('hello').toString('base64'), from: a.id });
      for (let i = 0; i < 100 && atB.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
      expect(atB.map((m) => m.k)).toEqual(['watch', 'out']);
      expect(atA).toEqual([]);
      // Too large for NOTIFY: dropped instead of failing the connection.
      a.publish({ k: 'out', s: 's1', d: 'x'.repeat(9000), from: a.id });
      // Payloads on the channel are sealed; a role without the key reads
      // nothing, and what it sends (forged or malformed) is ignored.
      const spy = new pg.Client({ connectionString: OWNER_URL });
      await spy.connect();
      const seen: string[] = [];
      spy.on('notification', (n) => seen.push(n.payload ?? ''));
      await spy.query(`LISTEN ${TERMINAL_CHANNEL}`);
      a.publish({ k: 'out', s: 's1', d: Buffer.from('top secret').toString('base64'), from: a.id });
      await spy.query('SELECT pg_notify($1, $2)', [TERMINAL_CHANNEL, JSON.stringify({ k: 'notice', s: 's1', n: {}, from: 'forged' })]);
      await spy.query('SELECT pg_notify($1, $2)', [TERMINAL_CHANNEL, 'not json']);
      for (let i = 0; i < 100 && (seen.length < 3 || atB.length < 3); i++) await new Promise((r) => setTimeout(r, 20));
      // Replaying a captured sealed payload delivers nothing.
      await spy.query('SELECT pg_notify($1, $2)', [TERMINAL_CHANNEL, seen[0]]);
      for (let i = 0; i < 100 && seen.length < 4; i++) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 100));
      await spy.end();
      // The first notification the spy saw is a's sealed output.
      expect(seen[0]).toBeDefined();
      expect(seen[0]).not.toContain(Buffer.from('top secret').toString('base64'));
      expect(() => JSON.parse(seen[0]!) as unknown).toThrow();
      expect(atB.map((m) => m.k)).toEqual(['watch', 'out', 'out']);
      b.publish({ k: 'unwatch', s: 's1', from: b.id });
      for (let i = 0; i < 100 && atA.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
      expect(atA.map((m) => m.k)).toEqual(['unwatch']);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
