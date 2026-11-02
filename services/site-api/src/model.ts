import type { PrivacyRequestType } from './subject.js';

/*
 * What is stored. Times are ISO 8601 UTC strings of one fixed width, which compare correctly as
 * strings in a table filter. Keys never hold plaintext: they appear in storage logs.
 *
 * waitlist          PartitionKey: first 2 hex of the subject key. RowKey: the subject key. One key
 *                   per address whatever month it joined, so an insert that answers 409 is the
 *                   duplicate check, and it needs no read.
 * privacyrequests   PartitionKey: UTC day of expiry. RowKey: request id. The intake: the public app
 *                   adds it and only the worker reads it. Holds the address until the request ends.
 *                   Also holds claim rows (RowKey `claim-<token hash>`): adding one is how the public
 *                   app, which can read nothing, sees that a link was already used (409).
 * privacystate      The worker's own table: the state of each request and the token hash. The
 *                   public identity has no access, so nothing it can write decides what happens.
 */

export interface TableEntity {
  partitionKey: string;
  rowKey: string;
  etag?: string;
}

export interface WaitlistRow extends TableEntity {
  email: string;
  organisation?: string;
  role?: string;
  interest?: string;
  consentAt: string;
  /** SHA-256 of the consent wording shown, the notice's date and which form: the consent evidence. No IP. */
  consentLabelHash?: string;
  privacyNoticeUpdated?: string;
  formSource?: string;
  createdAt: string;
  /** Set by the worker only. Their absence means no leave link exists yet. */
  leaveNonce?: string;
  welcomeSentAt?: string;
}

export interface IntakeRow extends TableEntity {
  email: string;
  type: PrivacyRequestType;
  requestedAt: string;
  expiresAt: string;
}

export type RequestState = 'awaiting' | 'processing' | 'done';

export interface StateRow extends TableEntity {
  state: RequestState;
  type: PrivacyRequestType;
  subjectKey: string;
  tokenHash: string;
  requestedAt: string;
  expiresAt: string;
  mailSentAt?: string;
  verifiedAt?: string;
  /** JSON: what the erasure already did, so a retry does not report 0 rows removed. */
  outcomes?: string;
}

/** Message bodies hold no address. A `confirm` holds the visitor's token: only the worker can read the queue. */
export type QueueMessage =
  | { v: 1; kind: 'send-confirmation'; requestId: string; partition: string }
  | { v: 1; kind: 'confirm'; token: string }
  | { v: 1; kind: 'welcome'; subjectKey: string }
  | { v: 1; kind: 'leave'; token: string };

export interface ListQuery {
  /** Equal to the value. */
  equals?: Record<string, string>;
  /** `prop` holds a time before this one. A row without the property does not match. */
  before?: { prop: string; at: string };
  /** PartitionKey at or after this value. */
  partitionFrom?: string;
}

/** What the public identity's role allows, and all the public app's code can ask for. */
export interface AddOnlyTable {
  /** False when the row already exists (409): no read happened. */
  add(entity: TableEntity & Record<string, unknown>): Promise<boolean>;
}

export interface Table<T extends TableEntity> extends AddOnlyTable {
  get(partitionKey: string, rowKey: string): Promise<T | null>;
  /** Merges the fields; fails with status 412 when the row changed since `etag`. */
  update(entity: Partial<T> & TableEntity, etag: string): Promise<void>;
  /** False when there was no such row. */
  remove(partitionKey: string, rowKey: string): Promise<boolean>;
  list(query?: ListQuery): AsyncIterable<T>;
}

export interface QueueSender {
  send(message: QueueMessage, ttlSeconds: number): Promise<void>;
}

export interface BlobStore {
  /** Overwrites. */
  put(name: string, body: string): Promise<void>;
  /** Refuses (false) when the name exists: for a container with an immutability policy. */
  putNew(name: string, body: string): Promise<boolean>;
  get(name: string): Promise<string>;
}

export interface Log {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
}

export const statusOf = (e: unknown): number | undefined => (e as { statusCode?: number }).statusCode;
