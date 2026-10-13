import type { Readable, Writable } from 'node:stream';
import type { LabSession, LabTemplate } from './types.js';

/** A target container for exec, as published in a k8s-exec endpoint. */
export interface ExecTarget {
  namespace: string;
  pod: string;
  container: string;
}

export interface ExecStreams {
  /** Output; for TTY sessions it should carry `columns`/`rows` and emit 'resize' (see terminal/bridge.ts). */
  stdout: Writable;
  stderr: Writable | null;
  stdin: Readable;
}

export interface ExecHandle {
  /** Resolves with the exit code (0 when the API reports Success) once the process ends. */
  exited: Promise<number>;
  /** Tears the stream down (closes the exec websocket). */
  close(): void;
}

/**
 * Everything the gateway does against the cluster. The real implementation is
 * KubeLabCluster (@kubernetes/client-node); tests use an in-memory fake.
 * NotFound is reported as `null` (get) or a resolved no-op (delete).
 */
export interface LabCluster {
  getTemplate(name: string): Promise<LabTemplate | null>;
  createTemplate(t: LabTemplate): Promise<LabTemplate>;
  getSession(name: string): Promise<LabSession | null>;
  listSessions(labelSelector: string): Promise<LabSession[]>;
  createSession(s: LabSession): Promise<LabSession>;
  /** JSON merge patch (RFC 7386) on the main resource (not status). */
  patchSession(name: string, patch: Record<string, unknown>): Promise<LabSession>;
  deleteSession(name: string): Promise<void>;
  exec(target: ExecTarget, command: string[], streams: ExecStreams, tty: boolean): Promise<ExecHandle>;
}

export class ConflictError extends Error {}
