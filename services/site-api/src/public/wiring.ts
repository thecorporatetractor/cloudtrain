import type { SiteWaitlist } from '@cloudtrain/api-types';
import { AzureQueueSender, queueClient } from '../azure/queue.js';
import { AzureTable, tableClient } from '../azure/tables.js';
import { managedIdentity, publicSettings, queueName, storageTarget, tableNames } from '../config.js';
import type { AddOnlyTable, Log, TableEntity } from '../model.js';
import { WriteCap } from '../ratelimit.js';
import type { ConsentEvidence, PublicDeps } from './handlers.js';

type Env = Record<string, string | undefined>;

export function publicDeps(env: Env, waitlist: SiteWaitlist | null, consent: ConsentEvidence | null, log: Log): PublicDeps {
  const s = publicSettings(env);
  const credential = () => managedIdentity(env);
  const names = tableNames(env);
  const tables = storageTarget(env, 'TABLE', credential);
  // Typed down to add(): this app's code cannot ask for anything its role does not allow.
  const addOnly = (name: string): AddOnlyTable => new AzureTable<TableEntity>(tableClient(tables, name));
  return {
    hmacKey: s.hmacKey,
    allowedPrincipalId: s.allowedPrincipalId,
    waitlist,
    consent,
    revealDuplicates: s.revealDuplicates,
    requestTtlMs: s.requestTtlMs,
    waitlistTable: addOnly(names.waitlist),
    intakeTable: addOnly(names.intake),
    queue: new AzureQueueSender(queueClient(storageTarget(env, 'QUEUE', credential), queueName(env))),
    writeCap: new WriteCap(s.writesPerSecond, s.writeBurst),
    now: () => new Date(),
    log,
    logSample: s.logSample,
  };
}
