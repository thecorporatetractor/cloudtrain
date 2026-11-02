import type { TokenCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import type { BlobStore } from '../model.js';
import { statusOf } from '../model.js';

export interface BlobTarget {
  /** Production: https://<account>.blob.core.windows.net */
  endpoint?: string;
  credential?: TokenCredential;
  connectionString?: string;
}

export function containerClient(t: BlobTarget, name: string): ContainerClient {
  if (t.connectionString) return BlobServiceClient.fromConnectionString(t.connectionString).getContainerClient(name);
  if (!t.endpoint || !t.credential) throw new Error('blob storage is not configured');
  return new BlobServiceClient(t.endpoint, t.credential).getContainerClient(name);
}

export class AzureBlobStore implements BlobStore {
  constructor(private readonly container: ContainerClient) {}

  async put(name: string, body: string): Promise<void> {
    await this.container.getBlockBlobClient(name).upload(body, Buffer.byteLength(body));
  }

  async putNew(name: string, body: string): Promise<boolean> {
    try {
      await this.container.getBlockBlobClient(name).upload(body, Buffer.byteLength(body), { conditions: { ifNoneMatch: '*' } });
      return true;
    } catch (e) {
      // 409: it exists, or an immutability policy refuses. 412: the condition itself failed.
      if (statusOf(e) === 409 || statusOf(e) === 412) return false;
      throw e;
    }
  }

  async get(name: string): Promise<string> {
    return (await this.container.getBlockBlobClient(name).downloadToBuffer()).toString('utf8');
  }
}
