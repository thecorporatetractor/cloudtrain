// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import type { ExamAttemptState } from '@/api/types';
import { TooltipProvider } from '@/components/ui';

/*
 * Renders the real exam screen with its queries on a real QueryClient; only the network
 * (request/post/put), the router, the shell and the xterm terminal are stubbed.
 */
const api = vi.hoisted(() => ({ request: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), ...api }));
vi.mock('@/router', () => ({ examAttemptRoute: { useParams: () => ({ attemptId: 'att-1' }) } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/app/shell-context', () => ({ useShell: () => ({ toast: vi.fn() }) }));
vi.mock('@/app/access', () => ({ RequireAccess: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/exams/ExamTerminal', () => ({ ExamTerminal: ({ target }: { target: { node: string } }) => <div data-testid="exam-terminal">{target.node}</div> }));
vi.mock('@/components/ui/panels', () => ({ PersistedGroup: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('react-resizable-panels', () => ({ Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>, Separator: () => null }));

const attempt = (): ExamAttemptState => ({
  id: 'att-1',
  examId: 'cka-mock',
  examTitle: 'CKA mock exam',
  phase: 'in-progress',
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  timerStartedAt: new Date(Date.now() - 60_000).toISOString(),
  deadline: new Date(Date.now() + 3_600_000).toISOString(),
  number: 1,
  serverTime: new Date().toISOString(),
  durationMinutes: 120,
  message: 'In progress',
  rules: { timer: 'single', anyOrder: true, flagForReview: true, rebootBeforeGrade: false, idempotencyRerun: false, partialCredit: 'per-check' },
  disclaimer: '',
  tasks: [{ index: 1, title: 'Fix the deployment', objective: 'workloads', weight: 100, statement: 'Fix it.', contexts: ['k8s'], nodes: ['workstation'], flagged: false, visited: false }],
  terminals: [{ id: 't-1', node: 'workstation', label: 'workstation', entry: true }],
  reportReady: false,
}) as ExamAttemptState;

let root: Root;
let host: HTMLDivElement;
let qc: QueryClient;

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

async function renderScreen() {
  const { ExamWorkspace } = await import('./ExamWorkspace');
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <ExamWorkspace />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  );
  await flush();
}

const text = () => document.body.textContent ?? '';
const buttons = (label: string) => Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.trim() === label);

describe('ExamWorkspace', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.request.mockReset();
    api.post.mockReset();
    api.put.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    qc.clear();
  });

  it('keeps the exam and its terminals mounted when a background refetch fails, with a banner', async () => {
    api.request.mockResolvedValueOnce(attempt());
    await renderScreen();
    expect(document.querySelectorAll('[data-testid="exam-terminal"]')).toHaveLength(1);
    expect(text()).toContain('Fix the deployment');

    api.request.mockRejectedValue(new ApiError(503, 'Service Unavailable'));
    await act(async () => void (await qc.refetchQueries({ queryKey: ['exam-attempt', 'att-1'] })));
    await flush();

    expect(document.querySelectorAll('[data-testid="exam-terminal"]')).toHaveLength(1);
    expect(text()).toContain('Fix the deployment');
    expect(text()).toContain('Lost contact with the exam service');
    expect(text()).not.toContain('Attempt unavailable');
  });

  it('shows the error page only when the attempt never loaded', async () => {
    api.request.mockRejectedValue(new ApiError(503, 'Service Unavailable'));
    await renderScreen();
    expect(text()).toContain('Attempt unavailable');
    expect(document.querySelectorAll('[data-testid="exam-terminal"]')).toHaveLength(0);
  });

  it('keeps the submit dialog open with the reason and a Try again button when submit fails', async () => {
    api.request.mockResolvedValue(attempt());
    api.post.mockRejectedValue(new ApiError(504, 'Gateway timeout'));
    await renderScreen();

    await act(async () => buttons('Submit exam')[0]!.click());
    await flush();
    expect(text()).toContain('Submit your exam?');

    await act(async () => buttons('Submit and end the exam')[0]!.click());
    await flush();

    expect(api.post).toHaveBeenCalledWith('/api/exams/attempts/att-1/submit');
    expect(text()).toContain('Submit your exam?');
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Your exam was not submitted: Gateway timeout');
    expect(buttons('Try again')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="exam-terminal"]')).toHaveLength(1);
  });

  it('opens the submit dialog clean after a failed submit was closed', async () => {
    api.request.mockResolvedValue(attempt());
    api.post.mockRejectedValue(new ApiError(504, 'Gateway timeout'));
    await renderScreen();

    await act(async () => buttons('Submit exam')[0]!.click());
    await act(async () => buttons('Submit and end the exam')[0]!.click());
    await flush();
    expect(text()).toContain('Your exam was not submitted');

    await act(async () => buttons('Keep working')[0]!.click());
    await flush();
    expect(text()).not.toContain('Submit your exam?');

    await act(async () => buttons('Submit exam')[0]!.click());
    await flush();
    expect(text()).toContain('Submit your exam?');
    expect(text()).not.toContain('Your exam was not submitted');
    expect(buttons('Submit and end the exam')).toHaveLength(1);
    expect(buttons('Try again')).toHaveLength(0);
  });

  it('moves on to grading when a submit failed but the gateway took it', async () => {
    api.request.mockResolvedValueOnce(attempt());
    api.post.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderScreen();

    api.request.mockResolvedValue({ ...attempt(), phase: 'grading', submittedAt: new Date().toISOString() });
    await act(async () => buttons('Submit exam')[0]!.click());
    await act(async () => buttons('Submit and end the exam')[0]!.click());
    await flush();

    expect(text()).toContain('Submitted. Grading your work');
    expect(document.querySelectorAll('[data-testid="exam-terminal"]')).toHaveLength(0);
  });

  it('keeps "Submit again" after a failed auto-submit, also when the open submit dialog is closed', async () => {
    const a = attempt();
    api.request.mockResolvedValueOnce(a);
    api.post.mockRejectedValue(new ApiError(504, 'Gateway timeout'));
    await renderScreen();

    // The candidate has the dialog open when the deadline passes (the server clock moves past it).
    await act(async () => buttons('Submit exam')[0]!.click());
    await flush();
    expect(text()).toContain('Submit your exam?');
    api.request.mockResolvedValue({ ...a, serverTime: new Date(Date.parse(a.deadline!) + 1_000).toISOString() });
    await act(async () => void (await qc.refetchQueries({ queryKey: ['exam-attempt', 'att-1'] })));
    await flush();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Time is up');
    expect(text()).toContain('The automatic submit did not go through');
    expect(buttons('Submit again')).toHaveLength(1);

    await act(async () => buttons('Keep working')[0]!.click());
    await flush();
    expect(text()).not.toContain('Submit your exam?');
    expect(text()).toContain('The automatic submit did not go through');
    expect(text()).not.toContain('submitted automatically');
    expect(buttons('Submit again')).toHaveLength(1);

    await act(async () => buttons('Submit again')[0]!.click());
    await flush();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it.each([
    [403, 'You do not have access to this attempt'],
    [404, 'This attempt is no longer available'],
  ])('replaces a loaded exam with an error page when the attempt starts answering %i', async (status, title) => {
    api.request.mockResolvedValueOnce(attempt());
    await renderScreen();
    expect(document.querySelectorAll('[data-testid="exam-terminal"]')).toHaveLength(1);

    api.request.mockRejectedValue(new ApiError(status, 'Refused'));
    await act(async () => void (await qc.refetchQueries({ queryKey: ['exam-attempt', 'att-1'] })));
    await flush();

    expect(text()).toContain(title);
    expect(text()).toContain('Back to the exam');
    expect(text()).not.toContain('Lost contact with the exam service');
    expect(document.querySelectorAll('[data-testid="exam-terminal"]')).toHaveLength(0);
  });
});
