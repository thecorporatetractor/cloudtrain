import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseAllDocuments } from 'yaml';
import { LABEL_MANAGED_BY, MANAGED_BY, type LabTemplate } from '../kube/types.js';
import type { ExamTemplate } from './kube.js';

const run = promisify(execFile);

export interface CompiledExam {
  exam: ExamTemplate;
  tasks: LabTemplate[];
}

/** Turns a curriculum exam into an ExamTemplate plus its pool tasks' LabTemplates. */
export interface ExamCompiler {
  compile(examId: string, examsFile: string): Promise<CompiledExam>;
}

/**
 * `labctl exam compile`: the same Go compiler the orchestrator's verifier
 * uses (schema + consistency checks, content-named task templates identical
 * to the gateway's lab templates). Cached per exam for the process lifetime.
 */
export class LabctlExamCompiler implements ExamCompiler {
  private readonly cache = new Map<string, Promise<CompiledExam>>();

  constructor(
    private readonly labctl: string,
    private readonly labDirs: string[],
  ) {}

  compile(examId: string, examsFile: string): Promise<CompiledExam> {
    const key = `${examsFile}\u0000${examId}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.doCompile(examId, examsFile);
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return p;
  }

  private async doCompile(examId: string, examsFile: string): Promise<CompiledExam> {
    let stdout: string;
    try {
      ({ stdout } = await run(this.labctl, ['exam', 'compile', '--exams', examsFile, '--labs', this.labDirs.join(','), examId], { maxBuffer: 64 * 1024 * 1024 }));
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      throw new Error(`labctl exam compile ${examId}: ${(err.stderr || err.message).trim()}`);
    }
    return parseCompiled(stdout);
  }
}

/** Splits `labctl exam compile` output into the ExamTemplate and task LabTemplates. */
export function parseCompiled(yamlText: string): CompiledExam {
  let exam: ExamTemplate | undefined;
  const tasks: LabTemplate[] = [];
  for (const doc of parseAllDocuments(yamlText)) {
    const obj = doc.toJS() as { kind?: string; metadata?: { labels?: Record<string, string> } } | null;
    if (!obj) continue;
    obj.metadata = { ...(obj.metadata ?? {}), labels: { ...(obj.metadata?.labels ?? {}), [LABEL_MANAGED_BY]: MANAGED_BY } } as never;
    if (obj.kind === 'ExamTemplate') exam = obj as unknown as ExamTemplate;
    else if (obj.kind === 'LabTemplate') tasks.push(obj as unknown as LabTemplate);
  }
  if (!exam) throw new Error('labctl exam compile produced no ExamTemplate');
  for (const t of [exam, ...tasks]) delete (t.metadata as { creationTimestamp?: unknown }).creationTimestamp;
  return { exam, tasks };
}
