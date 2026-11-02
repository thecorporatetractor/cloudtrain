import type { TokenCredential } from '@azure/identity';
import { AcsMailer } from '../azure/acs.js';
import { AzureBlobStore, containerClient } from '../azure/blob.js';
import { AzureTable, tableClient } from '../azure/tables.js';
import { managedIdentity, operatorCredential, storageTarget, tableNames, workerSettings } from '../config.js';
import { AzureTableLedger, LedgerWithCopy, type ErasureLedger, type TableClientLike } from '../ledger.js';
import type { Mailer } from '../mailer.js';
import type { BlobStore, IntakeRow, Log, StateRow, Table, TableEntity, WaitlistRow } from '../model.js';
import type { RequestDeps } from './requests.js';

/** The real clients for the worker, the operator's CLI and the local host. Tests build their own deps. */

type Env = Record<string, string | undefined>;

export interface WorkerParts {
  requests: RequestDeps;
  backups: BlobStore;
  ledgerCopy?: BlobStore;
}

export function storage(env: Env, credential: () => TokenCredential) {
  const names = tableNames(env);
  const target = storageTarget(env, 'TABLE', credential);
  const settings = workerSettings(env);
  return {
    settings,
    waitlistTable: new AzureTable<WaitlistRow>(tableClient(target, names.waitlist)) as Table<WaitlistRow>,
    intakeTable: new AzureTable<IntakeRow>(tableClient(target, names.intake)) as Table<IntakeRow>,
    stateTable: new AzureTable<StateRow>(tableClient(target, names.state)) as Table<StateRow>,
    capTable: new AzureTable<TableEntity & { count: number }>(tableClient(target, names.state)),
    ledgerClient: tableClient(target, names.ledger) as unknown as TableClientLike,
    blob: (container: string): BlobStore => new AzureBlobStore(containerClient(storageTarget(env, 'BLOB', credential), container)),
  };
}

export function buildLedger(s: ReturnType<typeof storage>): ErasureLedger {
  const table = new AzureTableLedger(s.ledgerClient, s.settings.hmacKey);
  return s.settings.ledgerCopyContainer ? new LedgerWithCopy(table, s.blob(s.settings.ledgerCopyContainer)) : table;
}

export function workerParts(env: Env, log: Log, mailer?: Mailer): WorkerParts {
  const credential = () => managedIdentity(env);
  const s = storage(env, credential);
  const acs = (): Mailer => {
    if (!s.settings.acsEndpoint) throw new Error('SITE_ACS_ENDPOINT must be set');
    return new AcsMailer(s.settings.acsEndpoint, credential(), s.settings.mailSender, s.settings.mailReplyTo);
  };
  return {
    requests: {
      hmacKey: s.settings.hmacKey,
      waitlistTable: s.waitlistTable,
      intakeTable: s.intakeTable,
      stateTable: s.stateTable,
      capTable: s.capTable,
      ledger: buildLedger(s),
      mailer: mailer ?? acs(),
      siteUrl: s.settings.siteUrl,
      requestTtlMs: s.settings.requestTtlMs,
      perSubjectPerHour: s.settings.perSubjectPerHour,
      dailyMailCap: s.settings.dailyMailCap,
      now: () => new Date(),
      log,
    },
    backups: s.blob(s.settings.backupContainer),
    ...(s.settings.ledgerCopyContainer ? { ledgerCopy: s.blob(s.settings.ledgerCopyContainer) } : {}),
  };
}

export const cliStorage = (env: Env) => storage(env, operatorCredential);
