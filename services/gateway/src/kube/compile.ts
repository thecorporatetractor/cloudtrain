import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { LABEL_MANAGED_BY, MANAGED_BY, type LabTemplate } from './types.js';

const run = promisify(execFile);

/** Turns a lab.yaml into a LabTemplate object. */
export interface Compiler {
  compile(labFile: string): Promise<LabTemplate>;
}

/**
 * Compiles with the Go `labctl compile` binary so the orchestrator and the
 * gateway share one compiler (schema + semantic validation, defaults, asset
 * inlining). Results are cached per file for the life of the process; content
 * is read at startup, so a changed lab.yaml needs a gateway restart anyway.
 */
export class LabctlCompiler implements Compiler {
  private readonly cache = new Map<string, Promise<LabTemplate>>();

  constructor(private readonly labctl: string) {}

  async check(): Promise<void> {
    try {
      await access(this.labctl, constants.X_OK);
    } catch {
      throw new Error(`labctl not found at ${this.labctl}; build it with \`task gateway:labctl\` (go build ./services/lab-orchestrator/cmd/labctl) or set CT_LABCTL`);
    }
  }

  compile(labFile: string): Promise<LabTemplate> {
    let p = this.cache.get(labFile);
    if (!p) {
      p = this.doCompile(labFile);
      p.catch(() => this.cache.delete(labFile));
      this.cache.set(labFile, p);
    }
    return p;
  }

  private async doCompile(labFile: string): Promise<LabTemplate> {
    let stdout: string;
    try {
      ({ stdout } = await run(this.labctl, ['compile', labFile], { maxBuffer: 32 * 1024 * 1024 }));
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      throw new Error(`labctl compile ${labFile}: ${(err.stderr || err.message).trim()}`);
    }
    return withContentName(parse(stdout) as LabTemplate);
  }
}

/**
 * LabTemplates are immutable, so the gateway names them after the content
 * digest as well as the version: editing a lab without bumping its version
 * yields a new template instead of a conflict with a stale one.
 */
export function withContentName(t: LabTemplate): LabTemplate {
  const digest = (t.spec.source.digest ?? '').replace(/^sha256:/, '').slice(0, 10);
  const name = digest ? `${t.spec.source.id}-v${t.spec.source.version}-${digest}` : t.metadata.name;
  const { creationTimestamp: _drop, ...meta } = t.metadata;
  return {
    ...t,
    metadata: {
      ...meta,
      name,
      labels: { ...(t.metadata.labels ?? {}), [LABEL_MANAGED_BY]: MANAGED_BY },
    },
  };
}
