import { readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { createDb } from '../db/index.js';
import { KeycloakAdmin } from '../keycloak/admin.js';
import { SmtpMailer } from '../mail.js';
import { Sealer } from '../oidc/sessions.js';
import { StripeApi } from '../billing/stripe.js';
import { PgWaitlistStore } from '../waitlist/store.js';
import { canonicalJson, checkChain, createLedger, PostgresLedger, type ChainReport, type LedgerCheckpoint, type LedgerEntry } from './ledger.js';
import { GdprService } from './service.js';

/*
 * Evidence tasks (docs/gdpr.md). They print positions, hashes and counts, never an address.
 *   gdpr:verify [--expect <seq>:<hash>] [--ledger-file <file>]     proves the chain; exits 1 when it does not hold
 *   gdpr:ledger-export [--out <file>]                              the ledger as JSON lines, for a copy off the database
 *   gdpr:reapply [--dry-run] [--ledger-file <file>]                re-erases after a restore
 *   echo address | gdpr:find                                       the ledger's records for one address, under every key held
 */

/** Stops with a message written here for the operator. */
function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const flag = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function parseExport(text: string): { entries: LedgerEntry[]; checkpoint: LedgerCheckpoint | null } {
  let checkpoint: LedgerCheckpoint | null = null;
  const entries: LedgerEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as (LedgerEntry & { kind?: undefined }) | { kind: 'checkpoint'; checkpoint: LedgerCheckpoint };
    if (o.kind === 'checkpoint') checkpoint = o.checkpoint;
    else entries.push(o);
  }
  return { entries, checkpoint };
}

function printReport(r: ChainReport) {
  console.log(`gdpr:verify ${r.ok ? 'OK' : 'FAILED'}: ${r.count} records, head ${r.head.seq}:${r.head.hash}${r.checkpoint ? `, ${r.checkpoint.prunedTotal} pruned through ${r.checkpoint.throughSeq} under a signed checkpoint` : ''}`);
  for (const p of r.problems) console.log(`  ${p.kind} at ${p.seq}`);
  if (!r.ok) process.exitCode = 1;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
  if (!config.gdpr.hmacKey) die('CT_GDPR_HMAC_KEY must be set');
  const expectRaw = flag(args, 'expect');
  const expect = expectRaw ? { seq: Number(expectRaw.split(':')[0]), hash: expectRaw.split(':')[1] ?? '' } : undefined;
  const file = flag(args, 'ledger-file');

  if (cmd === 'verify' && file) {
    const { entries, checkpoint } = parseExport(await readFile(file, 'utf8'));
    printReport(checkChain(entries, expect ? { expect } : {}, [], checkpoint ? { value: checkpoint, hmacKey: [config.gdpr.hmacKey, ...config.gdpr.previousHmacKeys] } : null));
    return;
  }

  const db = createDb(config.databaseUrl, 2);
  try {
    const keys = [config.gdpr.hmacKey, ...config.gdpr.previousHmacKeys];
    const ledger = await createLedger(config.gdpr.ledger, db, keys);
    const service = () => {
      const kc = config.keycloak.adminClientSecret ? new KeycloakAdmin({ baseUrl: config.keycloak.baseUrl, realm: config.keycloak.realm, clientId: config.keycloak.adminClientId, clientSecret: config.keycloak.adminClientSecret }) : null;
      return {
        kc,
        gdpr: new GdprService({
          db,
          ledger,
          hmacKey: config.gdpr.hmacKey,
          previousHmacKeys: config.gdpr.previousHmacKeys,
          sealer: new Sealer(config.sessionSecret || 'gdpr-cli-seals-nothing'),
          mailer: new SmtpMailer(config.smtp.host, config.smtp.port, config.smtp.from),
          webUrl: config.webUrl,
          waitlist: new PgWaitlistStore(db),
          kc,
          ...(config.billing.enabled ? { stripe: new StripeApi(config.billing.secretKey) } : {}),
        }),
      };
    };
    if (cmd === 'find') {
      // The address comes on stdin, so it stays out of shell history and process lists.
      const email = (await new Promise<string>((resolve) => {
        let t = '';
        process.stdin.on('data', (d) => (t += String(d)));
        process.stdin.on('end', () => resolve(t));
      })).trim();
      if (!email) die('usage: echo address | cli.ts find');
      const records = await service().gdpr.recordsFor(email);
      for (const r of records) console.log(`${r.seq} ${r.type} ${r.scope} ${r.completedAt}`);
      console.log(`gdpr:find: ${records.length} record(s)`);
      return;
    }
    if (cmd === 'verify') {
      printReport(await ledger.verifyChain(expect ? { expect } : {}));
      return;
    }
    if (cmd === 'ledger-export') {
      const checkpoint = await ledger.checkpoint();
      const lines = [...(checkpoint ? [canonicalJson({ kind: 'checkpoint', checkpoint })] : []), ...(await ledger.entries()).map(canonicalJson)];
      const out = flag(args, 'out');
      if (out) await writeFile(out, `${lines.join('\n')}\n`, { mode: 0o600 });
      else console.log(lines.join('\n'));
      return;
    }
    if (cmd === 'reapply') {
      if (file) {
        if (!(ledger instanceof PostgresLedger)) die('--ledger-file is for the Postgres ledger, which a restore rolls back; an Azure ledger is not in the dump');
        const { entries, checkpoint } = parseExport(await readFile(file, 'utf8'));
        const added = await ledger.importMissing(entries, checkpoint);
        console.log(`gdpr:reapply: ${added} ledger record(s) restored from the export`);
      }
      const { gdpr, kc } = service();
      const dryRun = args.includes('--dry-run');
      const r = await gdpr.reapply({ dryRun });
      console.log(`gdpr:reapply${dryRun ? ' (dry run)' : ''}: ${r.waitlist} waitlist entries, ${r.accounts} accounts, ${r.audit} audit addresses, ${r.records} ledger records${kc ? '' : ' (Keycloak not configured: identities not re-erased)'}`);
      return;
    }
    die('usage: cli.ts verify [--expect seq:hash] [--ledger-file f] | ledger-export [--out f] | reapply [--dry-run] [--ledger-file f] | find');
  } finally {
    await db.destroy();
  }
}

// A generic line: what was thrown may quote a connection string or a key.
main().catch(() => {
  console.error('gdpr: the command failed. Check the database URL, the ledger settings and that the store is reachable.');
  process.exit(1);
});
