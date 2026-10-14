import type { WebSocket } from 'ws';
import type { SessionNotice } from '@cloudtrain/api-types';
import { send } from './bridge.js';

const SCROLLBACK = 64 * 1024;

/**
 * Read-only shadowing within this gateway process: learner terminals of a
 * session publish their output here; observers (instructor/admin, `?observe=1`)
 * receive a copy plus the recent scrollback, and their input is never
 * forwarded. Learner sockets get `notice` frames when someone starts or stops
 * watching.
 */
export class TerminalHub {
  private readonly learners = new Map<string, Set<WebSocket>>();
  private readonly observers = new Map<string, Set<WebSocket>>();
  private readonly scrollback = new Map<string, Buffer>();

  /** Returns the tap to pass to bridge() for a learner's terminal. */
  addLearner(session: string, ws: WebSocket): (chunk: Buffer) => void {
    const set = this.learners.get(session) ?? new Set();
    set.add(ws);
    this.learners.set(session, set);
    ws.on('close', () => {
      set.delete(ws);
      if (!set.size) this.learners.delete(session);
    });
    return (chunk) => {
      const prev = this.scrollback.get(session) ?? Buffer.alloc(0);
      const next = Buffer.concat([prev, chunk]);
      this.scrollback.set(session, next.length > SCROLLBACK ? next.subarray(next.length - SCROLLBACK) : next);
      for (const o of this.observers.get(session) ?? []) if (o.readyState === o.OPEN) o.send(chunk, { binary: true });
    };
  }

  addObserver(session: string, ws: WebSocket, onClose: () => void): void {
    const set = this.observers.get(session) ?? new Set();
    set.add(ws);
    this.observers.set(session, set);
    const back = this.scrollback.get(session);
    send(ws, { t: 'observe', readOnly: true, m: this.learners.has(session) ? 'Watching the learner terminal (read-only).' : 'Waiting for the learner to open a terminal (read-only).' });
    if (back?.length) ws.send(back, { binary: true });
    ws.on('message', () => undefined); // input is dropped: read-only
    ws.on('close', () => {
      set.delete(ws);
      if (!set.size) this.observers.delete(session);
      onClose();
    });
  }

  notifyLearner(session: string, notice: SessionNotice): void {
    for (const ws of this.learners.get(session) ?? []) send(ws, { t: 'notice', notice });
  }

  observerCount(session: string): number {
    return this.observers.get(session)?.size ?? 0;
  }
}
