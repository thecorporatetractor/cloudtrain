import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { QueueClient, QueueServiceClient } from '@azure/storage-queue';
import { BlobServiceClient } from '@azure/storage-blob';
import { TableClient } from '@azure/data-tables';
import { parse } from 'yaml';
import { tableNames, queueName } from '../src/config.js';
import type { MailMessage, Mailer } from '../src/mailer.js';
import type { Log } from '../src/model.js';
import { postPrivacyConfirm, postPrivacyRequest, postWaitlist, type ApiRequest, type ApiResponse } from '../src/public/handlers.js';
import { publicDeps } from '../src/public/wiring.js';
import { handleMessage, sweepRequests } from '../src/worker/requests.js';
import { backupWaitlist, reapplyErasures, restoreWaitlist, runRetention } from '../src/worker/retention.js';
import { workerParts } from '../src/worker/wiring.js';

/*
 * Runs both Function apps' real handlers in one process, against real storage SDKs and Azurite,
 * for the local integration run (docs/deploy-site-vm.md, "Local run"). It stands in for what the
 * platform does: Entra auth (a fixed bearer token), and the queue and timer triggers. Also a fake
 * IMDS, so the sidecar's token path is the real one. Never deployed.
 */

const env = process.env;
const port = Number(env.SITE_DEV_PORT ?? 16110);
const conn = env.SITE_STORAGE_CONNECTION_STRING;
if (!conn) throw new Error('SITE_STORAGE_CONNECTION_STRING must point at Azurite');
if (!/127\.0\.0\.1|localhost/.test(conn)) throw new Error('this host only runs against a local Azurite');

const TOKEN = 'local-dev-token';
const log: Log = { info: (o, m) => console.log(m, JSON.stringify(o)), warn: (o, m) => console.warn(m, JSON.stringify(o)) };

const sent: MailMessage[] = [];
const mailer: Mailer = {
  async send(m) {
    sent.push(m);
  },
};

const site = parse(readFileSync(new URL('../../../content/site.yaml', import.meta.url), 'utf8'));
const updated = site.legal.privacy.updated;
const consent = { labelHash: createHash('sha256').update(site.waitlist.consentLabel).digest('hex'), noticeUpdated: updated instanceof Date ? updated.toISOString().slice(0, 10) : String(updated), source: 'site-waitlist-form' };

const names = tableNames(env);
for (const t of [names.waitlist, names.intake, names.state, names.ledger]) await TableClient.fromConnectionString(conn, t, { allowInsecureConnection: true }).createTable();
const queue = queueName(env);
await QueueServiceClient.fromConnectionString(conn).getQueueClient(queue).createIfNotExists();
for (const c of [env.SITE_BACKUP_CONTAINER ?? 'waitlist-backup', ...(env.SITE_LEDGER_COPY_CONTAINER ? [env.SITE_LEDGER_COPY_CONTAINER] : [])]) await BlobServiceClient.fromConnectionString(conn).getContainerClient(c).createIfNotExists();

const pub = publicDeps(env, site.waitlist, consent, log);
const worker = workerParts(env, log, mailer);

const routes: Record<string, (r: ApiRequest, d: typeof pub) => Promise<ApiResponse>> = {
  '/api/public/waitlist': postWaitlist,
  '/api/public/privacy/requests': postPrivacyRequest,
  '/api/public/privacy/confirm': postPrivacyConfirm,
};

// The queue trigger: base64 messages, retried with the visibility timeout, as host.json says.
const consumer = new QueueClient(conn, queue);
let polling = true;
let failures = 0;
async function poll() {
  while (polling) {
    const { receivedMessageItems: items } = await consumer.receiveMessages({ numberOfMessages: 1, visibilityTimeout: 2 });
    const item = items[0];
    if (!item) {
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    try {
      await handleMessage(Buffer.from(item.messageText, 'base64').toString('utf8'), worker.requests);
      await consumer.deleteMessage(item.messageId, item.popReceipt);
    } catch (e) {
      failures++;
      console.warn('queue trigger failed', (e as Error).message);
      if (item.dequeueCount >= 5) await consumer.deleteMessage(item.messageId, item.popReceipt);
    }
  }
}
void poll();

const body = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (status: number, o: object, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(o));
  };
  try {
    if (url.pathname === '/metadata/identity/oauth2/token') {
      if (req.headers.metadata !== 'true' || !url.searchParams.get('client_id') || !url.searchParams.get('resource')) return send(400, { error: 'bad_request' });
      return send(200, { access_token: TOKEN, expires_on: String(Math.floor(Date.now() / 1000) + 3600), resource: url.searchParams.get('resource'), token_type: 'Bearer' });
    }
    if (url.pathname === '/__dev/mail') return send(200, { sent, failures });
    if (url.pathname.startsWith('/__dev/run/')) {
      const r = worker.requests;
      switch (url.pathname.slice('/__dev/run/'.length)) {
        case 'sweep':
          return send(200, await sweepRequests(r));
        case 'retention':
          return send(200, await runRetention({ ...r, ...(worker.ledgerCopy ? { ledgerCopy: worker.ledgerCopy } : {}) }));
        case 'backup':
          return send(200, await backupWaitlist(r.waitlistTable, worker.backups, r.now()));
        case 'reapply':
          return send(200, await reapplyErasures({ waitlistTable: r.waitlistTable, ledger: r.ledger, now: r.now }));
        case 'restore':
          return send(200, await restoreWaitlist(r.waitlistTable, worker.backups, url.searchParams.get('name') ?? ''));
        case 'verify':
          return send(200, await r.ledger.verifyChain());
      }
      return send(404, {});
    }
    const handler = routes[url.pathname];
    if (!handler || req.method !== 'POST') return send(404, { error: 'Not found' });
    // What the platform's Entra auth does: no token, no request; a good token sets the principal.
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'platform refused' });
    const text = await body(req);
    const headers = new Map(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    headers.set('x-ms-client-principal-id', env.SITE_ALLOWED_PRINCIPAL_ID ?? '');
    const r = await handler({ headers: { get: (n) => headers.get(n.toLowerCase()) ?? null }, text: async () => text }, pub);
    return send(r.status, r.body, r.headers);
  } catch (e) {
    console.error('local host failed', (e as Error).message);
    return send(500, { error: 'failed' });
  }
});
server.listen(port, '0.0.0.0', () => console.log(`local functions on :${port}`));
for (const s of ['SIGINT', 'SIGTERM'] as const) {
  process.on(s, () => {
    polling = false;
    server.close(() => process.exit(0));
  });
}
