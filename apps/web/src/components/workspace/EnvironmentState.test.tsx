import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LabSession } from '@/api/types';
import { EnvironmentState, environmentHeadline } from './EnvironmentState';

const session = (p: Partial<LabSession>): LabSession => ({ id: 's', labId: 'l', startedAt: '2026-11-04T10:00:00Z', deadlineMinutes: 60, nodes: [{ name: 'jumphost', status: 'ready' }], results: [], revealedHints: [], score: 0, validations: 0, status: 'running', ...p }) as LabSession;
const noop = () => undefined;

describe('environment state', () => {
  it('a hibernated session is paused, not starting, and offers no new session (a start would reattach to it)', () => {
    expect(environmentHeadline(session({ phase: 'hibernated' }))).toEqual({ tone: 'paused', text: 'This lab environment is paused' });
    const h = renderToStaticMarkup(<EnvironmentState session={session({ phase: 'hibernated' })} onRestart={noop} />);
    expect(h).not.toContain('Starting your lab environment');
    expect(h).toContain('not available yet');
    expect(h).toContain('End the lab');
    expect(h).not.toContain('Start a new session');
  });

  it('a provisioning session counts ready nodes and offers no restart', () => {
    const h = renderToStaticMarkup(<EnvironmentState session={session({ phase: 'provisioning', nodes: [{ name: 'a', status: 'ready' }, { name: 'b', status: 'provisioning' }] as LabSession['nodes'] })} onRestart={noop} />);
    expect(h).toContain('Starting your lab environment · 1/2 nodes ready');
    expect(h).not.toContain('Start a new session');
  });

  it('failed and ended sessions offer a new session', () => {
    expect(environmentHeadline(session({ phase: 'failed' })).tone).toBe('err');
    expect(environmentHeadline(session({ status: 'expired' })).tone).toBe('over');
    expect(environmentHeadline(undefined).text).toBe('Requesting a lab environment');
    for (const p of [{ phase: 'failed' }, { status: 'expired' }] as const) expect(renderToStaticMarkup(<EnvironmentState session={session(p)} onRestart={noop} />)).toContain('Start a new session');
  });
});
