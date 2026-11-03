// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';

/* AuthGate on a hybrid page ('/', /catalog) when /api/me fails: the visitor variant renders, with a notice. */
const state = vi.hoisted(() => ({ pathname: '/', me: {} as Record<string, unknown>, toast: vi.fn() }));
vi.mock('@/api/client', async (orig) => ({ ...(await orig<typeof import('@/api/client')>()), useMe: () => state.me }));
vi.mock('@tanstack/react-query', async (orig) => ({ ...(await orig<typeof import('@tanstack/react-query')>()), useQueryClient: () => ({ clear: vi.fn() }) }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: state.pathname } }),
}));
vi.mock('./shell-context', () => ({ useShell: () => ({ toast: state.toast }) }));
vi.mock('@/lib/surface', async (orig) => ({ ...(await orig<typeof import('@/lib/surface')>()), ON_APP: false }));

const failedMe = (error: unknown, errorUpdatedAt = 1) => ({ isPending: false, isError: true, isSuccess: false, data: undefined, error, failureCount: 5, errorUpdatedAt, refetch: vi.fn() });

let root: Root;
let host: HTMLDivElement;

async function render() {
  const { AuthGate } = await import('./auth');
  await act(async () =>
    root.render(
      <AuthGate>
        <p>public page</p>
      </AuthGate>,
    ),
  );
}

describe('AuthGate on a hybrid page', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    state.toast.mockReset();
    state.pathname = '/';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders the visitor variant and says the account could not be loaded, with a retry', async () => {
    state.me = failedMe(new ApiError(503, 'Service unavailable'));
    await render();
    expect(host.textContent).toContain('public page');
    expect(state.toast).toHaveBeenCalledTimes(1);
    const t = state.toast.mock.calls[0]![0] as { title: string; tone: string; action: { label: string; onClick: () => void } };
    expect(t.title).toBe('Could not load your account');
    expect(t.tone).toBe('err');
    t.action.onClick();
    expect(state.me.refetch).toHaveBeenCalled();
  });

  it('tells once per failure, not on every render', async () => {
    state.me = failedMe(new TypeError('Failed to fetch'));
    await render();
    await render();
    expect(state.toast).toHaveBeenCalledTimes(1);
    state.me = failedMe(new TypeError('Failed to fetch'), 2);
    await render();
    expect(state.toast).toHaveBeenCalledTimes(2);
  });

  it('says nothing to a visitor (401)', async () => {
    state.me = failedMe(new ApiError(401, 'Not signed in'));
    await render();
    expect(host.textContent).toContain('public page');
    expect(state.toast).not.toHaveBeenCalled();
  });
});
