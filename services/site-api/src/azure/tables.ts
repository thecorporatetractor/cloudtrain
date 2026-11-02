import { TableClient, type TableEntityResult } from '@azure/data-tables';
import type { TokenCredential } from '@azure/identity';
import type { ListQuery, Table, TableEntity } from '../model.js';
import { statusOf } from '../model.js';

export interface TableTarget {
  /** Production: https://<account>.table.core.windows.net */
  endpoint?: string;
  credential?: TokenCredential;
  /** Local development against Azurite only. */
  connectionString?: string;
}

export function tableClient(t: TableTarget, name: string): TableClient {
  if (t.connectionString) return TableClient.fromConnectionString(t.connectionString, name, { allowInsecureConnection: true });
  if (!t.endpoint || !t.credential) throw new Error('table storage is not configured');
  return new TableClient(t.endpoint, name, t.credential);
}

const quoted = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function filterOf(q: ListQuery | undefined): string | undefined {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q?.equals ?? {})) parts.push(`${columnName(k)} eq ${quoted(v)}`);
  if (q?.before) parts.push(`${columnName(q.before.prop)} lt ${quoted(q.before.at)}`);
  if (q?.partitionFrom) parts.push(`PartitionKey ge ${quoted(q.partitionFrom)}`);
  return parts.length ? parts.join(' and ') : undefined;
}

/** Property names come from this code only; the check keeps it that way. */
function columnName(k: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) throw new Error('table: bad property name');
  return k;
}

export class AzureTable<T extends TableEntity> implements Table<T> {
  constructor(private readonly client: TableClient) {}

  async add(entity: TableEntity & Record<string, unknown>): Promise<boolean> {
    try {
      await this.client.createEntity(entity);
      return true;
    } catch (e) {
      if (statusOf(e) === 409) return false;
      throw e;
    }
  }

  async get(partitionKey: string, rowKey: string): Promise<T | null> {
    try {
      return (await this.client.getEntity<T>(partitionKey, rowKey)) as unknown as T;
    } catch (e) {
      if (statusOf(e) === 404) return null;
      throw e;
    }
  }

  async update(entity: Partial<T> & TableEntity, etag: string): Promise<void> {
    const { etag: _drop, ...fields } = entity;
    await this.client.updateEntity(fields as TableEntity & Record<string, unknown>, 'Merge', { etag });
  }

  async remove(partitionKey: string, rowKey: string): Promise<boolean> {
    try {
      await this.client.deleteEntity(partitionKey, rowKey);
      return true;
    } catch (e) {
      if (statusOf(e) === 404) return false;
      throw e;
    }
  }

  async *list(query?: ListQuery): AsyncIterable<T> {
    const filter = filterOf(query);
    const rows = this.client.listEntities<T>(filter ? { queryOptions: { filter } } : {});
    for await (const r of rows as AsyncIterable<TableEntityResult<T>>) yield r as unknown as T;
  }
}
