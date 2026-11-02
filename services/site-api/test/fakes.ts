import type { Mailer, MailMessage } from '../src/mailer.js';
import type { BlobStore, ListQuery, Log, QueueMessage, QueueSender, Table, TableEntity } from '../src/model.js';
import type { TableClientLike } from '../src/ledger.js';

const err = (statusCode: number) => Object.assign(new Error(`status ${statusCode}`), { statusCode });

/** A table with the behaviour that matters: 409 on add, 412 on a stale ETag, 404 as null. Counts reads. */
export class MemoryTable<T extends TableEntity> implements Table<T> {
  rows = new Map<string, T & Record<string, unknown>>();
  reads = 0;
  adds = 0;
  failAdd = 0;
  private version = 0;
  private id = (p: string, r: string) => `${p}\u0000${r}`;

  async add(entity: TableEntity & Record<string, unknown>): Promise<boolean> {
    if (this.failAdd > 0) {
      this.failAdd--;
      throw err(500);
    }
    this.adds++;
    const k = this.id(entity.partitionKey, entity.rowKey);
    if (this.rows.has(k)) return false;
    this.rows.set(k, { ...entity, etag: `v${++this.version}` } as T & Record<string, unknown>);
    return true;
  }

  async get(p: string, r: string): Promise<T | null> {
    this.reads++;
    const row = this.rows.get(this.id(p, r));
    return row ? { ...row } : null;
  }

  async update(entity: Partial<T> & TableEntity, etag: string): Promise<void> {
    const k = this.id(entity.partitionKey, entity.rowKey);
    const row = this.rows.get(k);
    if (!row) throw err(404);
    if (etag !== '*' && row.etag !== etag) throw err(412);
    this.rows.set(k, { ...row, ...entity, etag: `v${++this.version}` });
  }

  async remove(p: string, r: string): Promise<boolean> {
    return this.rows.delete(this.id(p, r));
  }

  async *list(q?: ListQuery): AsyncIterable<T> {
    this.reads++;
    for (const row of [...this.rows.values()]) {
      const fields = row as Record<string, unknown>;
      const value = (k: string) => (k === 'PartitionKey' ? row.partitionKey : fields[k]);
      if (q?.equals && !Object.entries(q.equals).every(([k, v]) => value(k) === v)) continue;
      if (q?.before) {
        const v = value(q.before.prop);
        if (typeof v !== 'string' || !(v < q.before.at)) continue;
      }
      if (q?.partitionFrom && row.partitionKey < q.partitionFrom) continue;
      yield { ...row };
    }
  }

  all(): (T & Record<string, unknown>)[] {
    return [...this.rows.values()];
  }
}

/** Only add(): a handler given this cannot read, and a test sees it try nothing else. */
export const addOnly = <T extends TableEntity>(t: MemoryTable<T>) => ({ add: (e: TableEntity & Record<string, unknown>) => t.add(e) });

export class MemoryQueue implements QueueSender {
  messages: QueueMessage[] = [];
  ttls: number[] = [];
  fail = 0;
  async send(m: QueueMessage, ttl: number) {
    if (this.fail > 0) {
      this.fail--;
      throw err(500);
    }
    this.messages.push(m);
    this.ttls.push(ttl);
  }
}

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  fail = 0;
  async send(m: MailMessage) {
    if (this.fail > 0) {
      this.fail--;
      throw new Error('mail failed');
    }
    this.sent.push(m);
  }
}

export class MemoryBlobs implements BlobStore {
  files = new Map<string, string>();
  async put(n: string, b: string) {
    this.files.set(n, b);
  }
  async putNew(n: string, b: string) {
    if (this.files.has(n)) return false;
    this.files.set(n, b);
    return true;
  }
  async get(n: string) {
    const f = this.files.get(n);
    if (f === undefined) throw err(404);
    return f;
  }
}

export class MemoryLog implements Log {
  lines: string[] = [];
  info(o: object, m: string) {
    this.lines.push(`${m} ${JSON.stringify(o)}`);
  }
  warn(o: object, m: string) {
    this.lines.push(`${m} ${JSON.stringify(o)}`);
  }
  get text() {
    return this.lines.join('\n');
  }
}

/** A TableClient for the ledger: an entity-group transaction that is all or nothing, with ETags. */
export class FakeLedgerClient implements TableClientLike {
  rows = new Map<string, Record<string, unknown> & { partitionKey: string; rowKey: string; etag: string }>();
  transactions = 0;
  private version = 0;
  private id = (p: string, r: string) => `${p}/${r}`;

  async getEntity<T extends object>(p: string, r: string): Promise<T & { etag?: string }> {
    const row = this.rows.get(this.id(p, r));
    if (!row) throw err(404);
    return { ...row } as unknown as T & { etag?: string };
  }

  async *listEntities<T extends object>(o?: { queryOptions?: { filter?: string } }): AsyncIterable<T & { etag?: string }> {
    const range = /RowKey ge '(.)' and RowKey lt '(.)'/.exec(o?.queryOptions?.filter ?? '');
    for (const row of this.rows.values()) if (!range || (row.rowKey >= range[1]! && row.rowKey < range[2]!)) yield { ...row } as unknown as T & { etag?: string };
  }

  async submitTransaction(actions: unknown[]): Promise<unknown> {
    const copy = new Map(this.rows);
    for (const a of actions as [string, { partitionKey: string; rowKey: string } & Record<string, unknown>, string?, { etag?: string }?][]) {
      const k = this.id(a[1].partitionKey, a[1].rowKey);
      if (a[0] === 'create') {
        if (copy.has(k)) throw err(409);
        copy.set(k, { ...a[1], etag: `e${++this.version}` });
      } else if (a[0] === 'update') {
        if (a[3]?.etag && copy.get(k)?.etag !== a[3].etag) throw err(412);
        copy.set(k, { ...a[1], etag: `e${++this.version}` });
      } else if (a[0] === 'delete') {
        copy.delete(k);
      }
    }
    this.rows = copy;
    this.transactions++;
    return {};
  }
}
