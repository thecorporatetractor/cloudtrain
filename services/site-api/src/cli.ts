import { readFileSync } from 'node:fs';
import { checkChain, type LedgerCheckpoint, type LedgerEntry } from './ledger.js';
import { buildLedger, cliStorage } from './worker/wiring.js';
import { reapplyErasures, restoreWaitlist } from './worker/retention.js';

/*
 * The operator's tasks, with the signed-in `az` user (docs/deploy-site-vm.md). They print positions,
 * hashes and counts, never an address.
 *   verify [--expect <seq>:<hash>]            proves the chain; exits 1 when it does not hold
 *   verify-file <ndjson> [--expect ...]       the same over a ledger export (the gateway's gdpr:ledger-export)
 *   reapply [--dry-run]                       re-erases after a restore
 *   restore <blob name>                       adds a backup's rows back, then re-erases
 */

const flag = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function report(r: ReturnType<typeof checkChain>) {
  console.log(`verify ${r.ok ? 'OK' : 'FAILED'}: ${r.count} records, head ${r.head.seq}:${r.head.hash}${r.checkpoint ? `, ${r.checkpoint.prunedTotal} pruned through ${r.checkpoint.throughSeq} under a signed checkpoint` : ''}`);
  for (const p of r.problems) console.log(`  ${p.kind} at ${p.seq}`);
  if (!r.ok) process.exitCode = 1;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const env = process.env;
  const expectRaw = flag(args, 'expect');
  const expect = expectRaw ? { seq: Number(expectRaw.split(':')[0]), hash: expectRaw.split(':')[1] ?? '' } : undefined;

  if (cmd === 'verify-file') {
    const entries: LedgerEntry[] = [];
    let checkpoint: LedgerCheckpoint | null = null;
    for (const line of readFileSync(args[0]!, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const o = JSON.parse(line) as (LedgerEntry & { kind?: undefined }) | { kind: 'checkpoint'; checkpoint: LedgerCheckpoint };
      if (o.kind === 'checkpoint') checkpoint = o.checkpoint;
      else entries.push(o);
    }
    report(checkChain(entries, expect ? { expect } : {}, [], checkpoint ? { value: checkpoint, hmacKey: env.CT_GDPR_HMAC_KEY } : null));
    return;
  }

  const s = cliStorage(env);
  const ledger = buildLedger(s);
  const deps = { waitlistTable: s.waitlistTable, ledger, now: () => new Date() };
  if (cmd === 'verify') {
    const r = await ledger.verifyChain(expect ? { expect } : {});
    report(r);
    return;
  }
  if (cmd === 'reapply') {
    const dryRun = args.includes('--dry-run');
    const r = await reapplyErasures(deps, { dryRun });
    console.log(`reapply${dryRun ? ' (dry run)' : ''}: ${r.subjects} subjects in the ledger, ${r.erased} entries erased again, ${r.keptNewer} newer entries kept, ${r.records} ledger records`);
    return;
  }
  if (cmd === 'restore') {
    const name = args[0];
    if (!name) throw new Error('restore needs a blob name');
    const a = await restoreWaitlist(s.waitlistTable, s.blob(s.settings.backupContainer), name);
    console.log(`restore: ${a.added} rows added, ${a.present} already present`);
    const r = await reapplyErasures(deps);
    console.log(`reapply: ${r.subjects} subjects in the ledger, ${r.erased} entries erased again, ${r.keptNewer} newer entries kept, ${r.records} ledger records`);
    return;
  }
  throw new Error('usage: cli.ts verify [--expect seq:hash] | verify-file <file> [--expect seq:hash] | reapply [--dry-run] | restore <blob name>');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
