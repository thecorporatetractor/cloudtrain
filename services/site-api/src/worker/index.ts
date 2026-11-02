import { app, type InvocationContext } from '@azure/functions';
import type { Log } from '../model.js';
import { backupWaitlist, runRetention } from './retention.js';
import { handleMessage, sweepRequests } from './requests.js';
import { workerParts, type WorkerParts } from './wiring.js';

/*
 * The worker Function app: a separate deployable with a separate identity and no public inbound.
 * Registers one queue trigger and three timers. The queue message is retried by the platform when
 * the handler throws (host.json), and lands in `<queue>-poison` after that; the hourly sweep still
 * finishes a verified request from its saved state.
 */

let parts: WorkerParts | undefined;
const logOf = (c: InvocationContext): Log => ({ info: (o, m) => c.log(m, JSON.stringify(o)), warn: (o, m) => c.warn(m, JSON.stringify(o)) });
const get = (c: InvocationContext) => {
  parts ??= workerParts(process.env, logOf(c));
  return parts;
};
/** The clients are shared between invocations; the log belongs to each one. */
const withLog = (c: InvocationContext) => {
  const p = get(c);
  return { ...p, requests: { ...p.requests, log: logOf(c) } };
};

app.storageQueue('privacyQueue', {
  queueName: '%SITE_QUEUE_NAME%',
  connection: 'SITE_STORAGE',
  handler: async (message, c) => handleMessage(message, withLog(c).requests),
});

app.timer('requestSweep', {
  schedule: '0 7 * * * *',
  handler: async (_t, c) => {
    const { requests } = withLog(c);
    requests.log.info(await sweepRequests(requests), 'privacy sweep');
  },
});

app.timer('retention', {
  schedule: '0 15 3 * * *',
  handler: async (_t, c) => {
    const { requests, ledgerCopy } = withLog(c);
    await runRetention({ ...requests, ...(ledgerCopy ? { ledgerCopy } : {}) });
  },
});

app.timer('waitlistBackup', {
  schedule: '0 30 2 * * *',
  handler: async (_t, c) => {
    const { requests, backups } = withLog(c);
    const r = await backupWaitlist(requests.waitlistTable, backups, requests.now());
    requests.log.info({ rows: r.rows, name: r.name, written: r.written }, 'waitlist backup');
  },
});
