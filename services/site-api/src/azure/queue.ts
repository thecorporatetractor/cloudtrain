import type { TokenCredential } from '@azure/identity';
import { QueueClient } from '@azure/storage-queue';
import type { QueueMessage, QueueSender } from '../model.js';

export interface QueueTarget {
  /** Production: https://<account>.queue.core.windows.net */
  endpoint?: string;
  credential?: TokenCredential;
  connectionString?: string;
}

export function queueClient(t: QueueTarget, name: string): QueueClient {
  if (t.connectionString) return new QueueClient(t.connectionString, name);
  if (!t.endpoint || !t.credential) throw new Error('queue storage is not configured');
  return new QueueClient(`${t.endpoint.replace(/\/$/, '')}/${name}`, t.credential);
}

/** Base64: what the Functions queue trigger expects by default. */
export class AzureQueueSender implements QueueSender {
  constructor(private readonly client: QueueClient) {}

  async send(message: QueueMessage, ttlSeconds: number): Promise<void> {
    await this.client.sendMessage(Buffer.from(JSON.stringify(message)).toString('base64'), { messageTimeToLive: ttlSeconds });
  }
}
