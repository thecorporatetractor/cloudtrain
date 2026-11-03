import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExamAttemptState } from './types';

vi.mock('@tanstack/react-query', async (orig) => {
  const m = await orig<typeof import('@tanstack/react-query')>();
  let qc: QueryClient | undefined;
  return { ...m, useQueryClient: () => qc!, __setClient: (c: QueryClient) => (qc = c), useMutation: (o: unknown) => o };
});

describe('flag for review', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('puts the flag back when the server refuses it', async () => {
    const rq = (await import('@tanstack/react-query')) as unknown as { __setClient: (c: QueryClient) => void };
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    rq.__setClient(qc);
    vi.stubGlobal('window', { dispatchEvent: () => true, location: { pathname: '/' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Attempt is closed' }), { status: 409, headers: { 'content-type': 'application/json' } })));
    const attempt = { id: 'att-1', tasks: [{ index: 1, flagged: false }, { index: 2, flagged: false }] } as unknown as ExamAttemptState;
    qc.setQueryData(['exam-attempt', 'att-1'], attempt);
    const { useFlagTask } = await import('./exams');
    const options = useFlagTask('att-1') as unknown as ConstructorParameters<typeof MutationObserver>[1];
    const m = new MutationObserver(qc, options as never);
    await expect(m.mutate({ index: 2, flagged: true } as never)).rejects.toThrow('Attempt is closed');
    const after = qc.getQueryData<ExamAttemptState>(['exam-attempt', 'att-1'])!;
    expect(after.tasks.map((t) => t.flagged)).toEqual([false, false]);
  });
});

describe('submit', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refetches the attempt after a failed submit, in case the gateway took it', async () => {
    const rq = (await import('@tanstack/react-query')) as unknown as { __setClient: (c: QueryClient) => void };
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    rq.__setClient(qc);
    vi.stubGlobal('window', { dispatchEvent: () => true, location: { pathname: '/' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Gateway timeout' }), { status: 504, headers: { 'content-type': 'application/json' } })));
    qc.setQueryData(['exam-attempt', 'att-1'], { id: 'att-1', phase: 'in-progress' });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { useSubmitExam } = await import('./exams');
    const m = new MutationObserver(qc, useSubmitExam('att-1') as never);
    await expect(m.mutate()).rejects.toThrow();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['exam-attempt', 'att-1'] });
  });
});
